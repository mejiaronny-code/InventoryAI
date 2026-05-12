"""
app/embeddings/embedding_service.py
Pipeline de embeddings con text-embedding-3-small de OpenAI.
Se usa SOLO para generar embeddings — el chat usa Groq.
"""
from openai import AsyncOpenAI
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

# Cliente OpenAI async (solo para embeddings)
openai_client = AsyncOpenAI(api_key=settings.openai_api_key)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536


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


async def generate_embedding(text: str) -> list[float]:
    """
    Genera embedding para un texto usando text-embedding-3-small.
    Costo: ~$0.00002 por 1000 tokens — prácticamente gratis.
    """
    try:
        response = await openai_client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=text.strip(),
            dimensions=EMBEDDING_DIMENSIONS,
        )
        return response.data[0].embedding
    except Exception as e:
        logger.error(f"Error generando embedding: {e}")
        raise


async def generate_product_embedding(
    name: str,
    description: str = "",
    use_cases: str = ""
) -> list[float]:
    """
    Genera el embedding para un producto dado sus campos textuales.
    Llamar al crear o actualizar nombre/description/use_cases.
    """
    text = build_product_text(name, description, use_cases)
    return await generate_embedding(text)


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
