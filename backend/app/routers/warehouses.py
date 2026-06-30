"""
app/routers/warehouses.py
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from app.core.auth import require_admin, require_staff
from app.core.supabase_client import supabase, run_with_retry
from app.models.schemas import WarehouseCreate, WarehouseUpdate, WarehouseOut

router = APIRouter(prefix="/warehouses", tags=["warehouses"])


@router.get("/public/{company_slug}")
async def list_public_warehouses(company_slug: str):
    company_query = supabase.table("companies").select("id").eq("slug", company_slug).single()
    company = await run_with_retry(lambda: company_query.execute())
    if not company.data:
        raise HTTPException(404, "Empresa no encontrada")
    query = supabase.table("warehouses").select("id, name, location").eq("company_id", company.data["id"]).eq("is_active", True)
    result = await run_with_retry(lambda: query.execute())
    return result.data or []


@router.get("/", response_model=List[WarehouseOut])
async def list_warehouses(user: dict = Depends(require_staff)):
    result = supabase.table("warehouses").select("*").eq("company_id", user["company_id"]).execute()
    return result.data or []


@router.post("/", response_model=WarehouseOut)
async def create_warehouse(data: WarehouseCreate, user: dict = Depends(require_admin)):
    result = supabase.table("warehouses").insert({**data.model_dump(), "company_id": user["company_id"]}).execute()
    return result.data[0]


@router.put("/{warehouse_id}", response_model=WarehouseOut)
async def update_warehouse(warehouse_id: str, data: WarehouseUpdate, user: dict = Depends(require_admin)):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    result = supabase.table("warehouses").update(update_data).eq("id", warehouse_id).eq("company_id", user["company_id"]).execute()
    if not result.data:
        raise HTTPException(404, "Almacén no encontrado")
    return result.data[0]


@router.delete("/{warehouse_id}")
async def delete_warehouse(warehouse_id: str, user: dict = Depends(require_admin)):
    supabase.table("warehouses").update({"is_active": False}).eq("id", warehouse_id).eq("company_id", user["company_id"]).execute()
    return {"message": "Desactivado"}
