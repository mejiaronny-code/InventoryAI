"""
app/routers/stock.py
Movimientos de stock y ajustes de inventario.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from datetime import datetime, timedelta, timezone
import asyncio

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase, run_with_retry_sync as _retry
from app.models.schemas import StockMovementCreate, StockMovementOut, StockUpdate, LocationUpdate
from app.services.notifications import send_low_stock_alert

router = APIRouter(prefix="/stock", tags=["stock"])


def _assert_product_in_company(product_id: str, company_id: str):
    """
    Defensa de aislamiento multi-tenant: el backend usa la service_role key de
    Supabase (bypasea RLS), así que esta comprobación explícita es la ÚNICA
    barrera contra mutar/leer stock de un producto de OTRA empresa pasando su
    UUID directamente. Sin esto, cualquier usuario autenticado podría alterar
    inventario ajeno.
    """
    q = supabase.table("products").select("id").eq("id", product_id).eq("company_id", company_id).maybe_single()
    res = _retry(q.execute)
    if not (res and res.data):
        raise HTTPException(404, "Producto no encontrado")


def _assert_warehouse_in_company(warehouse_id: str, company_id: str):
    q = supabase.table("warehouses").select("id").eq("id", warehouse_id).eq("company_id", company_id).maybe_single()
    res = _retry(q.execute)
    if not (res and res.data):
        raise HTTPException(404, "Almacén no encontrado")


@router.get("/movements")
def list_movements(
    product_id: str = None,
    warehouse_id: str = None,
    user: dict = Depends(require_staff),
):
    # warehouses(name) quedó ambiguo desde que stock_movements tiene DOS FKs a
    # warehouses (warehouse_id y to_warehouse_id, agregada por
    # 017_transfer_stock.sql) — PostgREST exige indicar cuál usar en el embed.
    query = supabase.table("stock_movements")\
        .select(
            "*, products!inner(name, company_id), "
            "warehouses!stock_movements_warehouse_id_fkey(name), "
            "to_warehouse:warehouses!stock_movements_to_warehouse_id_fkey(name)"
        )\
        .eq("products.company_id", user["company_id"])\
        .order("created_at", desc=True)\
        .limit(200)

    if product_id:
        query = query.eq("product_id", product_id)
    if warehouse_id:
        query = query.eq("warehouse_id", warehouse_id)

    result = query.execute()
    movements = result.data or []

    # created_by referencia auth.users, no user_profiles directamente — no se
    # puede pedir como embed de Postgrest. Se resuelve el nombre aparte, para
    # saber QUIÉN hizo cada movimiento (trazabilidad ante robos/faltantes).
    creator_ids = list({m["created_by"] for m in movements if m.get("created_by")})
    if creator_ids:
        profiles_res = supabase.table("user_profiles")\
            .select("id, full_name")\
            .in_("id", creator_ids)\
            .execute()
        creator_names = {p["id"]: p.get("full_name") for p in (profiles_res.data or [])}
        for m in movements:
            m["created_by_name"] = creator_names.get(m.get("created_by"))

    return movements


@router.post("/movement")
async def create_movement(data: StockMovementCreate, user: dict = Depends(require_staff)):
    """
    Registra un movimiento de stock y actualiza la cantidad en product_warehouse_stock.
    Todo el trabajo con Supabase es síncrono — se corre en threadpool para no
    bloquear el event loop; el email (si aplica) se dispara aquí, ya en contexto async.
    """
    result, email_info = await asyncio.to_thread(_create_movement_sync, data, user)
    if email_info:
        asyncio.create_task(send_low_stock_alert(**email_info))
    return result


def _create_movement_sync(data: StockMovementCreate, user: dict):
    # Todas las consultas de esta función se envuelven con _retry (reintento
    # ante cortes transitorios de conexión HTTP/2 con Supabase — ver
    # core/supabase_client.py::run_with_retry_sync). Esta función corre en un
    # hilo aparte (asyncio.to_thread), así que se usa la variante síncrona.
    _assert_product_in_company(str(data.product_id), user["company_id"])
    _assert_warehouse_in_company(str(data.warehouse_id), user["company_id"])

    email_info = None
    batch_code = data.batch_code
    if data.type == "entrada":
        product_company_q = supabase.table("products")\
            .select("company_id")\
            .eq("id", str(data.product_id))\
            .single()
        product_company = _retry(product_company_q.execute)
        if product_company.data:
            company_id_for_batch = product_company.data["company_id"]
            # Verificar si la empresa tiene batch_tracking habilitado
            company_features_q = supabase.table("companies")\
                .select("features")\
                .eq("id", company_id_for_batch)\
                .single()
            company_features = _retry(company_features_q.execute)
            features = (company_features.data or {}).get("features") or {}
            if features.get("batch_tracking"):
                if not batch_code:
                    import random, string
                    suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
                    batch_code = f"LOTE-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{suffix}"

    # El cambio de stock, la transferencia, el movimiento de auditoría y el
    # lote (si aplica) se confirman juntos en Postgres. Si una parte falla,
    # ninguna queda aplicada. Ver migración 019_inventory_integrity.sql.
    if data.type == "transferencia":
        _assert_warehouse_in_company(str(data.to_warehouse_id), user["company_id"])
    try:
        rpc_result = _retry(
            lambda: supabase.rpc("record_stock_movement", {
                "p_company_id": user["company_id"],
                "p_product_id": str(data.product_id),
                "p_warehouse_id": str(data.warehouse_id),
                "p_to_warehouse_id": str(data.to_warehouse_id) if data.to_warehouse_id else None,
                "p_type": data.type.value,
                "p_quantity": data.quantity,
                "p_notes": data.notes,
                "p_created_by": user["id"],
                "p_expires_at": data.expires_at.isoformat() if data.expires_at else None,
                "p_batch_code": batch_code,
            }).execute(),
            idempotent=False,
        )
        row = (rpc_result.data or [{}])[0]
        new_qty = row.get("new_quantity")
    except Exception as e:
        message = str(e)
        if "INSUFFICIENT_STOCK" in message:
            label = "transferencia" if data.type == "transferencia" else "salida"
            raise HTTPException(400, f"Stock insuficiente para la {label}")
        if "INVALID_DESTINATION" in message:
            raise HTTPException(400, "El almacén destino debe ser distinto al origen")
        if "PGRST202" in message or "record_stock_movement" in message and "schema cache" in message:
            raise HTTPException(503, "La migración de integridad de inventario está pendiente")
        raise

    # Notificación si vence en 7 días o menos. La fecha y nearest_expiry ya
    # quedaron guardadas dentro de la misma transacción del movimiento.
    if data.type == "entrada" and data.expires_at:
        expires_iso = data.expires_at.isoformat()
        expires_at_aware = data.expires_at if data.expires_at.tzinfo else data.expires_at.replace(tzinfo=timezone.utc)
        days_to_expiry = (expires_at_aware - datetime.now(timezone.utc)).days
        if days_to_expiry <= 7:
            product_info_q = supabase.table("products").select("name, company_id")\
                .eq("id", str(data.product_id)).single()
            product_info = _retry(product_info_q.execute)
            if product_info.data:
                notif_q = supabase.table("notifications").insert({
                    "company_id": product_info.data["company_id"],
                    "type": "system",
                    "message": f"⚠️ Vencimiento próximo: {product_info.data['name']} vence en {days_to_expiry} día(s)",
                    "target_role": "admin",
                    "metadata": {
                        "product_id": str(data.product_id),
                        "expires_at": expires_iso,
                        "days_to_expiry": days_to_expiry,
                    },
                })
                _retry(notif_q.execute)

    # Verificar alerta de stock mínimo
    stock_alert_q = supabase.table("product_warehouse_stock")\
        .select("min_stock_alert")\
        .eq("product_id", str(data.product_id))\
        .eq("warehouse_id", str(data.warehouse_id))\
        .maybe_single()
    stock_alert = _retry(stock_alert_q.execute)

    stock_alert_row = stock_alert.data if stock_alert else None
    if stock_alert_row and new_qty <= stock_alert_row.get("min_stock_alert", 5):
        product_q = supabase.table("products").select("name, company_id").eq("id", str(data.product_id)).single()
        product = _retry(product_q.execute)
        if product.data:
            company_id_alert = product.data["company_id"]
            # Notificación de stock bajo
            low_stock_notif_q = supabase.table("notifications").insert({
                "company_id": company_id_alert,
                "type": "low_stock",
                "message": f"⚠️ Stock bajo: {product.data['name']} — {new_qty} unidades restantes",
                "target_role": "all",
                "metadata": {"product_id": str(data.product_id), "current_stock": new_qty},
            })
            _retry(low_stock_notif_q.execute)
            # Email de alerta al admin
            try:
                admin_res_q = supabase.table("user_profiles")\
                    .select("id")\
                    .eq("company_id", company_id_alert)\
                    .eq("role", "admin")\
                    .eq("is_active", True)\
                    .limit(1)
                admin_res = _retry(admin_res_q.execute)
                if admin_res.data:
                    admin_id = admin_res.data[0]["id"]
                    admin_auth = supabase.auth.admin.get_user_by_id(admin_id)
                    admin_email = admin_auth.user.email if admin_auth and admin_auth.user else None
                    if admin_email:
                        min_alert_val = stock_alert_row.get("min_stock_alert", 5)
                        company_res_q = supabase.table("companies").select("name").eq("id", company_id_alert).single()
                        company_res = _retry(company_res_q.execute)
                        company_name_alert = company_res.data["name"] if company_res.data else ""
                        email_info = dict(
                            to_email=admin_email,
                            product_name=product.data["name"],
                            current_stock=new_qty,
                            company_name=company_name_alert,
                            min_stock=min_alert_val,
                        )
            except Exception:
                pass  # No crítico

            # Crear solicitud de reabastecimiento automática si no existe una pendiente
            try:
                existing_reorder_q = supabase.table("reorder_requests")\
                    .select("id")\
                    .eq("company_id", company_id_alert)\
                    .eq("product_id", str(data.product_id))\
                    .eq("warehouse_id", str(data.warehouse_id))\
                    .eq("status", "pending")\
                    .maybe_single()
                existing_reorder = _retry(existing_reorder_q.execute)
                if not (existing_reorder and existing_reorder.data):
                    min_alert = stock_alert_row.get("min_stock_alert", 5)
                    reorder_q = supabase.table("reorder_requests").insert({
                        "company_id":         company_id_alert,
                        "product_id":         str(data.product_id),
                        "warehouse_id":       str(data.warehouse_id),
                        "requested_quantity": min_alert * 3,  # sugerir 3× el mínimo
                        "current_stock":      new_qty,
                        "min_stock_alert":    min_alert,
                        "status":             "pending",
                        "notes":              "Generado automáticamente por stock bajo",
                    })
                    _retry(reorder_q.execute)
            except Exception:
                pass  # No crítico

    return {"message": "Movimiento registrado", "new_quantity": new_qty}, email_info


@router.put("/set")
def set_stock(data: StockUpdate, product_id: str, user: dict = Depends(require_admin)):
    """Establece stock y deja el ajuste en la auditoría de forma atómica."""
    _assert_product_in_company(product_id, user["company_id"])
    _assert_warehouse_in_company(str(data.warehouse_id), user["company_id"])

    try:
        _retry(
            lambda: supabase.rpc("set_stock_with_audit", {
                "p_company_id": user["company_id"],
                "p_product_id": product_id,
                "p_warehouse_id": str(data.warehouse_id),
                "p_quantity": data.quantity,
                "p_min_stock_alert": data.min_stock_alert,
                "p_notes": data.notes,
                "p_created_by": user["id"],
            }).execute(),
            idempotent=False,
        )
    except Exception as e:
        message = str(e)
        if "PGRST202" in message or "set_stock_with_audit" in message and "schema cache" in message:
            raise HTTPException(503, "La migración de integridad de inventario está pendiente")
        raise

    # Verificar reabastecimiento automático
    if data.quantity <= data.min_stock_alert:
        product = supabase.table("products").select("name, company_id")\
            .eq("id", product_id).single().execute()
        if product.data:
            company_id_alert = product.data["company_id"]
            try:
                existing_reorder = supabase.table("reorder_requests")\
                    .select("id")\
                    .eq("company_id", company_id_alert)\
                    .eq("product_id", product_id)\
                    .eq("warehouse_id", str(data.warehouse_id))\
                    .eq("status", "pending")\
                    .maybe_single().execute()
                if not (existing_reorder and existing_reorder.data):
                    supabase.table("reorder_requests").insert({
                        "company_id":         company_id_alert,
                        "product_id":         product_id,
                        "warehouse_id":       str(data.warehouse_id),
                        "requested_quantity": data.min_stock_alert * 3,
                        "current_stock":      data.quantity,
                        "min_stock_alert":    data.min_stock_alert,
                        "status":             "pending",
                        "notes":              "Generado automáticamente por stock bajo",
                    }).execute()
            except Exception:
                pass

    return {"message": "Stock actualizado"}


@router.get("/expiring")
async def get_expiring_products(
    days: int = Query(30, le=365),
    user: dict = Depends(require_staff),
):
    """Retorna productos con nearest_expiry dentro de los próximos N días."""
    company_id = user["company_id"]
    cutoff  = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()

    product_ids_res = await asyncio.to_thread(
        lambda: supabase.table("products")
            .select("id").eq("company_id", company_id).eq("is_active", True).execute()
    )
    product_ids = [p["id"] for p in (product_ids_res.data or [])]
    if not product_ids:
        return []

    stock_res = await asyncio.to_thread(
        lambda: supabase.table("product_warehouse_stock")
            .select("product_id, warehouse_id, quantity, nearest_expiry, warehouses(name)")
            .in_("product_id", product_ids)
            .not_.is_("nearest_expiry", "null")
            .lte("nearest_expiry", cutoff)
            .gte("nearest_expiry", now_iso)
            .order("nearest_expiry")
            .execute()
    )

    if not stock_res.data:
        return []

    pid_set = list({r["product_id"] for r in stock_res.data})
    products_res = await asyncio.to_thread(
        lambda: supabase.table("products").select("id, name, unit").in_("id", pid_set).execute()
    )
    name_map = {p["id"]: p for p in (products_res.data or [])}

    result = []
    for s in stock_res.data:
        p = name_map.get(s["product_id"], {})
        wh = (s.get("warehouses") or {}).get("name", "—")
        expiry = s["nearest_expiry"]
        days_left = (datetime.fromisoformat(expiry.replace("Z", "+00:00")) - datetime.now(timezone.utc)).days
        result.append({
            "product_id": s["product_id"],
            "product_name": p.get("name", "—"),
            "unit": p.get("unit", "—"),
            "warehouse_name": wh,
            "quantity": s["quantity"],
            "nearest_expiry": expiry,
            "days_left": max(days_left, 0),
        })

    return result


@router.patch("/location")
def update_location(data: LocationUpdate, user: dict = Depends(require_staff)):
    """Actualiza la ubicación física (bodega + tienda) sin afectar la cantidad."""
    _assert_product_in_company(data.product_id, user["company_id"])
    _assert_warehouse_in_company(data.warehouse_id, user["company_id"])

    update_fields = {
        "aisle":          data.aisle          or None,
        "shelf":          data.shelf          or None,
        "bin":            data.bin            or None,
        "store_location": data.store_location or None,
    }
    if data.min_stock_alert is not None:
        update_fields["min_stock_alert"] = data.min_stock_alert
    existing = supabase.table("product_warehouse_stock")\
        .select("id")\
        .eq("product_id", data.product_id)\
        .eq("warehouse_id", data.warehouse_id)\
        .execute()

    if existing.data:
        supabase.table("product_warehouse_stock")\
            .update(update_fields)\
            .eq("product_id", data.product_id)\
            .eq("warehouse_id", data.warehouse_id)\
            .execute()
    else:
        raise HTTPException(404, "Registro de stock no encontrado")

    return {"message": "Ubicación actualizada"}
