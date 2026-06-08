"""
app/services/transcription.py
Transcripción de audio con DeepInfra Whisper large-v3-turbo.
Usado por /chat/audio para convertir notas de voz en texto.
"""
import httpx
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

WHISPER_MODEL = "openai/whisper-large-v3-turbo"
WHISPER_URL   = "https://api.deepinfra.com/v1/openai/audio/transcriptions"

ALLOWED_AUDIO_TYPES = {
    "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg",
    "audio/wav", "audio/x-wav", "audio/flac",
    "video/webm", "audio/mp3", "audio/ogg; codecs=opus",
}
MAX_AUDIO_SIZE = 25 * 1024 * 1024  # 25 MB


async def transcribe_audio(audio_bytes: bytes, filename: str, content_type: str) -> str:
    """
    Envía el audio a DeepInfra Whisper y retorna el texto transcrito.
    Lanza HTTPException si el servicio falla.
    """
    # Normalizar content_type (quitar parámetros como "; codecs=opus")
    clean_ct = content_type.split(";")[0].strip()

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            WHISPER_URL,
            headers={"Authorization": f"Bearer {settings.deepinfra_api_key}"},
            files={"file": (filename, audio_bytes, clean_ct)},
            data={"model": WHISPER_MODEL},
        )
        resp.raise_for_status()
        return resp.json().get("text", "").strip()
