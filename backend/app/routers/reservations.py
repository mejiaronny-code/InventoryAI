"""
app/routers/reservations.py
Gestión de reservas para staff y operaciones públicas del cliente.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import datetime, timedelta
import secrets
import string
import asyncio
import json

from app.core.auth import require_admin, require_staff
from app.core.supabase_client import supabase
from app.core.company_features import get_active_company, require_public_catalog
from app.services.notifications import send_reservation_email
from app.models.schemas import ReservationCreate, ReservationUpdate

router = APIRouter(prefix="/reservations", tags=["reservations"])


def _generate_code(length: int = 8) -> str:
    """Genera un código de reserva alfanumérico en mayúsculas."""
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


@router.post("/public/{company_slug}")
async def create_public_reservation(company_slug: str, data: ReservationCreate):
    """Reserva pública creada por el cliente desde el catálogo."""
    # 1. Verificar empresa
    company = await get_active_company(company_slug, "id, name, features")
    require_public_catalog(company)

    company_id = company["id"]
    company_name = company["name"]

    # 2. Verificar producto
    product = supabase.table("products")\
        .select("id, name, reservation_time_hours, categories(reservation_time_hours)")\
        .eq("id", str(data.product_id))\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .single()\
        .execute()

    if not product.data:
        raise HTTPException(404, "Producto no disponible")

    # 3. Verificar stock disponible en el almacén
    stock = supabase.table("product_warehouse_stock")\
        .select("quantity")\
        .eq("product_id", str(data.product_id))\
        .eq("warehouse_id", str(data.warehouse_id))\
        .single()\
        .execute()

    available = stock.data["quantity"] if stock.data else 0
    if available < data.quantity:
        raise HTTPException(400, f"Stock insuficiente. Disponible: {available}")

    # 4. Calcular expiración
    p = product.data
    hours = (
        p.get("reservation_time_hours")
        or (p.get("categories") or {}).get("reservation_time_hours")
        or 48
    )
    expires_at = (datetime.utcnow() + timedelta(hours=hours)).isoformat()

    # 5. Generar código único
    for _ in range(5):
        code = _generate_code()
        existing = supabase.table("reservations")\
            .select("id")\
            .eq("reservation_code", code)\
            .execute()
        if not existing.data:
            break

    # 6. Crear reserva
    reservation_data = {
        "company_id": company_id,
        "product_id": str(data.product_id),
        "warehouse_id": str(data.warehouse_id),
        "quantity": data.quantity,
        "client_name": data.client_name,
        "client_email": data.client_email,
        "client_phone": data.client_phone,
        "notes": data.notes,
        "status": "pending",
        "reservation_code": code,
        "expires_at": expires_at,
    }

    result = supabase.table("reservations").insert(reservation_data).execute()
    if not result.data:
        raise HTTPException(500, "Error al crear reserva")

    # 7. Notificación al admin/staff de la empresa
    supabase.table("notifications").insert({
        "company_id": company_id,
        "type": "new_reservation",
        "message": f"📋 Nueva reserva de {data.client_name}: {p['name']} x{data.quantity} (Código: {code})",
        "target_role": "all",
        "metadata": {
            "reservation_id": result.data[0]["id"],
            "reservation_code": code,
            "client_name": data.client_name,
            "product_name": p["name"],
        },
    }).execute()

    # Email de confirmación al cliente
    asyncio.create_task(send_reservation_email(
        to_email=data.client_email,
        client_name=data.client_name,
        product_name=p["name"],
        reservation_code=code,
        quantity=data.quantity,
        expires_at=expires_at,
        company_name=company_name,
    ))

    return {
        "reservation_code": code,
        "expires_at": expires_at,
        "message": "Reserva creada correctamente",
    }


@router.get("/public/by-email")
async def get_reservations_by_email(company_slug: str, email: str):
    """Historial de reservas de un cliente por email (sin login)."""
    company = supabase.table("companies")\
        .select("id")\
        .eq("slug", company_slug)\
        .single()\
        .execute()

    if not company.data:
        raise HTTPException(404, "Empresa no encontrada")

    result = supabase.table("reservations")\
        .select("*, products(name, unit, price), warehouses(name)")\
        .eq("company_id", company.data["id"])\
        .eq("client_email", email.lower().strip())\
        .order("created_at", desc=True)\
        .limit(50)\
        .execute()

    return result.data or []


@router.get("/public/{reservation_code}")
async def get_public_reservation(reservation_code: str, company_slug: str):
    """Consulta pública de reserva por código (para el cliente sin login)."""
    company = supabase.table("companies")\
        .select("id")\
        .eq("slug", company_slug)\
        .single()\
        .execute()

    if not company.data:
        raise HTTPException(404, "Empresa no encontrada")

    result = supabase.table("reservations")\
        .select("*, products(name, unit, price), warehouses(name)")\
        .eq("reservation_code", reservation_code.upper())\
        .eq("company_id", company.data["id"])\
        .single()\
        .execute()

    if not result.data:
        raise HTTPException(404, "Reserva no encontrada")

    return result.data


@router.get("/")
async def list_reservations(
    status: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    user: dict = Depends(require_staff),
):
    query = supabase.table("reservations")\
        .select("*, products(name, unit), warehouses(name)")\
        .eq("company_id", user["company_id"])\
        .order("created_at", desc=True)

    if status:
        query = query.eq("status", status)

    result = query.range(offset, offset + limit - 1).execute()
    return result.data or []


@router.patch("/{reservation_id}")
async def update_reservation(
    reservation_id: str,
    data: ReservationUpdate,
    user: dict = Depends(require_staff),
):
    company_id = user["company_id"]

    # Obtener reserva actual antes de actualizar
    current = supabase.table("reservations")\
        .select("status, product_id, warehouse_id, quantity, notes")\
        .eq("id", reservation_id)\
        .eq("company_id", company_id)\
        .single()\
        .execute()

    if not current.data:
        raise HTTPException(404, "Reserva no encontrada")

    update_data = {"status": data.status, "updated_at": datetime.utcnow().isoformat()}
    if data.notes is not None:
        update_data["notes"] = data.notes

    result = supabase.table("reservations")\
        .update(update_data)\
        .eq("id", reservation_id)\
        .eq("company_id", company_id)\
        .execute()

    if not result.data:
        raise HTTPException(404, "Reserva no encontrada")

    # Al completar: decrementar stock general y variant stock si aplica
    if data.status == "completed" and current.data["status"] != "completed":
        res = current.data
        product_id   = res["product_id"]
        warehouse_id = res["warehouse_id"]
        qty          = res["quantity"]
        notes        = res.get("notes") or ""

        # 1. Movimiento de salida en stock general
        stock_row = supabase.table("product_warehouse_stock")\
            .select("id, quantity")\
            .eq("product_id", product_id)\
            .eq("warehouse_id", warehouse_id)\
            .maybe_single()\
            .execute()

        if stock_row.data:
            new_qty = max(0, stock_row.data["quantity"] - qty)
            supabase.table("product_warehouse_stock")\
                .update({"quantity": new_qty})\
                .eq("id", stock_row.data["id"])\
                .execute()

            supabase.table("stock_movements").insert({
                "product_id":   product_id,
                "warehouse_id": warehouse_id,
                "type":         "salida",
                "quantity":     qty,
                "notes":        f"Reserva completada{' · ' + notes if notes else ''}",
            }).execute()

        # 2. Decrementar variant stock si la reserva tenía opciones (ej: "Color: Verde")
        if notes:
            # Parsear notas → {"Color": "Verde", "Talla": "M"}
            # Acepta separador "·" (AI) o "," (catálogo UI) — toma solo la primera parte
            # antes de " — " por si el cliente añadió notas libres al final.
            options_part = notes.split(" — ")[0]

            combination: dict = {}
            # Normalizar: reemplazar coma por · para unificar el split
            normalized = options_part.replace(",", "·")
            for part in normalized.split("·"):
                part = part.strip()
                if ":" in part:
                    k, v = part.split(":", 1)
                    k = k.strip()
                    v = v.strip()
                    if k:  # evitar claves vacías
                        combination[k] = v

            if combination:
                # Buscar la combinación en variant stock
                vs_rows = supabase.table("product_variants_stock")\
                    .select("id, quantity, combination")\
                    .eq("product_id", product_id)\
                    .eq("warehouse_id", warehouse_id)\
                    .execute()

                for vs in (vs_rows.data or []):
                    db_combo = vs.get("combination") or {}
                    # Si combination llegó como string (edge case), parsear
                    if isinstance(db_combo, str):
                        try:
                            db_combo = json.loads(db_combo)
                        except Exception:
                            db_combo = {}
                    # Match case-insensitive: todas las claves de combination presentes
                    if all(
                        str(db_combo.get(k, "")).strip().lower() == v.lower()
                        for k, v in combination.items()
                    ):
                        new_vs_qty = max(0, vs["quantity"] - qty)
                        supabase.table("product_variants_stock")\
                            .update({"quantity": new_vs_qty})\
                            .eq("id", vs["id"])\
                            .execute()
                        break

    return result.data[0]


@router.delete("/cancelled")
async def delete_cancelled_reservations(user: dict = Depends(require_admin)):
    """Elimina todas las reservas completadas, canceladas y expiradas de la empresa."""
    company_id = user["company_id"]
    result = supabase.table("reservations")\
        .delete()\
        .eq("company_id", company_id)\
        .in_("status", ["cancelled", "expired", "completed"])\
        .execute()
    count = len(result.data or [])
    return {"message": f"{count} reservas eliminadas"}


@router.post("/expire-all")
async def expire_reservations(user: dict = Depends(require_staff)):
    """Expira las reservas vencidas y genera notificaciones."""
    now = datetime.utcnow().isoformat()
    company_id = user["company_id"]

    # Buscar reservas pendientes vencidas ANTES de expirarlas para poder notificar
    expiring = supabase.table("reservations")\
        .select("id, reservation_code, client_name, products(name)")\
        .eq("company_id", company_id)\
        .eq("status", "pending")\
        .lt("expires_at", now)\
        .execute()

    # Llamar al RPC para actualizar status en la DB
    supabase.rpc("expire_reservations").execute()

    # Generar notificación por cada reserva expirada de esta empresa
    for r in (expiring.data or []):
        product_name = (r.get("products") or {}).get("name", "producto")
        supabase.table("notifications").insert({
            "company_id": company_id,
            "type": "reservation_expired",
            "message": f"⌛ Reserva expirada: {product_name} — {r['client_name']} (Código: {r['reservation_code']})",
            "target_role": "all",
            "metadata": {
                "reservation_id": r["id"],
                "reservation_code": r["reservation_code"],
            },
        }).execute()

    count = len(expiring.data or [])
    return {"message": f"Reservas expiradas procesadas: {count}"}
