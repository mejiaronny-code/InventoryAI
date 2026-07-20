"""
app/core/net.py
Resolución de la IP real del cliente detrás del proxy de Railway.
"""
from fastapi import Request


def client_ip(request: Request) -> str:
    """
    IP real del cliente para rate limiting anti-abuso.

    Supuesto: 1 proxy de confianza delante de la app (Railway). Railway
    AÑADE la IP real del cliente al FINAL de X-Forwarded-For — el PRIMER
    valor del header lo pone el cliente y es arbitrario (cualquiera puede
    mandar `X-Forwarded-For: 1.2.3.4` y saltarse el rate limit por IP tomando
    el primer valor). Por eso se toma el ÚLTIMO elemento, no el primero.
    Si se agrega otro proxy/CDN delante de Railway (Cloudflare, etc.), hay
    que revisar este índice.
    """
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        parts = [p.strip() for p in fwd.split(",") if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else "unknown"
