"""
app/routers/tables.py
Mesas/zonas del restaurante (sector restaurantes). Opcionales — un
restaurante de para-llevar puede no definir ninguna.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase, run_with_retry
from app.core.company_features import get_active_company
from app.models.schemas import TableCreate, TableUpdate

router = APIRouter(prefix="/tables", tags=["tables"])


@router.get("/")
async def list_tables(user: dict = Depends(require_staff)):
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(401, "No se encontró la empresa asociada")
    result = supabase.table("restaurant_tables")\
        .select("*")\
        .eq("company_id", company_id)\
        .order("created_at")\
        .execute()
    return result.data or []


@router.get("/public/{company_slug}")
async def list_tables_public(company_slug: str):
    """Mesas activas para el flujo de reserva público (zonas disponibles)."""
    company = await get_active_company(company_slug, "id, features")
    query = supabase.table("restaurant_tables")\
        .select("id, name, capacity, zone")\
        .eq("company_id", company["id"])\
        .eq("is_active", True)\
        .order("created_at")
    result = await run_with_retry(lambda: query.execute())
    return result.data or []


@router.post("/")
async def create_table(data: TableCreate, user: dict = Depends(require_admin)):
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(401, "No se encontró la empresa asociada")
    result = supabase.table("restaurant_tables").insert({
        "company_id": company_id,
        "name": data.name,
        "capacity": data.capacity,
        "zone": data.zone,
    }).execute()
    return result.data[0]


@router.patch("/{table_id}")
async def update_table(table_id: str, data: TableUpdate, user: dict = Depends(require_admin)):
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(401, "No se encontró la empresa asociada")
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(400, "Nada que actualizar")
    result = supabase.table("restaurant_tables")\
        .update(update_data)\
        .eq("id", table_id)\
        .eq("company_id", company_id)\
        .execute()
    if not result.data:
        raise HTTPException(404, "Mesa no encontrada")
    return result.data[0]


@router.delete("/{table_id}")
async def delete_table(table_id: str, user: dict = Depends(require_admin)):
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(401, "No se encontró la empresa asociada")
    supabase.table("restaurant_tables")\
        .delete()\
        .eq("id", table_id)\
        .eq("company_id", company_id)\
        .execute()
    return {"message": "Mesa eliminada"}
