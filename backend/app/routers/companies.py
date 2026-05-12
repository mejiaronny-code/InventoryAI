"""
app/routers/companies.py
Gestión de empresas — super admin y admin de empresa.
"""
from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import require_super_admin, require_admin, get_current_user
from app.core.supabase_client import supabase
from app.models.schemas import CompanyCreate, CompanyUpdate, CompanyOut
from typing import List

router = APIRouter(prefix="/companies", tags=["companies"])


@router.get("/", response_model=List[CompanyOut])
async def list_companies_public():
    result = supabase.table("companies")\
        .select("id, name, slug, logo_url, settings, is_active, created_at")\
        .eq("is_active", True)\
        .execute()
    return result.data or []


@router.get("/all")
async def list_all_companies(user: dict = Depends(require_super_admin)):
    """Super admin: lista todas las empresas con suscripción."""
    result = supabase.table("companies")\
        .select("*, subscriptions(plan, status, ends_at)")\
        .execute()
    return result.data or []


@router.post("/")
async def create_company(data: CompanyCreate, user: dict = Depends(require_super_admin)):
    # Crear suscripción trial
    sub = supabase.table("subscriptions").insert({
        "plan": "trial",
        "status": "trial",
    }).execute()

    company_data = {
        **data.model_dump(),
        "subscription_id": sub.data[0]["id"],
    }
    result = supabase.table("companies").insert(company_data).execute()
    return result.data[0]


@router.put("/{company_id}")
async def update_company(company_id: str, data: CompanyUpdate, user: dict = Depends(require_super_admin)):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    result = supabase.table("companies").update(update_data).eq("id", company_id).execute()
    if not result.data:
        raise HTTPException(404, "Empresa no encontrada")
    return result.data[0]


@router.patch("/{company_id}/subscription")
async def update_subscription(
    company_id: str,
    plan: str,
    status: str,
    user: dict = Depends(require_super_admin)
):
    company = supabase.table("companies").select("subscription_id").eq("id", company_id).single().execute()
    if not company.data or not company.data.get("subscription_id"):
        raise HTTPException(404, "Suscripción no encontrada")

    supabase.table("subscriptions")\
        .update({"plan": plan, "status": status})\
        .eq("id", company.data["subscription_id"])\
        .execute()
    return {"message": "Suscripción actualizada"}


@router.get("/me")
async def get_my_company(user: dict = Depends(get_current_user)):
    if not user.get("company_id"):
        raise HTTPException(404, "Sin empresa asignada")
    result = supabase.table("companies")\
        .select("*, subscriptions(plan, status, ends_at)")\
        .eq("id", user["company_id"])\
        .single()\
        .execute()
    return result.data


@router.put("/me/settings")
async def update_my_company(data: CompanyUpdate, user: dict = Depends(require_admin)):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    result = supabase.table("companies")\
        .update(update_data)\
        .eq("id", user["company_id"])\
        .execute()
    return result.data[0] if result.data else {}
