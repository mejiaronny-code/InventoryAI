"""
app/embeddings/embedding_service.py
Pipeline de embeddings con Qwen3-Embedding-8B via DeepInfra.
Reemplaza text-embedding-3-small de OpenAI.

Ventajas:
  - 2× más barato: $0.010 vs $0.020 por 1M tokens
  - Mejor calidad: MTEB English 75.22 vs ~62 de OpenAI
  - Mismo proveedor que el chat (DeepInfra) — menos dependencias
  - Instruction-aware: mejor retrieval con prefijos de instrucción
  - Contexto 4× mayor: 32k tokens
"""
from openai import AsyncOpenAI
from app.core.config import settings
import logging
import asyncio

logger = logging.getLogger(__name__)

# ── Cliente DeepInfra (API compatible con OpenAI) ─────────────────────
deepinfra_client = AsyncOpenAI(
    api_key=settings.deepinfra_api_key,
    base_url="https://api.deepinfra.com/v1/openai",
)

EMBEDDING_MODEL      = "Qwen/Qwen3-Embedding-8B"
EMBEDDING_DIMENSIONS = 1536   # MRL: misma dim que antes → sin migración de BD

# Instrucción para consultas de búsqueda (NO se usa en documentos).
# Qwen3-Embedding es instruction-aware: añadir el prefijo al query
# mejora significativamente la precisión de retrieval.
_QUERY_INSTRUCTION = (
    "Instruct: Busca productos en un catálogo de inventario que "
    "coincidan con la siguiente descripción o nombre\nQuery: "
)


def build_product_text(name: str, description: str = "", use_cases: str = "") -> str:
    """
    Concatena los campos textuales del producto en un string para embedding.
    Solo se incluyen campos semánticamente ricos — NO precio ni SKU.
    """
    parts = [name]
    if description:
        parts.append(description)
    if use_cases:
        parts.append(f"Usos: {use_cases}")
    return ". ".join(filter(None, parts))


async def generate_embedding(text: str, is_query: bool = True) -> list[float]:
    """
    Genera embedding para un texto.

    Args:
        text:      El texto a embeber.
        is_query:  True cuando es una consulta de búsqueda (añade prefijo de
                   instrucción para mejor retrieval). False para documentos
                   (nombres/descripciones de productos).
    """
    try:
        input_text = (_QUERY_INSTRUCTION + text.strip()) if is_query else text.strip()
        response = await deepinfra_client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=input_text,
            dimensions=EMBEDDING_DIMENSIONS,
            encoding_format="float",
        )
        return response.data[0].embedding
    except Exception as e:
        logger.error(f"Error generando embedding con DeepInfra: {e}")
        raise


async def generate_product_embedding(
    name: str,
    description: str = "",
    use_cases: str = ""
) -> list[float]:
    """
    Genera el embedding para un producto dado sus campos textuales.
    Llamar al crear o actualizar nombre/description/use_cases.
    Los documentos NO llevan prefijo de instrucción.
    """
    text = build_product_text(name, description, use_cases)
    return await generate_embedding(text, is_query=False)


async def warmup_embedding_model() -> None:
    """
    Mantiene el modelo de embeddings caliente en DeepInfra.
    Llamar periódicamente para evitar cold starts.
    """
    try:
        await generate_embedding("warmup", is_query=False)
        logger.info("Embedding model warm-up OK")
    except Exception as e:
        logger.warning(f"Embedding warm-up falló (no crítico): {e}")


async def start_warmup_loop(interval_seconds: int = 600) -> None:
    """
    Loop infinito que hace warm-up cada `interval_seconds` (default: 10 min).
    Correr como asyncio background task desde el lifespan de FastAPI.
    """
    # Esperar 30s al inicio para que el servidor esté completamente listo
    await asyncio.sleep(30)
    while True:
        await warmup_embedding_model()
        await asyncio.sleep(interval_seconds)


def should_regenerate_embedding(old_data: dict, new_data: dict) -> bool:
    """
    Determina si se debe regenerar el embedding.
    Solo si cambiaron campos semánticos (name, description, use_cases).
    Nunca regenerar por cambio de precio, stock, SKU, etc.
    """
    semantic_fields = {"name", "description", "use_cases"}
    for field in semantic_fields:
        if field in new_data and new_data[field] != old_data.get(field):
            return True
    return False
