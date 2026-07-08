"""
app/routers/chat.py
Endpoints del chat IA.
- POST /chat/message → chat de texto (llama-3.3-70b)
- POST /chat/image → búsqueda por imagen (llama-4-scout, solo cuando hay imagen)
"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import StreamingResponse
import base64
import imghdr
import json
import logging
from datetime import date, datetime
from collections import defaultdict
import threading

logger = logging.getLogger(__name__)

from app.models.schemas import ChatMessage, ChatResponse
from app.agents.chat_agent import chat, chat_with_image, chat_stream
from app.core.supabase_client import supabase
from app.core.company_features import get_active_company, require_public_catalog
from app.services.transcription import transcribe_audio, ALLOWED_AUDIO_TYPES, MAX_AUDIO_SIZE

router = APIRouter(prefix="/chat", tags=["chat"])


# ── Rate limiter en memoria ───────────────────────────────────────────
# Estructura: { "company_slug": { "2024-01-15": 42 } }
# Se resetea automáticamente cada día nuevo.
_DEFAULT_DAILY_LIMIT = 200
_counts: dict[str, dict[str, int]] = defaultdict(dict)
_counts_lock = threading.Lock()

# Cache del límite por empresa para no ir a la DB en cada mensaje
# { "company_slug": limit_int }  — se invalida al reiniciar el server
_limit_cache: dict[str, int] = {}

# ── Rate limiter por IP (anti-bot / anti-ráfaga) ──────────────────────
# Además del tope diario por empresa, limita cuántas peticiones puede hacer
# UNA misma IP por minuto. Evita que un bot agote la cuota de una empresa
# legítima en segundos o dispare ráfagas de requests.
# Estructura: { "ip": { "2024-01-15T14:30": 7 } }
_IP_LIMIT_PER_MIN = 15
_ip_counts: dict[str, dict[str, int]] = defaultdict(dict)
_ip_lock = threading.Lock()
_ip_request_counter = 0   # para el barrido global periódico


def _client_ip(request: Request) -> str:
    """IP real del cliente. En Railway/Vercel la IP viene en X-Forwarded-For."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_ip_rate_limit(request: Request) -> None:
    """Lanza HTTP 429 si una IP supera _IP_LIMIT_PER_MIN peticiones por minuto."""
    global _ip_request_counter
    ip = _client_ip(request)
    minute = datetime.utcnow().strftime("%Y-%m-%dT%H:%M")

    with _ip_lock:
        _ip_request_counter += 1
        # Barrido global cada 500 requests: borra IPs cuyos conteos ya son viejos,
        # para no acumular memoria indefinidamente (Redis sería la solución a escala).
        if _ip_request_counter % 500 == 0:
            for old_ip in [i for i, b in _ip_counts.items() if all(m != minute for m in b)]:
                del _ip_counts[old_ip]

        bucket = _ip_counts[ip]
        # Borrar minutos viejos de esta IP
        for m in [m for m in bucket if m != minute]:
            del bucket[m]

        current = bucket.get(minute, 0)
        if current >= _IP_LIMIT_PER_MIN:
            raise HTTPException(
                status_code=429,
                detail="Demasiadas solicitudes en poco tiempo. "
                       "Espera un momento e intenta de nuevo.",
            )
        bucket[minute] = current + 1


# Tope de longitud para textos libres del chat (el schema ya lo aplica al
# campo `message`; aquí se reutiliza para el `user_text` de la búsqueda por imagen).
_MAX_CHAT_TEXT_LEN = 2000


def _get_daily_limit(company_slug: str) -> int:
    """Lee el límite desde el cache; si no está, consulta la DB."""
    if company_slug in _limit_cache:
        return _limit_cache[company_slug]
    try:
        res = supabase.table("companies")\
            .select("settings")\
            .eq("slug", company_slug)\
            .single()\
            .execute()
        limit = (res.data or {}).get("settings", {}).get("chat_daily_limit", _DEFAULT_DAILY_LIMIT)
        _limit_cache[company_slug] = int(limit)
    except Exception:
        _limit_cache[company_slug] = _DEFAULT_DAILY_LIMIT
    return _limit_cache[company_slug]


