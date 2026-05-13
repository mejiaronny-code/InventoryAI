"""
app/routers/reservations.py
Gestión de reservas para staff y operaciones públicas del cliente.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from datetime import datetime, timedelta
import secrets
import string

from app.core.auth import require_admin, require_staff
from app.core.supabase_client import supabase
from app.models.schemas import ReservationCreate, ReservationUpdate, ReservationOut

router = APIRouter(prefix="/reservations", tags=["reservations"])


def _generate_code(length: int = 8) -> str:
    """Genera un código de reserva alfanumérico en mayúsculas."""
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


@router.post("/public/{company_slug}")
async def create_public_reservation(company_slug: str, data: ReservationCreate):
    """Reserva pública creada por el cliente desde el catálogo."""
    # 1. Verificar empresa
    company = supabase.table("companies")\
        .select("id, name")\
        .eq("slug", company_slug)\
        .eq("is_active", True)\
        .single()\
        .execute()

    if not company.data:
        raise HTTPException(404, "Empresa no encontrada")

    company_id = company.data["id"]
    company_name = company.data["name"]

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

    return {
        "reservation_code": code,
        "expires_at": expires_at,
        "message": "Reserva creada correctamente",
    }


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


@router.get("/", response_model=List[ReservationOut])
async def list_reservations(
    status: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    user: dict = Depends(require_staff),
):
    query = supabase.table("reservations")\
        .select("*, products(name)")\
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
    result = supabase.table("reservations")\
        .update({"status": data.status, "notes": data.notes, "updated_at": datetime.utcnow().isoformat()})\
        .eq("id", reservation_id)\
        .eq("company_id", user["company_id"])\
        .execute()

    if not result.data:
        raise HTTPException(404, "Reserva no encontrada")
    return result.data[0]


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
