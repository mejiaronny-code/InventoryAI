"""
app/core/auth.py
Verificación de JWT de Supabase y extracción de company_id/role.
Cache de tokens en memoria para evitar 2 round trips a Supabase por request.
"""
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import time
import threading
from app.core.supabase_client import supabase

security = HTTPBearer(auto_error=False)

# ── Cache de autenticación ────────────────────────────────────────────────────
# Evita llamar a Supabase Auth + user_profiles en cada request.
# TTL 5 minutos — aceptable para datos de sesión.
_auth_cache: dict[str, tuple[dict, float]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 300  # segundos


def _get_cached(token: str) -> dict | None:
    with _cache_lock:
        entry = _auth_cache.get(token)
        if entry and entry[1] > time.time():
            return entry[0]
        if entry:
            del _auth_cache[token]
        return None


def _set_cached(token: str, user: dict) -> None:
    with _cache_lock:
        # Limpiar entradas viejas si el cache crece demasiado
        if len(_auth_cache) > 500:
            now = time.time()
            stale = [k for k, (_, exp) in _auth_cache.items() if exp <= now]
            for k in stale:
                del _auth_cache[k]
        _auth_cache[token] = (user, time.time() + _CACHE_TTL)


def invalidate_token(token: str) -> None:
    """Llamar en logout para limpiar el cache inmediatamente."""
    with _cache_lock:
        _auth_cache.pop(token, None)


# ── Verificación de usuario ───────────────────────────────────────────────────
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security)
) -> dict:
    """
    Verifica el JWT de Supabase y retorna el usuario con su rol y company_id.
    Usa cache en memoria para evitar round trips repetidos.
    """
    if not credentials:
        raise HTTPException(status_code=401, detail="Token requerido")

    token = credentials.credentials

    # ── Cache hit ──
    cached = _get_cached(token)
    if cached:
        return cached

    # ── Cache miss: verificar contra Supabase ──
    try:
        user_resp = supabase.auth.get_user(token)
        if not user_resp or not user_resp.user:
            raise HTTPException(status_code=401, detail="Token inválido")

        user_id = user_resp.user.id

        profile_resp = supabase.table("user_profiles").select(
            "id, company_id, role, full_name, is_active"
        ).eq("id", user_id).single().execute()

        if not profile_resp.data:
            raise HTTPException(status_code=401, detail="Perfil no encontrado")

        profile = profile_resp.data
        if not profile.get("is_active"):
            raise HTTPException(status_code=403, detail="Cuenta desactivada")

        role = profile.get("role")
        company_id = profile.get("company_id")

        if role in ("admin", "employee") and not company_id:
            raise HTTPException(
                status_code=403,
                detail="Tu cuenta no está asignada a ninguna empresa. Contacta al administrador."
            )

        user = {
            "id": user_id,
            "email": user_resp.user.email,
            "company_id": company_id,
            "role": role,
            "full_name": profile.get("full_name"),
            "token": token,
        }

        _set_cached(token, user)
        return user

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