def _check_rate_limit(company_slug: str) -> None:
    """
    Lanza HTTP 429 si la empresa superó su límite diario configurado.
    Limpia conteos de días anteriores para no acumular memoria.
    """
    today = date.today().isoformat()
    limit = _get_daily_limit(company_slug)

    with _counts_lock:
        company = _counts[company_slug]

        # Borrar días viejos para no acumular
        stale = [d for d in company if d != today]
        for d in stale:
            del company[d]

        current = company.get(today, 0)
        if current >= limit:
            raise HTTPException(
                status_code=429,
                detail=f"Límite de {limit} mensajes diarios alcanzado. "
                       "Se renueva automáticamente mañana.",
            )
        company[today] = current + 1


async def _check_public_catalog(company_slug: str) -> None:
    """Lanza 404 si la empresa desactivó el catálogo público (incluye el chat IA)."""
    company = await get_active_company(company_slug)
    require_public_catalog(company)


@router.post("/message", response_model=ChatResponse)
async def send_message(data: ChatMessage, request: Request):
    """
    Procesa un mensaje de chat de texto.
    Usa llama-3.3-70b-versatile via Groq.
    """
    if not data.message.strip():
        raise HTTPException(400, "El mensaje no puede estar vacío")

    _check_ip_rate_limit(request)
    await _check_public_catalog(data.company_slug)
    _check_rate_limit(data.company_slug)

    response, used_tools = await chat(
        session_id=data.session_id,
        message=data.message,
        company_slug=data.company_slug,
    )

    return ChatResponse(
        response=response,
        session_id=data.session_id,
        used_tools=used_tools,
    )


@router.post("/message/stream")
async def send_message_stream(data: ChatMessage, request: Request):
    """
    Igual que /chat/message pero streamea la respuesta como Server-Sent Events
    (SSE) — el texto llega en fragmentos conforme el modelo lo genera, en vez de
    esperar la respuesta completa. Mismas validaciones y límites que /message.
    """
    if not data.message.strip():
        raise HTTPException(400, "El mensaje no puede estar vacío")

    _check_ip_rate_limit(request)
    await _check_public_catalog(data.company_slug)
    _check_rate_limit(data.company_slug)

    async def event_generator():
        try:
            async for event in chat_stream(
                session_id=data.session_id,
                message=data.message,
                company_slug=data.company_slug,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Error en stream de chat: {e}")
            yield f"data: {json.dumps({'error': 'Ocurrió un error procesando el mensaje.'})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/image", response_model=ChatResponse)
async def send_image_message(
    request: Request,
    session_id: str = Form(...),
    company_slug: str = Form(...),
    user_text: str = Form(default="¿Qué producto es este y cuánto cuesta?"),
    image: UploadFile = File(...),
):
    """
    Procesa un mensaje con imagen para buscar productos similares.
    
    Este endpoint se activa ÚNICAMENTE cuando el usuario sube una imagen
    buscando un producto. Usa meta-llama/llama-4-scout-17b-16e-instruct
    para analizar la imagen, luego busca en pgvector.
    
    El modelo llama-4-scout solo se activa aquí — el chat de texto
    siempre usa llama-3.3-70b-versatile.
    """
    # Validar que sea una imagen
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(400, "El archivo debe ser una imagen")

    if user_text and len(user_text) > _MAX_CHAT_TEXT_LEN:
        raise HTTPException(400, f"El texto no puede superar {_MAX_CHAT_TEXT_LEN} caracteres")

    # Leer y convertir a base64
    image_bytes = await image.read()
    if len(image_bytes) > 10 * 1024 * 1024:  # 10MB máximo
        raise HTTPException(400, "La imagen no puede superar 10MB")

    _check_ip_rate_limit(request)
    await _check_public_catalog(company_slug)
    _check_rate_limit(company_slug)

    image_base64 = base64.b64encode(image_bytes).decode("utf-8")
    media_type = image.content_type or "image/jpeg"

    response, used_tools = await chat_with_image(
        session_id=session_id,
        company_slug=company_slug,
        image_base64=image_base64,
        image_media_type=media_type,
        user_text=user_text,
    )

    return ChatResponse(
        response=response,
        session_id=session_id,
        used_tools=used_tools,
    )


