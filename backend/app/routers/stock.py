"""
app/routers/stock.py
Movimientos de stock y ajustes de inventario.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from datetime import datetime, timedelta
import asyncio

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase
from app.models.schemas import StockMovementCreate, StockMovementOut, StockUpdate, LocationUpdate
from app.services.notifications import send_low_stock_alert

router = APIRouter(prefix="/stock", tags=["stock"])


@router.get("/movements")
def list_movements(
    product_id: str = None,
    warehouse_id: str = None,
    user: dict = Depends(require_staff),
):
    query = supabase.table("stock_movements")\
        .select("*, products!inner(name, company_id), warehouses(name)")\
        .eq("products.company_id", user["company_id"])\
        .order("created_at", desc=True)\
        .limit(200)

    if product_id:
        query = query.eq("product_id", product_id)
    if warehouse_id:
        query = query.eq("warehouse_id", warehouse_id)

    result = query.execute()
    return result.data or []


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
    email_info = None
    movement_dump = data.model_dump()
    if movement_dump.get("expires_at"):
        movement_dump["expires_at"] = movement_dump["expires_at"].isoformat()

    # batch_code no va en stock_movements — lo manejamos aparte
    batch_code = movement_dump.pop("batch_code", None)

    movement_data = {
        **movement_dump,
        "product_id": str(data.product_id),
        "warehouse_id": str(data.warehouse_id),
        "created_by": user["id"],
    }

    # Obtener stock actual (maybe_single evita error PGRST116 cuando no hay fila aún)
    current = supabase.table("product_warehouse_stock")\
        .select("quantity")\
        .eq("product_id", str(data.product_id))\
        .eq("warehouse_id", str(data.warehouse_id))\
        .maybe_single()\
        .execute()

    # maybe_single() retorna None directamente (no objeto con .data) cuando no hay fila
    current_row = current.data if current else None
    current_qty = current_row["quantity"] if current_row else 0

    # Calcular nuevo stock
    if data.type == "entrada":
        new_qty = current_qty + data.quantity
    elif data.type == "salida":
        new_qty = current_qty - data.quantity
        if new_qty < 0:
            raise HTTPException(400, "Stock insuficiente para la salida")
    elif data.type == "ajuste":
        new_qty = data.quantity  # ajuste directo al valor indicado
    else:
        new_qty = current_qty  # transferencia se maneja por separado

    # Actualizar stock
    if current_row:
        supabase.table("product_warehouse_stock")\
            .update({"quantity": new_qty})\
            .eq("product_id", str(data.product_id))\
            .eq("warehouse_id", str(data.warehouse_id))\
            .execute()
    else:
        supabase.table("product_warehouse_stock").insert({
            "product_id": str(data.product_id),
            "warehouse_id": str(data.warehouse_id),
            "quantity": max(new_qty, 0),
        }).execute()

    # Registrar movimiento
    result = supabase.table("stock_movements").insert(movement_data).execute()

    # Crear lote automáticamente si es entrada y se proveyó batch_code (o generar uno)
    if data.type == "entrada":
        product_company = supabase.table("products")\
            .select("company_id")\
            .eq("id", str(data.product_id))\
            .single().execute()
        if product_company.data:
            company_id_for_batch = product_company.data["company_id"]
            # Verificar si la empresa tiene batch_tracking habilitado
            company_features = supabase.table("companies")\
                .select("features")\
                .eq("id", company_id_for_batch)\
                .single().execute()
            features = (company_features.data or {}).get("features") or {}
            if features.get("batch_tracking"):
                if not batch_code:
                    # Generar código automático: LOTE-YYYYMMDD-XXXX
                    import random, string
                    suffix = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
                    batch_code = f"LOTE-{datetime.utcnow().strftime('%Y%m%d')}-{suffix}"
                expires_iso = data.expires_at.isoformat() if data.expires_at else None
                supabase.table("product_batches").insert({
                    "company_id": company_id_for_batch,
                    "product_id": str(data.product_id),
                    "warehouse_id": str(data.warehouse_id),
                    "batch_code": batch_code,
                    "quantity": data.quantity,
                    "initial_quantity": data.quantity,
                    "expires_at": expires_iso,
                    "notes": data.notes,
                }).execute()

    # Actualizar nearest_expiry si es una entrada con fecha de vencimiento
    if data.type == "entrada" and data.expires_at:
        expires_iso = data.expires_at.isoformat()
        # Obtener nearest_expiry actual
        current_expiry_res = supabase.table("product_warehouse_stock")\
            .select("nearest_expiry")\
            .eq("product_id", str(data.product_id))\
            .eq("warehouse_id", str(data.warehouse_id))\
            .maybe_single()\
            .execute()
        current_nearest = ((current_expiry_res.data if current_expiry_res else None) or {}).get("nearest_expiry")
        # Guardar la más próxima
        if not current_nearest or expires_iso < current_nearest:
            supabase.table("product_warehouse_stock")\
                .update({"nearest_expiry": expires_iso})\
                .eq("product_id", str(data.product_id))\
                .eq("warehouse_id", str(data.warehouse_id))\
                .execute()
        # Notificación si vence en 7 días o menos
        days_to_expiry = (data.expires_at - datetime.utcnow()).days
        if days_to_expiry <= 7:
            product_info = supabase.table("products").select("name, company_id")\
                .eq("id", str(data.product_id)).single().execute()
            if product_info.data:
                supabase.table("notifications").insert({
                    "company_id": product_info.data["company_id"],
                    "type": "system",
                    "message": f"⚠️ Vencimiento próximo: {product_info.data['name']} vence en {days_to_expiry} día(s)",
                    "target_role": "admin",
                    "metadata": {
                        "product_id": str(data.product_id),
                        "expires_at": expires_iso,
                        "days_to_expiry": days_to_expiry,
                    },
                }).execute()

    # Verificar alerta de stock mínimo
    stock_alert = supabase.table("product_warehouse_stock")\
        .select("min_stock_alert")\
        .eq("product_id", str(data.product_id))\
        .eq("warehouse_id", str(data.warehouse_id))\
        .maybe_single()\
        .execute()

    stock_alert_row = stock_alert.data if stock_alert else None
    if stock_alert_row and new_qty <= stock_alert_row.get("min_stock_alert", 5):
        product = supabase.table("products").select("name, company_id").eq("id", str(data.product_id)).single().execute()
        if product.data:
            company_id_alert = product.data["company_id"]
            # Notificación de stock bajo
            supabase.table("notifications").insert({
                "company_id": company_id_alert,
                "type": "low_stock",
                "message": f"⚠️ Stock bajo: {product.data['name']} — {new_qty} unidades restantes",
                "target_role": "all",
                "metadata": {"product_id": str(data.product_id), "current_stock": new_qty},
            }).execute()
            # Email de alerta al admin
            try:
                admin_res = supabase.table("user_profiles")\
                    .select("id")\
                    .eq("company_id", company_id_alert)\
                    .eq("role", "admin")\
                    .eq("is_active", True)\
                    .limit(1)\
                    .execute()
                if admin_res.data:
                    admin_id = admin_res.data[0]["id"]
                    admin_auth = supabase.auth.admin.get_user_by_id(admin_id)
                    admin_email = admin_auth.user.email if admin_auth and admin_auth.user else None
                    if admin_email:
                        min_alert_val = stock_alert_row.get("min_stock_alert", 5)
                        company_res = supabase.table("companies").select("name").eq("id", company_id_alert).single().execute()
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
                existing_reorder = supabase.table("reorder_requests")\
                    .select("id")\
                    .eq("company_id", company_id_alert)\
                    .eq("product_id", str(data.product_id))\
                    .eq("warehouse_id", str(data.warehouse_id))\
                    .eq("status", "pending")\
                    .maybe_single().execute()
                if not (existing_reorder and existing_reorder.data):
                    min_alert = stock_alert_row.get("min_stock_alert", 5)
                    supabase.table("reorder_requests").insert({
                        "company_id":         company_id_alert,
                        "product_id":         str(data.product_id),
                        "warehouse_id":       str(data.warehouse_id),
                        "requested_quantity": min_alert * 3,  # sugerir 3× el mínimo
                        "current_stock":      new_qty,
                        "min_stock_alert":    min_alert,
                        "status":             "pending",
                        "notes":              "Generado automáticamente por stock bajo",
                    }).execute()
            except Exception:
                pass  # No crítico

    return {"message": "Movimiento registrado", "new_quantity": new_qty}, email_info


@router.put("/set")
def set_stock(data: StockUpdate, product_id: str, user: dict = Depends(require_admin)):
    """Establece el stock de un producto en un almacén directamente."""
    existing = supabase.table("product_warehouse_stock")\
        .select("id")\
        .eq("product_id", product_id)\
        .eq("warehouse_id", str(data.warehouse_id))\
        .execute()

    if existing.data:
        supabase.table("product_warehouse_stock")\
            .update({"quantity": data.quantity, "min_stock_alert": data.min_stock_alert})\
            .eq("product_id", product_id)\
            .eq("warehouse_id", str(data.warehouse_id))\
            .execute()
    else:
        supabase.table("product_warehouse_stock").insert({
            "product_id": product_id,
            "warehouse_id": str(data.warehouse_id),
            "quantity": data.quantity,
            "min_stock_alert": data.min_stock_alert,
        }).execute()

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
    cutoff  = (datetime.utcnow() + timedelta(days=days)).isoformat()
    now_iso = datetime.utcnow().isoformat()

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
        days_left = (datetime.fromisoformat(expiry.replace("Z", "")) - datetime.utcnow()).days
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
