"""
app/core/supabase_client.py
Cliente de Supabase usando service role key (bypass RLS para backend)
"""
from supabase import create_client, Client
from app.core.config import settings
from functools import lru_cache


@lru_cache()
def get_supabase() -> Client:
    """
    Retorna cliente Supabase con service role key.
    El backend siempre filtra manualmente por company_id —
    el service role bypasea RLS, así que la seguridad recae en el código.
    """
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key
    )


@lru_cache()
def get_supabase_auth() -> Client:
    """
    Cliente SEPARADO usado SOLO para operaciones de autenticación de usuario
    (login / refresh de sesión).

    Por qué existe: `sign_in_with_password` y `refresh_session` GUARDAN la sesión
    del usuario dentro del cliente que las ejecuta. Si se usaran sobre el cliente
    de datos (`supabase`), éste empezaría a mandar el token del usuario (que
    caduca en ~1h) en vez de la service-role key (que dura años) en cada consulta
    a tablas → error `PGRST303: JWT expired` ~1h después de cualquier login.
    Aislando el auth aquí, el cliente de datos nunca se contamina.
    """
    return create_client(
        settings.supabase_url,
        settings.supabase_service_role_key
    )


supabase: Client = get_supabase()
supabase_auth: Client = get_supabase_auth()
