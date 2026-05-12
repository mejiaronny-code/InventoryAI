"""
app/core/auth.py
Verificación de JWT de Supabase y extracción de company_id/role
"""
from fastapi import HTTPException, Security, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
import httpx
from app.core.config import settings
from app.core.supabase_client import supabase

security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security)
) -> dict:
    """
    Verifica el JWT de Supabase y retorna el usuario con su rol y company_id.
    Lanza 401 si el token es inválido.
    """
    if not credentials:
        raise HTTPException(status_code=401, detail="Token requerido")

    token = credentials.credentials
    try:
        # Verificar token contra Supabase
        user_resp = supabase.auth.get_user(token)
        if not user_resp or not user_resp.user:
            raise HTTPException(status_code=401, detail="Token inválido")

        user_id = user_resp.user.id

        # Obtener perfil con rol y company_id
        profile_resp = supabase.table("user_profiles").select(
            "id, company_id, role, full_name, is_active"
        ).eq("id", user_id).single().execute()

        if not profile_resp.data:
            raise HTTPException(status_code=401, detail="Perfil no encontrado")

        profile = profile_resp.data
        if not profile.get("is_active"):
            raise HTTPException(status_code=403, detail="Cuenta desactivada")

        return {
            "id": user_id,
            "email": user_resp.user.email,
            "company_id": profile.get("company_id"),
            "role": profile.get("role"),
            "full_name": profile.get("full_name"),
            "token": token,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Error de autenticación: {str(e)}")


async def require_admin(user: dict = Security(get_current_user)) -> dict:
    if user["role"] not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Se requiere rol admin")
    return user


async def require_super_admin(user: dict = Security(get_current_user)) -> dict:
    if user["role"] != "super_admin":
        raise HTTPException(status_code=403, detail="Se requiere super admin")
    return user


async def require_staff(user: dict = Security(get_current_user)) -> dict:
    if user["role"] not in ("admin", "employee", "super_admin"):
        raise HTTPException(status_code=403, detail="Acceso no autorizado")
    return user
