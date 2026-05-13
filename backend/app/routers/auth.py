"""
app/routers/auth.py
Autenticación y gestión de usuarios.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from app.core.auth import require_admin, require_super_admin, get_current_user
from app.core.supabase_client import supabase

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
        result = supabase.auth.sign_in_with_password({
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
        result = supabase.auth.refresh_session(refresh_token)
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

        return {"message": "Empleado creado", "id": auth_result.user.id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error: {str(e)}")


@router.get("/employees")
async def list_employees(user: dict = Depends(require_admin)):
    result = supabase.table("user_profiles")\
        .select("id, full_name, role, is_active, created_at")\
        .eq("company_id", user["company_id"])\
        .execute()
    return result.data or []


@router.delete("/employees/{employee_id}")
async def deactivate_employee(employee_id: str, user: dict = Depends(require_admin)):
    supabase.table("user_profiles")\
        .update({"is_active": False})\
        .eq("id", employee_id)\
        .eq("company_id", user["company_id"])\
        .execute()
    return {"message": "Empleado desactivado"}