@router.post("/audio", response_model=ChatResponse)
async def send_audio_message(
    request: Request,
    session_id: str = Form(...),
    company_slug: str = Form(...),
    audio: UploadFile = File(...),
):
    """
    Transcribe una nota de voz con Whisper y la procesa DIRECTO como mensaje de chat
    (sin posibilidad de revisión humana antes de enviarse).

    ⚠️ Pensado para integraciones automatizadas donde NO hay UI para que el
    usuario revise el texto (ej. WhatsApp voice notes vía n8n). Whisper puede
    "alucinar" texto fluido en otro idioma cuando el audio es corto/silencioso/
    ruidoso — en flujos con interfaz, usa /chat/transcribe + que el usuario
    confirme/edite, y luego /chat/message.

    Flujo:
      1. Valida formato y tamaño del audio
      2. Transcribe con DeepInfra Whisper large-v3-turbo
      3. Envía el texto transcrito al agente IA (mismo que /chat/message)
      4. Cuenta en el rate limit diario igual que un mensaje de texto
    """
    _check_ip_rate_limit(request)

    # Validar tipo de archivo
    ct = (audio.content_type or "audio/webm").split(";")[0].strip()
    if ct not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Formato de audio no soportado: {ct}. "
                   f"Formatos válidos: webm, ogg, mp4, mp3, wav, flac.",
        )

    # Leer y validar tamaño
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="El archivo de audio está vacío.")
    if len(audio_bytes) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=413, detail="El audio no puede superar 25 MB.")

    # Transcribir
    try:
        transcribed_text = await transcribe_audio(
            audio_bytes,
            audio.filename or "audio.webm",
            audio.content_type or "audio/webm",
        )
    except Exception as e:
        logger.error(f"Error transcribiendo audio: {e}")
        raise HTTPException(status_code=502, detail="Error en el servicio de transcripción.")

    if not transcribed_text:
        raise HTTPException(status_code=422, detail="No se pudo detectar voz en el audio.")

    # Contar en el rate limit (igual que un mensaje de texto)
    await _check_public_catalog(company_slug)
    _check_rate_limit(company_slug)

    # Procesar como mensaje de chat normal
    response, used_tools = await chat(
        session_id=session_id,
        message=transcribed_text,
        company_slug=company_slug,
    )

    return ChatResponse(
        response=response,
        session_id=session_id,
        used_tools=used_tools,
        transcribed_text=transcribed_text,
    )


@router.post("/transcribe")
async def transcribe_only(
    request: Request,
    company_slug: str = Form(...),
    audio: UploadFile = File(...),
):
    """
    Transcribe una nota de voz SIN enviarla al agente IA.

    Pensado para flujos donde el usuario debe revisar/editar el texto
    antes de mandarlo (ej. botón de micrófono en el chat del catálogo):
    Whisper a veces "alucina" texto fluido en otro idioma cuando el audio
    es corto, silencioso o con ruido — por eso NUNCA se debe enviar
    directo al agente sin que el usuario lo confirme.

    No cuenta para el rate limit diario — el conteo ocurre cuando el
    usuario realmente envía el mensaje (vía /chat/message).
    """
    ct = (audio.content_type or "audio/webm").split(";")[0].strip()
    if ct not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Formato de audio no soportado: {ct}. "
                   f"Formatos válidos: webm, ogg, mp4, mp3, wav, flac.",
        )

    _check_ip_rate_limit(request)
    await _check_public_catalog(company_slug)

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="El archivo de audio está vacío.")
    if len(audio_bytes) > MAX_AUDIO_SIZE:
        raise HTTPException(status_code=413, detail="El audio no puede superar 25 MB.")

    try:
        transcribed_text = await transcribe_audio(
            audio_bytes,
            audio.filename or "audio.webm",
            audio.content_type or "audio/webm",
        )
    except Exception as e:
        logger.error(f"Error transcribiendo audio: {e}")
        raise HTTPException(status_code=502, detail="Error en el servicio de transcripción.")

    if not transcribed_text:
        raise HTTPException(status_code=422, detail="No se pudo detectar voz en el audio. Intenta hablar más cerca del micrófono.")

    return {"transcribed_text": transcribed_text}
