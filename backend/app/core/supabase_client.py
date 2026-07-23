"""
app/core/supabase_client.py
Cliente de Supabase usando service role key (bypass RLS para backend)
"""
from supabase import create_client, Client
from app.core.config import settings
from functools import lru_cache
import asyncio
import time
import httpx


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

_RETRYABLE = (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError)
_RETRYABLE_NON_IDEMPOTENT = (httpx.ConnectError,)


async def run_with_retry(fn, retries: int = 2, idempotent: bool = True):
    """
    Ejecuta una llamada a Supabase (ej. `lambda: query.execute()`) y reintenta
    si la conexión HTTP/2 se corta a medio camino (`RemoteProtocolError` y
    primos). Supabase a veces cierra conexiones inactivas; sin retry, eso se
    traduce en un 500 al cliente por un simple hipo de red transitorio.
    Centralizado aquí para que cualquier router lo reutilice (antes vivía
    duplicado solo en `routers/reorder.py`).
    """
    retryable = _RETRYABLE if idempotent else _RETRYABLE_NON_IDEMPOTENT
    for attempt in range(retries + 1):
        try:
            return await asyncio.to_thread(fn)
        except retryable:
            if attempt == retries:
                raise
            await asyncio.sleep(0.3 * (attempt + 1))

# Para mutaciones NO idempotentes (decrementos de stock, inserts de
# movimientos/reservas): un ReadError o RemoteProtocolError puede ocurrir
# DESPUÉS de que Postgres ya procesó y confirmó la escritura — reintentar
# en ese caso duplicaría el efecto (doble decremento, doble fila de
# auditoría). ConnectError en cambio significa que la conexión nunca se
# estableció, así que la request nunca llegó al servidor: siempre es
# seguro reintentar.
def run_with_retry_sync(fn, retries: int = 2, idempotent: bool = True):
    """
    Gemela síncrona de `run_with_retry`, para usar DENTRO de funciones que ya
    corren en un hilo aparte (las que se invocan vía `asyncio.to_thread` desde
    un router — ej. `stock.py::_create_movement_sync`). No se puede usar
    `await`/`asyncio.sleep` ahí porque no hay event loop en ese hilo.

    `idempotent=False` para mutaciones que NO se pueden reintentar a ciegas
    (ver `_RETRYABLE_NON_IDEMPOTENT`) — usar en decrementos/inserts de un
    solo uso, no en lecturas ni en updates que fijan un valor absoluto.
    """
    retryable = _RETRYABLE if idempotent else _RETRYABLE_NON_IDEMPOTENT
    for attempt in range(retries + 1):
        try:
            return fn()
        except retryable:
            if attempt == retries:
                raise
            time.sleep(0.3 * (attempt + 1))
