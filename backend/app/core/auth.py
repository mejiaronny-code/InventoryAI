"""
app/core/auth.py
Verificación de JWT de Supabase y extracción de company_id/role.
Cache de tokens en memoria para evitar 2 round trips a Supabase por request.
"""
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import asyncio
import logging
import time
import threading
from jose import jwt as jose_jwt, JWTError
from app.core.supabase_client import supabase
from app.core.config import settings

logger = logging.getLogger(__name__)

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

    # ── Cache miss: verificar el token ──
    try:
        user_id, email = await _verify_token(token)

        profile_query = supabase.table("user_profiles").select(
            "id, company_id, role, full_name, is_active"
        ).eq("id", user_id).single()
        profile_resp = await asyncio.to_thread(lambda: profile_query.execute())

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
            "email": email,
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
        logger.error(f"Error de autenticación: {e}")
        raise HTTPException(status_code=401, detail="Error de autenticación")


async def _verify_token(token: str) -> tuple[str, str | None]:
    """
    Verifica el JWT y retorna (user_id, email).
    Si SUPABASE_JWT_SECRET está configurado, verifica localmente (sin roundtrip
    de red). Si no, cae al flujo anterior contra Supabase Auth.
    """
    # La verificación local solo aplica a tokens firmados con HS256 (el secreto
    # compartido "legacy"). Proyectos de Supabase con las claves de firma nuevas
    # (asimétricas, ES256/RS256) emiten tokens que este secreto NO puede validar
    # — en ese caso se cae automáticamente al flujo remoto, igual que si
    # SUPABASE_JWT_SECRET no estuviera configurado.
    alg = None
    if settings.supabase_jwt_secret:
        try:
            alg = jose_jwt.get_unverified_header(token).get("alg")
        except JWTError:
            alg = None

    if settings.supabase_jwt_secret and alg == "HS256":
        try:
            payload = jose_jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
        except JWTError as e:
            # Logueado con el motivo exacto (firma inválida, expirado, audiencia
            # incorrecta, etc.) — al cliente solo le llega "Token inválido".
            logger.error(f"Verificación local de JWT falló ({type(e).__name__}): {e}")
            raise HTTPException(status_code=401, detail="Token inválido")
        return payload["sub"], payload.get("email")

    # Fallback: verificación remota contra Supabase Auth (bloqueante → threadpool)
    user_resp = await asyncio.to_thread(supabase.auth.get_user, token)
    if not user_resp or not user_resp.user:
        raise HTTPException(status_code=401, detail="Token inválido")
    return user_resp.user.id, user_resp.user.email


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
