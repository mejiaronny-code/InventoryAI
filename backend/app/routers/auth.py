"""
app/routers/auth.py
Autenticación y gestión de usuarios.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
import asyncio
import httpx
from app.core.auth import require_admin, require_super_admin, get_current_user
from app.core.supabase_client import supabase, supabase_auth
from app.core.config import settings
from app.services.notifications import send_welcome_email, send_password_reset_email

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterEmployeeRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str = "employee"


@router.post("/login")
async def login(data: LoginRequest):
    """Login via Supabase Auth."""
    try:
        # Cliente de auth aislado: NO contamina el cliente de datos con la sesión
        # del usuario (evita 'JWT expired' en las consultas a tablas ~1h después).
        result = supabase_auth.auth.sign_in_with_password({
            "email": data.email,
            "password": data.password,
        })
        if not result.user:
            raise HTTPException(401, "Credenciales inválidas")

        profile = supabase.table("user_profiles")\
            .select("*")\
            .eq("id", result.user.id)\
            .single()\
            .execute()

        return {
            "access_token": result.session.access_token,
            "refresh_token": result.session.refresh_token,
            "user": {
                "id": result.user.id,
                "email": result.user.email,
                "role": profile.data.get("role") if profile.data else None,
                "company_id": profile.data.get("company_id") if profile.data else None,
                "full_name": profile.data.get("full_name") if profile.data else None,
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(401, f"Error de autenticación: {str(e)}")


@router.post("/refresh")
async def refresh_token(refresh_token: str):
    try:
        result = supabase_auth.auth.refresh_session(refresh_token)
        return {
            "access_token": result.session.access_token,
            "refresh_token": result.session.refresh_token,
        }
    except Exception as e:
        raise HTTPException(401, f"Token expirado: {str(e)}")


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    return user


class UpdateProfileRequest(BaseModel):
    full_name: str


@router.put("/me")
async def update_me(data: UpdateProfileRequest, user: dict = Depends(get_current_user)):
    supabase.table("user_profiles")\
        .update({"full_name": data.full_name})\
        .eq("id", user["id"])\
        .execute()
    return {**user, "full_name": data.full_name}


@router.post("/employees")
async def create_employee(data: RegisterEmployeeRequest, user: dict = Depends(require_admin)):
    """El admin crea empleados para su empresa."""
    try:
        # Crear usuario en Supabase Auth
        auth_result = supabase.auth.admin.create_user({
            "email": data.email,
            "password": data.password,
            "email_confirm": True,
        })

        if not auth_result.user:
            raise HTTPException(500, "Error al crear usuario")

        # Crear perfil
        supabase.table("user_profiles").insert({
            "id": auth_result.user.id,
            "company_id": user["company_id"],
            "full_name": data.full_name,
            "role": data.role if data.role in ("admin", "employee") else "employee",
        }).execute()

        # Obtener nombre de la empresa para el email
        company_res = supabase.table("companies").select("name").eq("id", user["company_id"]).single().execute()
        company_name = company_res.data["name"] if company_res.data else "tu empresa"
        asyncio.create_task(send_welcome_email(data.email, data.full_name, company_name))

        return {"message": "Empleado creado", "id": auth_result.user.id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error: {str(e)}")


class ForgotPasswordRequest(BaseModel):
    email: EmailStr

@router.post("/forgot-password")
async def forgot_password(data: ForgotPasswordRequest):
    """
    Genera un enlace de recuperación via Supabase admin API (sin que Supabase envíe email)
    y manda nuestro propio email de marca con el link.
    """
    full_name = "Usuario"

    try:
        # Buscar usuario en auth.users para obtener su nombre
        users_res = httpx.get(
            f"{settings.supabase_url}/auth/v1/admin/users",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
            timeout=10,
        )
        all_users = users_res.json().get("users", [])
        matched = next((u for u in all_users if u.get("email") == str(data.email)), None)
        if matched:
            prof = supabase.table("user_profiles").select("full_name").eq("id", matched["id"]).single().execute()
            if prof.data:
                full_name = prof.data.get("full_name") or "Usuario"
    except Exception:
        pass

    # Generar enlace de recuperación via httpx directo al admin API
    try:
        redirect_url = f"{settings.frontend_url}/reset-password"
        link_res = httpx.post(
            f"{settings.supabase_url}/auth/v1/admin/generate_link",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
            json={"type": "recovery", "email": str(data.email)},
            timeout=10,
        )
        link_data = link_res.json()
        # Supabase devuelve action_link o properties.action_link según versión
        action_link = (
            link_data.get("action_link")
            or (link_data.get("properties") or {}).get("action_link")
            or ""
        )
        if action_link:
            # Reemplazar el redirect por el nuestro
            action_link = action_link.replace(
                "type=recovery",
                f"type=recovery&redirect_to={redirect_url}"
            )
            asyncio.create_task(send_password_reset_email(str(data.email), full_name, action_link))
    except Exception:
        pass

    # Siempre misma respuesta — no revelar si el email existe
    return {"message": "Si el correo existe, recibirás un enlace de recuperación."}


@router.get("/employees")
async def list_employees(user: dict = Depends(require_admin)):
    result = supabase.table("user_profiles")\
        .select("id, full_name, role, is_active, created_at")\
        .eq("company_id", user["company_id"])\
        .execute()
    profiles = result.data or []

    # Obtener emails desde Supabase Auth (auth.users)
    try:
        auth_users = supabase.auth.admin.list_users()
        email_map = {u.id: u.email for u in auth_users}
    except Exception:
        email_map = {}

    for p in profiles:
        p["email"] = email_map.get(p["id"], "")

    return profiles


@router.patch("/employees/{employee_id}/toggle-active")
async def toggle_employee_active(employee_id: str, user: dict = Depends(require_admin)):
    """Activa o desactiva un empleado."""
    current = supabase.table("user_profiles")\
        .select("is_active")\
        .eq("id", employee_id)\
        .eq("company_id", user["company_id"])\
        .single().execute()
    if not current.data:
        raise HTTPException(404, "Empleado no encontrado")
    new_state = not current.data["is_active"]
    supabase.table("user_profiles")\
        .update({"is_active": new_state})\
        .eq("id", employee_id)\
        .execute()
    return {"is_active": new_state}


@router.delete("/employees/{employee_id}")
async def delete_employee(employee_id: str, user: dict = Depends(require_admin)):
    """Elimina permanentemente un empleado del sistema."""
    # Verificar que pertenece a la empresa
    profile = supabase.table("user_profiles")\
        .select("id")\
        .eq("id", employee_id)\
        .eq("company_id", user["company_id"])\
        .single().execute()
    if not profile.data:
        raise HTTPException(404, "Empleado no encontrado")
    # Eliminar perfil
    supabase.table("user_profiles").delete().eq("id", employee_id).execute()
    # Eliminar de Supabase Auth
    try:
        supabase.auth.admin.delete_user(employee_id)
    except Exception:
        pass
    return {"message": "Empleado eliminado"}
