"""
app/routers/categories.py
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from app.core.auth import require_admin, require_staff
from app.core.supabase_client import supabase, run_with_retry
from app.core.company_features import get_active_company, require_public_catalog
from app.models.schemas import CategoryCreate, CategoryUpdate, CategoryOut

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("/public/{company_slug}", response_model=List[CategoryOut])
async def list_public_categories(company_slug: str):
    company = await get_active_company(company_slug)
    require_public_catalog(company)
    query = supabase.table("categories").select("*").eq("company_id", company["id"])
    result = await run_with_retry(lambda: query.execute())
    return result.data or []


@router.get("/", response_model=List[CategoryOut])
def list_categories(user: dict = Depends(require_staff)):
    result = supabase.table("categories").select("*").eq("company_id", user["company_id"]).execute()
    return result.data or []


@router.post("/", response_model=CategoryOut)
def create_category(data: CategoryCreate, user: dict = Depends(require_admin)):
    result = supabase.table("categories").insert({**data.model_dump(), "company_id": user["company_id"]}).execute()
    return result.data[0]


@router.put("/{category_id}", response_model=CategoryOut)
def update_category(category_id: str, data: CategoryUpdate, user: dict = Depends(require_admin)):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    result = supabase.table("categories").update(update_data).eq("id", category_id).eq("company_id", user["company_id"]).execute()
    if not result.data:
        raise HTTPException(404, "Categoría no encontrada")
    return result.data[0]


@router.delete("/{category_id}")
def delete_category(category_id: str, user: dict = Depends(require_admin)):
    supabase.table("categories").delete().eq("id", category_id).eq("company_id", user["company_id"]).execute()
    return {"message": "Eliminada"}
