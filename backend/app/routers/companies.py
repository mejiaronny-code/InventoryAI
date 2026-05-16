"""
app/routers/companies.py
Gestión de empresas — super admin y admin de empresa.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from app.core.auth import require_super_admin, require_admin, get_current_user
from app.core.supabase_client import supabase
from app.core.config import settings
from app.models.schemas import CompanyCreate, CompanyUpdate, CompanyOut, BUSINESS_PRESETS, DEFAULT_FEATURES
from typing import List
from pydantic import BaseModel
import httpx
import asyncio
from app.services.notifications import send_welcome_email, send_deletion_request_email

class AssignUserBody(BaseModel):
    user_id: str
    role: str

class CreateUserBody(BaseModel):
    email: str
    password: str
    full_name: str
    role: str = "admin"

class BusinessTypeBody(BaseModel):
    business_type: str
    features: dict | None = None  # solo para tipo "custom"

router = APIRouter(prefix="/companies", tags=["companies"])

_AUTH_HEADERS = {
    "Authorization": f"Bearer {settings.supabase_service_role_key}",
    "apikey": settings.supabase_service_role_key,
}

def _get_auth_user(user_id: str) -> dict | None:
    """Obtiene un usuario de auth.users por ID via REST admin."""
    try:
        r = httpx.get(
            f"{settings.supabase_url}/auth/v1/admin/users/{user_id}",
            headers=_AUTH_HEADERS,
            timeout=10,
        )
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None

def _find_auth_user_by_email(email: str) -> dict | None:
    """Busca un usuario en auth.users por email via REST admin."""
    try:
        r = httpx.get(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers=_AUTH_HEADERS,
            params={"filter": email},
            timeout=10,
        )
        if r.status_code != 200:
            return None
        users = r.json().get("users", [])
        return next((u for u in users if u.get("email") == email), None)
    except Exception:
        return None


@router.get("/", response_model=List[CompanyOut])
async def list_companies_public():
    result = supabase.table("companies")\
        .select("id, name, slug, logo_url, settings, is_active, created_at, subscriptions(status)")\
        .eq("is_active", True)\
        .execute()
    companies = result.data or []
    # Excluir empresas con suscripción cancelada
    return [
        c for c in companies
        if not (isinstance(c.get("subscriptions"), dict) and c["subscriptions"].get("status") == "cancelled")
    ]


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

    btype = data.business_type or "general"
    company_data = {
        **data.model_dump(),
        "subscription_id": sub.data[0]["id"],
        "business_type": btype,
        "features": BUSINESS_PRESETS.get(btype, DEFAULT_FEATURES),
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
    company = supabase.table("companies")\
        .select("id, subscription_id")\
        .eq("id", company_id)\
        .single()\
        .execute()

    if not company.data:
        raise HTTPException(404, "Empresa no encontrada")

    sub_id = company.data.get("subscription_id")

    if sub_id:
        supabase.table("subscriptions")\
            .update({"plan": plan, "status": status})\
            .eq("id", sub_id)\
            .execute()
    else:
        new_sub = supabase.table("subscriptions")\
            .insert({"plan": plan, "status": status})\
            .execute()
        supabase.table("companies")\
            .update({"subscription_id": new_sub.data[0]["id"]})\
            .eq("id", company_id)\
            .execute()

    return {"message": "Suscripción actualizada"}


@router.patch("/{company_id}/ai-rules-limit")
async def set_ai_rules_limit(
    company_id: str,
    limit: int,
    user: dict = Depends(require_super_admin),
):
    """Superadmin define el máximo de reglas IA para una empresa."""
    company = supabase.table("companies").select("settings").eq("id", company_id).single().execute()
    if not company.data:
        raise HTTPException(404, "Empresa no encontrada")
    current_settings = company.data.get("settings") or {}
    current_settings["ai_rules_limit"] = max(0, limit)
    supabase.table("companies").update({"settings": current_settings}).eq("id", company_id).execute()
    return {"ai_rules_limit": current_settings["ai_rules_limit"]}


@router.patch("/{company_id}/business-type")
async def set_business_type(
    company_id: str,
    body: BusinessTypeBody,
    user: dict = Depends(require_super_admin)
):
    """Super admin: define el tipo de negocio y aplica el preset de features."""
    if body.business_type not in BUSINESS_PRESETS and body.business_type != "custom":
        raise HTTPException(400, "Tipo de negocio no válido")

    if body.business_type == "custom" and body.features:
        # Merge con defaults para asegurar que todos los keys existan
        features = {**DEFAULT_FEATURES, **body.features}
    else:
        features = BUSINESS_PRESETS.get(body.business_type, DEFAULT_FEATURES)

    result = supabase.table("companies").update({
        "business_type": body.business_type,
        "features": features,
    }).eq("id", company_id).execute()

    if not result.data:
        raise HTTPException(404, "Empresa no encontrada")
    return {"business_type": body.business_type, "features": features}


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


@router.delete("/{company_id}")
async def delete_company(company_id: str, user: dict = Depends(require_super_admin)):
    result = supabase.table("companies").delete().eq("id", company_id).execute()
    if not result.data:
        raise HTTPException(404, "Empresa no encontrada")
    return {"message": "Empresa eliminada"}


@router.get("/{company_id}/users")
async def list_company_users(company_id: str, user: dict = Depends(require_super_admin)):
    profiles = supabase.table("user_profiles")\
        .select("id, full_name, role, created_at")\
        .eq("company_id", company_id)\
        .execute()

    if not profiles.data:
        return []

    result = []
    for p in profiles.data:
        auth_user = _get_auth_user(p["id"])
        result.append({**p, "email": auth_user.get("email") if auth_user else None})
    return result


@router.get("/{company_id}/search-user")
async def search_user_by_email(company_id: str, email: str, user: dict = Depends(require_super_admin)):
    found = _find_auth_user_by_email(email)
    if not found:
        raise HTTPException(404, "Usuario no encontrado")

    profile = supabase.table("user_profiles")\
        .select("id, full_name, role, company_id")\
        .eq("id", found["id"])\
        .execute()

    profile_data = profile.data[0] if profile.data else {}
    return {"id": found["id"], "email": found["email"], **profile_data}


@router.post("/{company_id}/assign-admin")
async def assign_user_to_company(
    company_id: str,
    body: AssignUserBody,
    user: dict = Depends(require_super_admin)
):
    existing = supabase.table("user_profiles").select("id").eq("id", body.user_id).execute()

    if existing.data:
        supabase.table("user_profiles")\
            .update({"company_id": company_id, "role": body.role})\
            .eq("id", body.user_id)\
            .execute()
    else:
        supabase.table("user_profiles")\
            .insert({"id": body.user_id, "company_id": company_id, "role": body.role})\
            .execute()

    return {"message": "Usuario asignado"}


@router.post("/{company_id}/create-user")
async def create_company_user(
    company_id: str,
    body: CreateUserBody,
    user: dict = Depends(require_super_admin)
):
    try:
        r = httpx.post(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers=_AUTH_HEADERS,
            json={"email": body.email, "password": body.password, "email_confirm": True},
            timeout=15,
        )
        if r.status_code not in (200, 201):
            raise HTTPException(400, r.json().get("message", "Error al crear usuario"))
        new_auth_user = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Error al crear usuario: {str(e)}")

    user_id = new_auth_user["id"]
    supabase.table("user_profiles").insert({
        "id": user_id,
        "full_name": body.full_name,
        "company_id": company_id,
        "role": body.role,
    }).execute()

    # Email de bienvenida
    company_res = supabase.table("companies").select("name").eq("id", company_id).single().execute()
    company_name = company_res.data["name"] if company_res.data else "tu empresa"
    asyncio.create_task(send_welcome_email(body.email, body.full_name, company_name))

    return {"message": "Usuario creado", "user_id": user_id}


@router.delete("/{company_id}/users/{user_id}")
async def remove_user_from_company(
    company_id: str,
    user_id: str,
    user: dict = Depends(require_super_admin)
):
    supabase.table("user_profiles")\
        .update({"company_id": None, "role": "employee"})\
        .eq("id", user_id)\
        .eq("company_id", company_id)\
        .execute()
    return {"message": "Usuario removido"}


@router.post("/me/upload-logo")
async def upload_logo(
    file: UploadFile = File(...),
    user: dict = Depends(require_admin)
):
    company_id = user["company_id"]
    ext = file.filename.split(".")[-1].lower()
    if ext not in ("png", "jpg", "jpeg", "webp", "svg"):
        raise HTTPException(400, "Formato no permitido. Usa PNG, JPG, WEBP o SVG.")

    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(400, "El archivo supera 2MB.")

    bucket = "product-images"
    storage_path = f"logos/{company_id}.{ext}"
    upload_url = f"{settings.supabase_url}/storage/v1/object/{bucket}/{storage_path}"

    # Subir usando service_role_key — bypasea RLS de Storage
    response = httpx.put(
        upload_url,
        content=content,
        headers={
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "apikey": settings.supabase_service_role_key,
            "Content-Type": file.content_type,
            "x-upsert": "true",
        },
        timeout=30,
    )

    if response.status_code not in (200, 201):
        raise HTTPException(500, f"Error al subir imagen: {response.text}")

    public_url = (
        f"{settings.supabase_url}/storage/v1/object/public/{bucket}/{storage_path}"
        f"?t={int(__import__('time').time())}"
    )

    supabase.table("companies")\
        .update({"logo_url": public_url})\
        .eq("id", company_id)\
        .execute()

    return {"logo_url": public_url}


@router.put("/me/settings")
async def update_my_company(data: CompanyUpdate, user: dict = Depends(require_admin)):
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    result = supabase.table("companies")\
        .update(update_data)\
        .eq("id", user["company_id"])\
        .execute()
    return result.data[0] if result.data else {}


@router.post("/me/request-deletion")
async def request_account_deletion(user: dict = Depends(require_admin)):
    """Envía una solicitud de eliminación de cuenta al super admin."""
    company = supabase.table("companies")\
        .select("name")\
        .eq("id", user["company_id"])\
        .single()\
        .execute()

    company_name = company.data["name"] if company.data else "—"
    requested_by = user.get("email") or user.get("full_name") or user["id"]

    supabase.table("notifications").insert({
        "company_id": user["company_id"],
        "type": "system",
        "message": (
            f"🗑️ Solicitud de eliminación de cuenta enviada para '{company_name}'. "
            f"El equipo de soporte revisará tu solicitud y se pondrá en contacto contigo. "
            f"(Solicitado por: {requested_by})"
        ),
        "target_role": "all",
        "metadata": {
            "deletion_request": True,
            "company_name": company_name,
            "requested_by": requested_by,
        },
    }).execute()

    admin_email = user.get("email", "")
    if admin_email:
        asyncio.create_task(send_deletion_request_email(company_name, requested_by, admin_email))

    return {"message": "Solicitud enviada correctamente"}
