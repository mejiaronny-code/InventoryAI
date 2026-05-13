"""
app/routers/reservations.py
Gestión de reservas para staff y operaciones públicas del cliente.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from datetime import datetime

from app.core.auth import require_admin, require_staff
from app.core.supabase_client import supabase
from app.models.schemas import ReservationCreate, ReservationUpdate, ReservationOut

router = APIRouter(prefix="/reservations", tags=["reservations"])


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
    """Expira manualmente las reservas vencidas. Normalmente lo hace el cron."""
    supabase.rpc("expire_reservations").execute()
    return {"message": "Reservas expiradas procesadas"}
