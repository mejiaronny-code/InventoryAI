"""
app/core/service_auth.py
Autenticación de servicio para endpoints de integración (machine-to-machine).

Estos endpoints NO usan JWT de usuario — los consume el backend de Papyrus
directamente, server-to-server, con un secreto compartido en el header
`X-Service-Key`.
"""
from fastapi import Header, HTTPException
from app.core.config import settings


def verify_service_key(x_service_key: str | None = Header(default=None)) -> None:
    """
    Dependency de FastAPI: exige el header `X-Service-Key` con el valor
    configurado en `INTEGRATION_SERVICE_KEY`.

    Si `INTEGRATION_SERVICE_KEY` está vacío (no configurado), los endpoints
    quedan deshabilitados por completo (401 siempre) — esto es a propósito,
    para que no queden endpoints abiertos por accidente si alguien olvida
    configurar la variable de entorno.
    """
    if not settings.integration_service_key:
        raise HTTPException(status_code=401, detail="Integración no configurada.")
    if not x_service_key or x_service_key != settings.integration_service_key:
        raise HTTPException(status_code=401, detail="Service key inválida.")
