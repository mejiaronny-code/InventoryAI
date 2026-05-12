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


supabase: Client = get_supabase()
