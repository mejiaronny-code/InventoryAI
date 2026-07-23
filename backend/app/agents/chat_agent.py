"""
app/agents/chat_agent.py
Chat de inventario usando DeepInfra (OpenAI-compatible API).
- Chat: Qwen/Qwen3-30B-A3B (MoE — rápido y capaz, soporta tool calling)
- Vision: Qwen/Qwen2.5-VL-32B-Instruct (comparación visual real)
- Loop agéntico propio
- Memoria: historial por sesión
"""
import asyncio
import json
import logging
import os
import base64
import time
from datetime import datetime, timezone
from typing import Optional

from openai import AsyncOpenAI

from app.core.config import settings
from app.core.supabase_client import supabase, run_with_retry
from app.agents.tools import create_inventory_tools

# LangSmith tracing (opcional)
os.environ["LANGCHAIN_TRACING_V2"] = str(settings.langchain_tracing_v2).lower()
os.environ["LANGCHAIN_API_KEY"]    = settings.langchain_api_key
os.environ["LANGCHAIN_PROJECT"]    = settings.langchain_project

logger = logging.getLogger(__name__)

# ── Modelos DeepInfra ─────────────────────────────────────────────────
DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai"
CHAT_MODEL   = "Qwen/Qwen3.6-35B-A3B"
VISION_MODEL = "Qwen/Qwen3.6-35B-A3B"  # mismo modelo — es multimodal

# ── Mapa de monedas (igual que el frontend) ───────────────────────────
CURRENCY_SYMBOLS: dict[str, str] = {
    "USD": "$",   "EUR": "€",   "MXN": "$",   "COP": "$",
    "ARS": "$",   "CLP": "$",   "PEN": "S/",  "BRL": "R$",
    "GTQ": "Q",   "HNL": "L",   "CRC": "₡",   "DOP": "RD$",
    "BOB": "Bs",  "PYG": "₲",   "UYU": "$U",  "VES": "Bs.",
    "PAB": "B/.", "NIO": "C$",  "JPY": "¥",
}

def _currency_symbol(code: str) -> str:
    return CURRENCY_SYMBOLS.get(code, "$")

# ── Cliente DeepInfra (singleton) ────────────────────────────────────
def _client() -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=settings.deepinfra_api_key,
        base_url=DEEPINFRA_BASE_URL,
    )

# ── Contexto de empresa por slug (cache con TTL) ─────────────────────
# `chat()`/`chat_stream()` hacían 2 queries SERIALES y BLOQUEANTES a
# `companies` en cada mensaje (una para settings/features, otra para el
# estado de la suscripción) — con 30-60s de latencia visible cuando el
# modelo estaba lento, esas dos consultas se sumaban a cada mensaje. Se
# unifican en una sola query con join + se cachean por slug ~60s (los
# datos de empresa casi no cambian mensaje a mensaje).
_company_cache: dict[str, tuple[float, dict]] = {}
_COMPANY_CACHE_TTL = 60.0


async def _get_company_context(company_slug: str) -> dict | None:
    """Retorna {id, name, settings, features, subscription_status} o None si no existe/inactiva."""
    cached = _company_cache.get(company_slug)
    if cached and (time.monotonic() - cached[0]) < _COMPANY_CACHE_TTL:
        return cached[1]

    query = supabase.table("companies") \
        .select("id, name, settings, features, subscription_id, subscriptions(status)") \
        .eq("slug", company_slug) \
        .eq("is_active", True) \
        .single()
    resp = await run_with_retry(lambda: query.execute())
    if not resp.data:
        return None

    sub = resp.data.get("subscriptions") or {}
    context = {
        "id": resp.data["id"],
        "name": resp.data["name"],
        "settings": resp.data.get("settings") or {},
        "features": resp.data.get("features") or {},
        "subscription_status": sub.get("status"),
    }
    _company_cache[company_slug] = (time.monotonic(), context)
    return context


# ── Historial de conversación por sesión ─────────────────────────────
# Cada sesión individual ya se poda a _STORE_LIMIT mensajes (abajo), pero el
# DICCIONARIO en sí (una entrada por session_id que haya escrito alguna vez)
# nunca se achicaba — con tráfico público sostenido (cada visitante nuevo del
# catálogo genera un session_id) esto crece sin límite hasta el próximo
# deploy. Es efímero por diseño (vive en memoria de un solo proceso, se borra
# igual en cada deploy/restart) — esta poda solo evita que crezca sin límite
# ENTRE deploys.
_history_store: dict[str, list] = {}
_history_last_seen: dict[str, float] = {}
_HISTORY_MAX_SESSIONS = 2000
_HISTORY_TTL_SECONDS = 6 * 3600  # 6 horas de inactividad


def _history_key(company_id: str, session_id: str) -> str:
    """Una sesión del navegador nunca comparte contexto entre empresas."""
    return f"{company_id}:{session_id}"


def _touch_history(history_key: str) -> None:
    _history_last_seen[history_key] = time.monotonic()
    if len(_history_store) > _HISTORY_MAX_SESSIONS:
        _prune_history_store()


def _prune_history_store() -> None:
    now = time.monotonic()
    stale = [sid for sid, ts in _history_last_seen.items() if now - ts > _HISTORY_TTL_SECONDS]
    for sid in stale:
        _history_store.pop(sid, None)
        _history_last_seen.pop(sid, None)
    overflow = len(_history_store) - _HISTORY_MAX_SESSIONS
    if overflow > 0:
        oldest = sorted(_history_last_seen, key=_history_last_seen.get)[:overflow]
        for sid in oldest:
            _history_store.pop(sid, None)
            _history_last_seen.pop(sid, None)
        stale.extend(oldest)
    if stale:
        logger.info(f"_history_store: podadas {len(stale)} sesiones inactivas ({len(_history_store)} restantes)")

# Cuántos mensajes se envían al modelo / se conservan por sesión.
# Las tools inflan el historial (assistant tool_calls + tool result), así que
# se necesita una ventana amplia para no perder el contexto del pedido.
_SEND_WINDOW = 30
_STORE_LIMIT = 50

def _safe_window(history: list, n: int = _SEND_WINDOW) -> list:
    """Últimos n mensajes, sin empezar con un 'tool' huérfano (rompería la API)."""
    win = history[-n:]
    while win and win[0].get("role") == "tool":
        win = win[1:]
    return win

# ── Prompt del sistema ────────────────────────────────────────────────
SYSTEM_PROMPT = """Eres el asistente de inventario de "{company_name}". Ayudas a clientes a buscar productos, consultar stock y hacer reservas.

{custom_rules_section}REGLAS GENERALES:
- Antes de responder sobre productos, precios o stock SIEMPRE llama al tool correspondiente. Nunca inventes datos.
- ⚠️ CRÍTICO — RECOMENDACIONES: Si el cliente pide una recomendación o sugerencia para una actividad, situación, ocasión o necesidad (ej. "qué me recomiendas para ir a la playa", "busco algo para regalar", "necesito algo para acampar", "qué tienen para una fiesta"), tu PRIMERA acción SIEMPRE debe ser llamar a search_products usando esa frase o palabras clave de la situación como query. NUNCA respondas con tipos de producto genéricos de tu propio conocimiento (ej. "te recomiendo sombrillas, protector solar, toallas...") — eso casi siempre será INCORRECTO porque esos productos pueden no existir en este catálogo. Solo después de buscar, recomienda lo que el tool realmente encontró. Si no hay resultados relevantes, dilo claramente — NUNCA inventes alternativas.
- Si search_products no devuelve resultados relevantes en 1 búsqueda, NO sigas buscando el mismo tema con sinónimos. Responde: "No tenemos [lo que busca] en nuestro catálogo."
- Si ya encontraste un producto en una búsqueda anterior y el cliente pide ver una variante (color, talla) de ese mismo producto, NO hagas una nueva búsqueda. Usa los datos que ya tienes — el bloque de opciones ya tiene las imágenes por color.
- Responde en el idioma del cliente. Sé breve y amigable.
- Los tools devuelven referencias internas como [ref:uuid] — NUNCA las muestres al cliente. Son solo para uso interno del agente.
- Al mostrar productos incluye SIEMPRE: nombre en negrita, precio con la moneda correcta, disponibilidad, y si el tool devuelve una imagen en formato ![nombre](url) DEBES incluirla tal cual en tu respuesta, nunca la omitas. Copia la URL de la imagen COMPLETA, nunca la cortes ni la abrevies.
- ⚠️ FORMATO EXACTO por producto (repite este patrón IDÉNTICO para CADA producto de la lista, sea el primero o el último — no lo relajes en los últimos ítems). Esto aplica SOLO cuando el cliente NO pidió un color/talla/variante específica — si sí lo pidió, sigue la sección "COLORES, TALLAS Y VARIANTES" de abajo en su lugar (que usa un formato distinto y evita duplicar la imagen):
  • **Nombre del producto**
  ![Nombre del producto](url-completa-de-la-imagen-si-el-tool-la-dio)
  Precio: [precio] / [unidad]
  [línea de disponibilidad]
  NUNCA escribas el nombre del producto en una línea suelta fuera de este patrón — eso lo duplica y confunde al cliente. Si el tool no dio imagen para ese producto, omite solo la línea de imagen, pero nunca el resto.
  ⚠️ AUTO-VERIFICACIÓN OBLIGATORIA antes de enviar tu respuesta: repasa producto por producto y confirma que CADA UNO tenga su línea ![nombre](url) si el tool te la dio — incluyendo el primero de la lista, no solo los últimos. Es un error común olvidarla en algún producto intermedio; revisa todos antes de responder. También confirma que NINGUNA imagen se repita dos veces en la misma respuesta.
- Muestra como MÁXIMO 3 productos por respuesta (cada uno con su imagen). Si hay más resultados relevantes, dilo brevemente y ofrece afinar la búsqueda ("¿buscas algo en particular?"). Así la respuesta es clara, nunca se corta, y es más fácil no equivocarte con el formato de cada uno.
- Para ubicaciones: reporta exactamente lo que diga el tool. Si no está registrada, díselo.
- INFORMACIÓN DE LA EMPRESA: si el cliente pregunta algo institucional — horarios de atención, ubicación de sucursales, políticas de devolución/garantía, métodos de pago, envíos, preguntas frecuentes — usa search_company_info (NO inventes esto, NO lo confundas con búsqueda de productos). Responde basándote ÚNICAMENTE en lo que el tool devuelva. Si no encuentra nada, dile al cliente que no tienes esa información disponible y sugiérele contactar directamente a la empresa.
- ⚠️ CRÍTICO — "¿QUÉ ME OFRECES / QUÉ TIENEN / QUÉ VENDEN?": Cuando el cliente pregunta de forma general qué ofrece la tienda, qué productos tienen, qué vende la empresa, o pide ver el catálogo/opciones disponibles — ESO ES UNA BÚSQUEDA DE PRODUCTOS, no una pregunta institucional. Llama a search_products con query="" (vacío) — esto activa el modo "explorar catálogo" y devuelve una muestra real de productos activos, sin inventar una frase de búsqueda. NUNCA inventes términos de búsqueda como "productos destacados" o "novedades" — esas palabras casi nunca coinciden con nada en la búsqueda semántica, y el cliente puede interpretar el resultado vacío como que literalmente no tienes "destacados" o "novedades" (categorías que nunca existieron). NUNCA respondas que "no tienes información sobre los productos" sin antes haber llamado a search_products — el catálogo puede tener productos aunque la Base de Conocimiento institucional esté vacía. Solo usa search_company_info para preguntas claramente institucionales (horarios, ubicación, políticas, métodos de pago, envíos).

COLORES, TALLAS Y VARIANTES:
- ⚠️ La imagen junto al nombre del producto (arriba, junto a "• **Nombre**") es SOLO representativa y con frecuencia es EXACTAMENTE LA MISMA que la de uno de los colores del bloque "Opciones disponibles". Si el cliente pregunta por colores/tallas o pide uno específico, NO muestres esa imagen representativa en absoluto — arranca tu respuesta directo con el texto/frase, sin `![...]` antes del bloque de colores, y usa ÚNICAMENTE las imágenes del bloque "Opciones disponibles" (una por cada color/talla). Mostrar ambas es un ERROR porque suele ser la misma imagen repetida dos veces.
- Cuando el cliente pide un color, talla, material u otra variante específica, busca los productos y luego analiza el bloque "Opciones disponibles" de cada resultado.
- Muestra SOLO los productos que tengan esa opción marcada con ✓ (con stock). Si hay imagen para ese color, muéstrala.
- Si un producto tiene el color/talla pedido marcado como ~~tachado~~ significa que no hay stock de esa variante — no lo ofrezcas.
- Si ningún producto tiene la variante pedida con stock, díselo claramente: "No tenemos [producto] en [color/talla] actualmente."
- Si los resultados no muestran bloque de opciones para ningún producto, significa que el inventario no tiene esa información registrada. En ese caso responde: "Encontramos [productos] pero no tenemos registrado si vienen en [color/talla] específico. Te recomendamos consultar directamente en tienda."
- Cuando el cliente pregunta "¿qué colores/tallas tiene?" muestra TODAS las opciones disponibles con sus imágenes si las tiene.
- Si pregunta por un color específico y el producto lo tiene, muestra SOLO la imagen de ese color (no todas).
- ⚠️ FORMATO al mostrar VARIOS colores/tallas del MISMO producto (ej. "¿qué otros colores tienen?"): NO repitas el bloque completo (nombre, precio, disponibilidad) por cada color — es el mismo producto, sería redundante. En vez de eso, escribe UNA frase natural que los presente juntos (ej. "Tenemos la Mochila JanSport en Morado y Azul, ambas a L800.00, disponibles:") y luego coloca cada imagen de color seguida. El precio y la disponibilidad se mencionan UNA sola vez para el grupo, no por cada color.

CONTEXTO DE IMAGEN: Si en el historial hay un mensaje con [PRODUCTO_ID:uuid], ese es el producto que el cliente vio en la imagen que envió. Si el cliente pide "muestramela", "más detalles", "cuéntame más", "ese mismo", "ese producto" u expresión similar, llama DIRECTAMENTE a get_product_detail con ese uuid — NO hagas una búsqueda nueva.

PARA RESERVAR: pide primero nombre completo y email. Verifica stock. Solo entonces llama create_reservation. Muestra el código y la fecha de expiración. Si el cliente eligió un color, talla u otra variante, SIEMPRE inclúyela en el parámetro notes (ej: "Color: Verde", "Color: Azul · Talla: M").

Moneda: {currency_info} — usa siempre este símbolo para precios.
{stock_rule}
{menu_section}Hoy: {current_datetime} (hora UTC — NO es la hora local del cliente, no la conoces). NUNCA asumas si es de día, tarde o noche para el cliente ni te despidas con "buenas noches/tardes/días" basándote en esta hora — usa despedidas neutrales como "¡Que tengas un buen día!" o simplemente "¡Hasta luego!".
"""

# ── Definición de tools ──────────────────────────────────────────────
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_products",
            "description": (
                "Busca productos en el inventario usando búsqueda semántica. "
                "Úsalo cuando el cliente pregunta por un producto, tipo de producto, "
                "precio o cualquier cosa relacionada con el inventario."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Texto de búsqueda del cliente",
                    },
                    "category_id": {
                        "type": ["string", "null"],
                        "description": "UUID de categoría para filtrar (opcional, omitir si no aplica)",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_product_detail",
            "description": (
                "Obtiene detalles completos de un producto: descripción, precio, "
                "stock por almacén, ubicación física y tiempo de reserva."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {"type": "string", "description": "UUID del producto"},
                },
                "required": ["product_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_stock_availability",
            "description": (
                "Obtiene el stock real disponible de un producto descontando reservas activas. "
                "Úsalo ANTES de crear una reserva para confirmar disponibilidad."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {"type": "string", "description": "UUID del producto"},
                },
                "required": ["product_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_reservation",
            "description": (
                "Crea una reserva de producto para el cliente. "
                "IMPORTANTE: Verificar stock disponible ANTES de llamar este tool. "
                "Siempre confirmar al cliente: código de reserva y fecha de expiración."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id":   {"type": "string", "description": "UUID del producto"},
                    "warehouse_id": {"type": "string", "description": "UUID del almacén con stock disponible"},
                    "quantity":     {"type": "integer", "description": "Cantidad a reservar"},
                    "client_name":  {"type": "string", "description": "Nombre completo del cliente — OBLIGATORIO, pedirlo antes"},
                    "client_email": {"type": "string", "description": "Email del cliente — OBLIGATORIO, pedirlo antes"},
                    "client_phone": {"type": ["string", "null"], "description": "Teléfono (opcional)"},
                    "notes": {"type": ["string", "null"], "description": "Opciones seleccionadas por el cliente, ej: 'Color: Verde · Talla: M'. Incluir siempre si el cliente eligió color/talla/variante."},
                },
                "required": ["product_id", "warehouse_id", "quantity", "client_name", "client_email"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_reservation",
            "description": "Cancela una reserva por su código único. Solo funciona si está pending o confirmed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reservation_code": {"type": "string", "description": "Código de reserva"},
                },
                "required": ["reservation_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reservation_status",
            "description": "Consulta el estado de una reserva por su código.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reservation_code": {"type": "string", "description": "Código de reserva"},
                },
                "required": ["reservation_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_expiring_products",
            "description": "Lista productos que vencen en los próximos N días.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": ["integer", "null"],
                        "description": "Días hacia adelante (default: 30)",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_batch_info",
            "description": "Obtiene los lotes disponibles de un producto ordenados FIFO.",
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {"type": "string", "description": "UUID del producto"},
                },
                "required": ["product_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_serial_number",
            "description": "Busca un producto por su número de serie.",
            "parameters": {
                "type": "object",
                "properties": {
                    "serial_number": {"type": "string", "description": "Número de serie"},
                },
                "required": ["serial_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_company_info",
            "description": (
                "Busca información institucional de la empresa en sus documentos "
                "(horarios, sucursales, políticas de devolución/garantía, métodos de "
                "pago, envíos, preguntas frecuentes, etc.). Úsalo para preguntas sobre "
                "la EMPRESA, no sobre productos del catálogo (para eso usa search_products)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Pregunta o tema a buscar en los documentos de la empresa",
                    },
                },
                "required": ["query"],
            },
        },
    },
]


# ── Loop agéntico ────────────────────────────────────────────────────
async def _run_agent(
    session_id: str,
    message: str,
    company_id: str,
    company_name: str,
    ai_rules: list[str] | None = None,
    currency_code: str = "USD",
    show_stock: bool = True,
    features: dict | None = None,
    company_timezone: str = "America/Tegucigalpa",
) -> tuple[str, list[str]]:
    """Loop agéntico usando DeepInfra (OpenAI-compatible)."""
    features = features or {}
    menu_mode = features.get("menu_mode", False)
    client = _client()

    history_key = _history_key(company_id, session_id)
    if history_key not in _history_store:
        _history_store[history_key] = []
    _touch_history(history_key)
    history: list = _history_store[history_key]
    history.append({"role": "user", "content": message})

    # System prompt
    if ai_rules:
        rules_text = "\n".join(f"- {r}" for r in ai_rules)
        custom_rules_section = (
            "⚠️ REGLAS OBLIGATORIAS — DEBES SEGUIRLAS EN CADA MENSAJE SIN EXCEPCIÓN:\n"
            f"{rules_text}\n\n"
        )
    else:
        custom_rules_section = ""

    symbol = _currency_symbol(currency_code)
    currency_info = f"{currency_code} (símbolo: {symbol})"
    stock_rule = (
        "- Al mostrar disponibilidad de productos NUNCA menciones cantidades exactas — "
        "solo di 'disponible' o 'sin stock'."
        if not show_stock else
        "- Puedes mostrar el número exacto de unidades en stock cuando el cliente lo pregunte."
    )

    # Sección de menú (solo restaurantes con menu_mode activo)
    if menu_mode:
        menu_section = (
            "\nMENÚ Y RESTRICCIONES ALIMENTARIAS (este negocio es un restaurante):\n"
            "- Los productos son platillos del menú. Llama a search_products para mostrarlos.\n"
            "- Si el cliente pregunta por opciones según una dieta (vegano, vegetariano, sin gluten, keto, etc.) "
            "o por alérgenos ('¿tienen algo sin lácteos?', '¿qué lleva gluten?'), busca con search_products y "
            "filtra usando los campos 'Apto:' (dieta) y 'Alérgenos:' de cada platillo. Recomienda SOLO los que "
            "cumplan, y advierte si un platillo contiene el alérgeno que el cliente quiere evitar.\n"
            "- NUNCA recomiendes ni ofrezcas un platillo marcado como '⚠️ AGOTADO HOY' — dilo si el cliente lo pide.\n"
            "- Si el cliente pregunta '¿qué me recomiendas?' o '¿cuál es el platillo del día?', usa search_products "
            "con query vacía (muestra los destacados primero).\n"
            "- LENGUAJE NATURAL DE RESTAURANTE: al preguntar cantidades de comida di '¿cuántos quieres?', "
            "'¿cuántas órdenes?' o '¿cuántas porciones?' — NUNCA digas 'unidades' (suena a inventario, no a comida). "
            "Habla como un mesero amable, no como un sistema.\n"
        )
        # Reservas/pedidos vía chat (solo si el restaurante lo tiene habilitado)
        if features.get("table_reservations") or features.get("pickup_orders"):
            modos = []
            if features.get("table_reservations"):
                modos.append("reservar mesa para comer ahí")
            if features.get("pickup_orders"):
                modos.append("pedir para recoger o pedir desde su mesa")
            menu_section += (
                "\nRESERVAS Y PEDIDOS POR CHAT — puedes ayudar al cliente a " + " y ".join(modos) + ":\n"
                "- ⚠️ Los platillos NO se gestionan por stock. NUNCA digas que un platillo está 'sin stock' ni uses "
                "get_stock_availability para decidir si se puede pedir: un platillo se puede pedir salvo que diga "
                "'AGOTADO HOY'. Para tomar el pedido usa SIEMPRE create_booking (NO create_reservation).\n"
                "- ⚠️ ANTES de create_booking SIEMPRE pide y confirma: (1) NOMBRE real del cliente y "
                "(2) un teléfono O un email de contacto. NUNCA inventes el nombre ni uses 'Cliente'. "
                "Si el cliente no te ha dado su nombre y contacto, PÍDESELOS primero.\n"
                "- Usa la tool create_booking SOLO cuando ya tengas: nombre + contacto, tipo (mesa o recoger), "
                "fecha y hora, y (si es mesa) número de personas. Si falta algún dato, PÍDELO antes de llamar la tool.\n"
                "- Para 'pedido desde la mesa' o 'ya estoy aquí', usa service_type='dine_in' con la fecha y hora ACTUAL.\n"
                "- Si el cliente quiere pre-ordenar platillos, primero búscalos con search_products para obtener su "
                "[ref:uuid], y pásalos en el parámetro items como 'ref:cantidad' separados por coma.\n"
                "- Interpreta fechas relativas ('mañana', 'hoy a las 8') usando la fecha/hora de 'Hoy' indicada abajo. "
                "Confirma con el cliente la fecha y hora exactas antes de crear la reserva.\n"
                "- Tras crear la reserva, dale SIEMPRE su código al cliente.\n"
            )
    else:
        menu_section = ""

    system_msg = {
        "role": "system",
        "content": SYSTEM_PROMPT.format(
            company_name=company_name,
            current_datetime=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            custom_rules_section=custom_rules_section,
            currency_info=currency_info,
            stock_rule=stock_rule,
            menu_section=menu_section,
        ),
    }

    tools_list = create_inventory_tools(company_id, supabase, currency_symbol=symbol, show_stock=show_stock, features=features, company_timezone=company_timezone)
    tool_map = {t.name: t for t in tools_list}
    used_tools: list[str] = []
    total_tokens_in = 0
    total_tokens_out = 0
    ref_image_map: dict[str, str] = {}

    MAX_ITERATIONS = 4
    for iteration in range(MAX_ITERATIONS):
        try:
            response = await client.chat.completions.create(
                model=CHAT_MODEL,
                messages=[system_msg] + _safe_window(history),
                tools=TOOL_DEFINITIONS,
                tool_choice="auto",
                # Margen amplio: las URLs de imagen de producto pesan ~50-70
                # tokens c/u; con 768 la respuesta se truncaba a media URL al
                # listar varios productos (la imagen quedaba rota). 1536 da aire
                # de sobra sin disparar el costo (sigue siendo un tope, no una meta).
                max_tokens=1536,
                temperature=0.2,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            )
        except Exception as e:
            err = str(e)
            logger.error(f"Error DeepInfra (iter {iteration}): {err[:200]}")
            return "Lo siento, tuve un problema técnico. Intenta de nuevo en unos segundos.", used_tools

        if response.usage:
            total_tokens_in  += response.usage.prompt_tokens     or 0
            total_tokens_out += response.usage.completion_tokens or 0

        choice = response.choices[0]
        msg = choice.message

        # ── Sin tool calls → respuesta final ──────────────────────────
        if not msg.tool_calls:
            answer = msg.content or "No pude procesar tu solicitud."
            # Qwen3 en modo thinking puede colar razonamiento interno — eliminarlo
            import re
            answer = re.sub(r"<think>.*?</think>", "", answer, flags=re.DOTALL).strip()
            # También limpiar líneas que empiezan con patrones de razonamiento interno
            answer = re.sub(r"(?m)^(Okay,|So,|Wait,|Hmm,|Let me|First,|Now,|Looking at).*\n?", "", answer).strip()
            # Garantiza por código la imagen de cada producto mencionado, sin
            # depender de que el modelo la reproduzca bien (no es 100% consistente).
            answer = _inject_missing_images(answer, ref_image_map)
            # Quita imágenes repetidas (ej. la representativa y la del color
            # principal, cuando coinciden) — mismo motivo, no depender del modelo.
            answer = _dedupe_images(answer)
            # Red de seguridad: quitar referencias internas [ref:uuid] que el modelo
            # a veces filtra al cliente pese a la regla del prompt.
            answer = re.sub(r"\s*\[ref:[^\]]*\]", "", answer).strip()
            history.append({"role": "assistant", "content": answer})
            _history_store[history_key] = history[-_STORE_LIMIT:]
            _log_ai_usage(company_id, session_id, CHAT_MODEL, total_tokens_in, total_tokens_out)
            logger.info(
                f"Chat completado [{CHAT_MODEL}] — "
                f"tokens: {total_tokens_in}in / {total_tokens_out}out "
                f"(${_calculate_cost(CHAT_MODEL, total_tokens_in, total_tokens_out):.6f})"
            )
            return answer, used_tools

        # ── Hay tool calls → ejecutarlos ──────────────────────────────
        history.append({
            "role": "assistant",
            "content": msg.content or "",
            "tool_calls": [
                {
                    "id":   tc.id,
                    "type": "function",
                    "function": {
                        "name":      tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in msg.tool_calls
            ],
        })

        for tc in msg.tool_calls:
            tool_name = tc.function.name
            try:
                args = json.loads(tc.function.arguments)
            except (json.JSONDecodeError, TypeError):
                args = {}

            logger.info(f"Ejecutando tool: {tool_name}({args})")

            tool = tool_map.get(tool_name)
            if tool:
                try:
                    result = await tool.ainvoke(args)
                    used_tools.append(tool_name)
                    ref_image_map.update(_extract_ref_images(str(result)))
                except Exception as te:
                    result = f"Error al ejecutar {tool_name}: {str(te)[:100]}"
                    logger.error(f"Tool error: {te}")
            else:
                result = f"Tool '{tool_name}' no disponible."

            history.append({
                "role":         "tool",
                "tool_call_id": tc.id,
                "content":      str(result),
            })

    logger.warning(f"Sesión {session_id}: máximo de iteraciones alcanzado")
    _log_ai_usage(company_id, session_id, CHAT_MODEL, total_tokens_in, total_tokens_out)
    # Intentar una última respuesta con lo que se buscó
    try:
        final_resp = await client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[system_msg] + _safe_window(history) + [{
                "role": "user",
                "content": "Resume brevemente qué encontraste o no encontraste. Si no hay productos relevantes, díselo al cliente en una frase corta y amigable.",
            }],
            tools=TOOL_DEFINITIONS,
            tool_choice="none",
            max_tokens=256,
            temperature=0.2,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        answer = (final_resp.choices[0].message.content or "").strip()
        import re
        answer = re.sub(r"<think>.*?</think>", "", answer, flags=re.DOTALL).strip()
        if answer:
            history.append({"role": "assistant", "content": answer})
            _history_store[history_key] = history[-_STORE_LIMIT:]
            return answer, used_tools
    except Exception:
        pass
    return "No encontré productos relacionados con tu búsqueda en nuestro catálogo. ¿Puedo ayudarte con algo más?", used_tools


def _extract_ref_images(text: str) -> dict[str, str]:
    """
    Extrae, del texto CRUDO que devuelve un tool (ej. search_products), el mapa
    {ref_id: image_url}. Sirve para garantizar por código que la imagen de cada
    producto llegue al cliente aunque el modelo no la reproduzca bien en su
    respuesta (comportamiento no 100% determinístico del LLM con listas).
    Empareja cada [ref:uuid] con la primera imagen markdown que aparezca
    después de él y antes del siguiente [ref:...] (o el final del texto).
    """
    import re
    refs = list(re.finditer(r"\[ref:([0-9a-fA-F-]+)\]", text))
    mapping: dict[str, str] = {}
    for i, m in enumerate(refs):
        start = m.end()
        end = refs[i + 1].start() if i + 1 < len(refs) else len(text)
        # [^\)\n]+ (NO \s) porque algunos nombres de archivo subidos tienen
        # espacios literales en la URL (ej. ".../Mochila prueba.jpg") — excluir
        # \s aquí hacía que esas imágenes nunca se reconocieran.
        img_match = re.search(r"!\[[^\]]*\]\((https?://[^\)\n]+)\)", text[start:end])
        if img_match:
            mapping[m.group(1)] = img_match.group(1)
    return mapping


def _inject_missing_images(answer: str, ref_image_map: dict[str, str]) -> str:
    """
    Si el modelo mencionó un [ref:uuid] pero omitió la imagen de ese producto,
    la inserta justo después del ref usando el mapa ya conocido (viene de los
    datos reales del tool, no del modelo) — así la imagen SIEMPRE llega,
    sin depender de que el modelo la copie bien.
    """
    import re

    def _replace(m):
        ref_id = m.group(1)
        url = ref_image_map.get(ref_id)
        if not url or url in answer:
            return m.group(0)
        return f"{m.group(0)}\n![]({url})"

    return re.sub(r"\[ref:([0-9a-fA-F-]+)\]", _replace, answer)


def _dedupe_images(text: str, seen: set[str] | None = None) -> str:
    """
    Elimina imágenes markdown repetidas (misma URL) dejando solo la primera
    aparición. Red de seguridad determinística: el modelo a veces muestra la
    imagen "representativa" del producto Y la misma imagen otra vez dentro del
    bloque de colores/variantes (cuando el color principal coincide con la
    representativa) — esto lo corrige sin depender de que el modelo entienda
    la instrucción del prompt.

    `seen` permite deduplicar de forma incremental across múltiples llamadas
    (streaming, chunk por chunk) — si se pasa, se actualiza in-place.
    """
    import re
    if seen is None:
        seen = set()

    def _replace(m):
        url = m.group(2)
        if url in seen:
            return ""
        seen.add(url)
        return m.group(0)

    return re.sub(r"!\[([^\]]*)\]\((https?://[^\)\n]+)\)", _replace, text)


def _split_flushable(buf: str) -> tuple[str, str]:
    """
    Divide un buffer de streaming en (texto seguro para mandar ya, resto a retener).
    Retiene todo desde el último '[' que NO tenga un ']' después — así nunca se
    filtra un [ref:uuid] a medio llegar. Los [ref:uuid] completos en la parte
    segura se eliminan (igual que hace el post-proceso de la respuesta no-stream).

    También retiene una imagen markdown incompleta (![alt](url — el modelo
    transmite la URL carácter por carácter, así que "safe" nunca contenía la
    URL completa de una sola vez y `_dedupe_images` jamás detectaba que una
    imagen ya se había mostrado antes (bug real: mismo producto mostrando su
    imagen duplicada en la sección de colores). Se retiene la imagen entera
    hasta que llegue el ')' de cierre, para que el dedupe la vea completa.
    """
    import re
    cut = len(buf)

    last_open = buf.rfind("[")
    if last_open != -1 and "]" not in buf[last_open:]:
        cut = min(cut, last_open)

    last_img = buf.rfind("![")
    if last_img != -1 and not re.match(r"!\[[^\]]*\]\([^\)\n]*\)", buf[last_img:]):
        cut = min(cut, last_img)

    safe, rest = buf[:cut], buf[cut:]
    safe = re.sub(r"\[ref:[^\]]*\]", "", safe)
    return safe, rest


async def _run_agent_stream(
    session_id: str,
    message: str,
    company_id: str,
    company_name: str,
    ai_rules: list[str] | None = None,
    currency_code: str = "USD",
    show_stock: bool = True,
    features: dict | None = None,
    company_timezone: str = "America/Tegucigalpa",
):
    """
    Variante streaming de `_run_agent`: misma lógica de prompt/tools/historial,
    pero el turno final (sin tool_calls) se entrega token a token.

    Yields:
        {"delta": str}                       — fragmento de texto de la respuesta final
        {"done": True, "used_tools": [...]}  — fin del turno
    """
    import re

    t_start = time.monotonic()
    features = features or {}
    menu_mode = features.get("menu_mode", False)
    client = _client()

    history_key = _history_key(company_id, session_id)
    if history_key not in _history_store:
        _history_store[history_key] = []
    _touch_history(history_key)
    history: list = _history_store[history_key]
    history.append({"role": "user", "content": message})

    if ai_rules:
        rules_text = "\n".join(f"- {r}" for r in ai_rules)
        custom_rules_section = (
            "⚠️ REGLAS OBLIGATORIAS — DEBES SEGUIRLAS EN CADA MENSAJE SIN EXCEPCIÓN:\n"
            f"{rules_text}\n\n"
        )
    else:
        custom_rules_section = ""

    symbol = _currency_symbol(currency_code)
    currency_info = f"{currency_code} (símbolo: {symbol})"
    stock_rule = (
        "- Al mostrar disponibilidad de productos NUNCA menciones cantidades exactas — "
        "solo di 'disponible' o 'sin stock'."
        if not show_stock else
        "- Puedes mostrar el número exacto de unidades en stock cuando el cliente lo pregunte."
    )

    if menu_mode:
        menu_section = (
            "\nMENÚ Y RESTRICCIONES ALIMENTARIAS (este negocio es un restaurante):\n"
            "- Los productos son platillos del menú. Llama a search_products para mostrarlos.\n"
            "- Si el cliente pregunta por opciones según una dieta (vegano, vegetariano, sin gluten, keto, etc.) "
            "o por alérgenos ('¿tienen algo sin lácteos?', '¿qué lleva gluten?'), busca con search_products y "
            "filtra usando los campos 'Apto:' (dieta) y 'Alérgenos:' de cada platillo. Recomienda SOLO los que "
            "cumplan, y advierte si un platillo contiene el alérgeno que el cliente quiere evitar.\n"
            "- NUNCA recomiendes ni ofrezcas un platillo marcado como '⚠️ AGOTADO HOY' — dilo si el cliente lo pide.\n"
            "- Si el cliente pregunta '¿qué me recomiendas?' o '¿cuál es el platillo del día?', usa search_products "
            "con query vacía (muestra los destacados primero).\n"
            "- LENGUAJE NATURAL DE RESTAURANTE: al preguntar cantidades de comida di '¿cuántos quieres?', "
            "'¿cuántas órdenes?' o '¿cuántas porciones?' — NUNCA digas 'unidades' (suena a inventario, no a comida). "
            "Habla como un mesero amable, no como un sistema.\n"
        )
        if features.get("table_reservations") or features.get("pickup_orders"):
            modos = []
            if features.get("table_reservations"):
                modos.append("reservar mesa para comer ahí")
            if features.get("pickup_orders"):
                modos.append("pedir para recoger o pedir desde su mesa")
            menu_section += (
                "\nRESERVAS Y PEDIDOS POR CHAT — puedes ayudar al cliente a " + " y ".join(modos) + ":\n"
                "- ⚠️ Los platillos NO se gestionan por stock. NUNCA digas que un platillo está 'sin stock' ni uses "
                "get_stock_availability para decidir si se puede pedir: un platillo se puede pedir salvo que diga "
                "'AGOTADO HOY'. Para tomar el pedido usa SIEMPRE create_booking (NO create_reservation).\n"
                "- ⚠️ ANTES de create_booking SIEMPRE pide y confirma: (1) NOMBRE real del cliente y "
                "(2) un teléfono O un email de contacto. NUNCA inventes el nombre ni uses 'Cliente'. "
                "Si el cliente no te ha dado su nombre y contacto, PÍDESELOS primero.\n"
                "- Usa la tool create_booking SOLO cuando ya tengas: nombre + contacto, tipo (mesa o recoger), "
                "fecha y hora, y (si es mesa) número de personas. Si falta algún dato, PÍDELO antes de llamar la tool.\n"
                "- Para 'pedido desde la mesa' o 'ya estoy aquí', usa service_type='dine_in' con la fecha y hora ACTUAL.\n"
                "- Si el cliente quiere pre-ordenar platillos, primero búscalos con search_products para obtener su "
                "[ref:uuid], y pásalos en el parámetro items como 'ref:cantidad' separados por coma.\n"
                "- Interpreta fechas relativas ('mañana', 'hoy a las 8') usando la fecha/hora de 'Hoy' indicada abajo. "
                "Confirma con el cliente la fecha y hora exactas antes de crear la reserva.\n"
                "- Tras crear la reserva, dale SIEMPRE su código al cliente.\n"
            )
    else:
        menu_section = ""

    system_msg = {
        "role": "system",
        "content": SYSTEM_PROMPT.format(
            company_name=company_name,
            current_datetime=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            custom_rules_section=custom_rules_section,
            currency_info=currency_info,
            stock_rule=stock_rule,
            menu_section=menu_section,
        ),
    }

    tools_list = create_inventory_tools(company_id, supabase, currency_symbol=symbol, show_stock=show_stock, features=features, company_timezone=company_timezone)
    tool_map = {t.name: t for t in tools_list}
    used_tools: list[str] = []
    total_tokens_in = 0
    total_tokens_out = 0
    ref_image_map: dict[str, str] = {}
    seen_image_urls: set[str] = set()

    MAX_ITERATIONS = 4
    for iteration in range(MAX_ITERATIONS):
        t_call = time.monotonic()
        logger.info(f"[timer] llamando a DeepInfra (iter {iteration}) — +{t_call - t_start:.2f}s desde inicio")
        try:
            stream = await client.chat.completions.create(
                model=CHAT_MODEL,
                messages=[system_msg] + _safe_window(history),
                tools=TOOL_DEFINITIONS,
                tool_choice="auto",
                max_tokens=1536,
                temperature=0.2,
                extra_body={"chat_template_kwargs": {"enable_thinking": False}},
                stream=True,
                stream_options={"include_usage": True},
            )
        except Exception as e:
            logger.error(f"Error DeepInfra stream (iter {iteration}): {str(e)[:200]}")
            yield {"delta": "Lo siento, tuve un problema técnico. Intenta de nuevo en unos segundos."}
            yield {"done": True, "used_tools": used_tools}
            return

        content_acc = ""
        pending = ""
        tool_calls_acc: dict[int, dict] = {}
        first_chunk_logged = False

        try:
            async for chunk in stream:
                if not first_chunk_logged:
                    first_chunk_logged = True
                    logger.info(f"[timer] primer chunk de DeepInfra (iter {iteration}) — +{time.monotonic() - t_call:.2f}s desde la llamada, +{time.monotonic() - t_start:.2f}s desde inicio")
                if getattr(chunk, "usage", None):
                    total_tokens_in  += chunk.usage.prompt_tokens or 0
                    total_tokens_out += chunk.usage.completion_tokens or 0
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta

                if delta.tool_calls:
                    for tc_delta in delta.tool_calls:
                        idx = tc_delta.index
                        entry = tool_calls_acc.setdefault(idx, {"id": None, "name": None, "arguments": ""})
                        if tc_delta.id:
                            entry["id"] = tc_delta.id
                        if tc_delta.function:
                            if tc_delta.function.name:
                                entry["name"] = tc_delta.function.name
                            if tc_delta.function.arguments:
                                entry["arguments"] += tc_delta.function.arguments
                    continue

                if delta.content:
                    content_acc += delta.content
                    pending += delta.content
                    safe, pending = _split_flushable(pending)
                    if safe:
                        safe = _dedupe_images(safe, seen_image_urls)
                        if safe:
                            yield {"delta": safe}
        except Exception as e:
            logger.error(f"Error leyendo stream de DeepInfra (iter {iteration}): {str(e)[:200]}")
            yield {"delta": "\n\n(Se interrumpió la respuesta — intenta de nuevo.)"}
            yield {"done": True, "used_tools": used_tools}
            return

        # ── Había tool calls → ejecutarlas y seguir el loop (sin mostrar nada aún) ──
        if tool_calls_acc:
            history.append({
                "role": "assistant",
                "content": content_acc or "",
                "tool_calls": [
                    {
                        "id":   tc["id"] or f"call_{idx}",
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": tc["arguments"]},
                    }
                    for idx, tc in sorted(tool_calls_acc.items())
                ],
            })
            for idx, tc in sorted(tool_calls_acc.items()):
                tool_name = tc["name"]
                try:
                    args = json.loads(tc["arguments"]) if tc["arguments"] else {}
                except (json.JSONDecodeError, TypeError):
                    args = {}
                logger.info(f"Ejecutando tool (stream): {tool_name}({args})")
                tool = tool_map.get(tool_name)
                if tool:
                    try:
                        result = await tool.ainvoke(args)
                        used_tools.append(tool_name)
                        ref_image_map.update(_extract_ref_images(str(result)))
                    except Exception as te:
                        result = f"Error al ejecutar {tool_name}: {str(te)[:100]}"
                        logger.error(f"Tool error: {te}")
                else:
                    result = f"Tool '{tool_name}' no disponible."
                history.append({
                    "role":         "tool",
                    "tool_call_id": tc["id"] or f"call_{idx}",
                    "content":      str(result),
                })
            continue

        # ── Sin tool calls → esta fue la respuesta final ──
        if pending:
            final_chunk = re.sub(r"\[ref:[^\]]*\]", "", pending)
            final_chunk = _dedupe_images(final_chunk, seen_image_urls)
            if final_chunk:
                yield {"delta": final_chunk}

        answer = content_acc or "No pude procesar tu solicitud."

        # El texto ya se envió en vivo (arriba), así que si al modelo se le
        # olvidó la imagen de algún producto no se puede insertar en su
        # posición exacta — se agrega al final del mismo mensaje, garantizada
        # por código (viene del tool, no del modelo). Mejor tarde que nunca.
        missing = []
        seen_refs = set()
        for m in re.finditer(r"\[ref:([0-9a-fA-F-]+)\]", answer):
            ref_id = m.group(1)
            if ref_id in seen_refs:
                continue
            seen_refs.add(ref_id)
            url = ref_image_map.get(ref_id)
            if url and url not in answer and url not in seen_image_urls:
                missing.append(f"![]({url})")
                seen_image_urls.add(url)
        if missing:
            extra = "\n" + "\n".join(missing)
            yield {"delta": extra}
            answer += extra

        answer_clean = re.sub(r"<think>.*?</think>", "", answer, flags=re.DOTALL).strip()
        answer_clean = re.sub(r"(?m)^(Okay,|So,|Wait,|Hmm,|Let me|First,|Now,|Looking at).*\n?", "", answer_clean).strip()
        answer_clean = re.sub(r"\s*\[ref:[^\]]*\]", "", answer_clean).strip()

        history.append({"role": "assistant", "content": answer_clean})
        _history_store[history_key] = history[-_STORE_LIMIT:]
        _log_ai_usage(company_id, session_id, CHAT_MODEL, total_tokens_in, total_tokens_out)
        logger.info(
            f"Chat (stream) completado [{CHAT_MODEL}] — "
            f"tokens: {total_tokens_in}in / {total_tokens_out}out "
            f"(${_calculate_cost(CHAT_MODEL, total_tokens_in, total_tokens_out):.6f}) — "
            f"[timer] total: {time.monotonic() - t_start:.2f}s"
        )
        yield {"done": True, "used_tools": used_tools}
        return

    logger.warning(f"Sesión {session_id}: máximo de iteraciones alcanzado (stream)")
    _log_ai_usage(company_id, session_id, CHAT_MODEL, total_tokens_in, total_tokens_out)
    fallback = "No encontré productos relacionados con tu búsqueda en nuestro catálogo. ¿Puedo ayudarte con algo más?"
    history.append({"role": "assistant", "content": fallback})
    _history_store[history_key] = history[-_STORE_LIMIT:]
    yield {"delta": fallback}
    yield {"done": True, "used_tools": used_tools}


async def chat_stream(session_id: str, message: str, company_slug: str):
    """
    Igual que `chat()` pero streameando la respuesta final token a token.
    Yields los mismos eventos que `_run_agent_stream`.
    """
    company = await _get_company_context(company_slug)
    if not company:
        yield {"delta": "Empresa no encontrada."}
        yield {"done": True, "used_tools": []}
        return

    company_id    = company["id"]
    company_name  = company["name"]
    settings_data = company["settings"]
    features      = company["features"]
    ai_rules      = settings_data.get("ai_rules") or []
    currency_code = settings_data.get("currency") or "USD"
    show_stock    = settings_data.get("show_stock", True)
    # Zona horaria de la empresa para mostrar horas de reservas/reservaciones
    # legibles al cliente (en vez de UTC crudo). Configurable por empresa vía
    # settings.timezone (nombre IANA, ej. "America/Guatemala"); por defecto
    # asumimos Centroamérica (UTC-6, sin horario de verano) mientras no haya
    # un selector en el admin.
    company_timezone = settings_data.get("timezone") or "America/Tegucigalpa"

    if company["subscription_status"] == "suspended":
        yield {"delta": "Este servicio está temporalmente suspendido."}
        yield {"done": True, "used_tools": []}
        return

    try:
        async for event in _run_agent_stream(
            session_id, message, company_id, company_name,
            ai_rules, currency_code, show_stock, features, company_timezone,
        ):
            yield event
    except Exception as e:
        logger.error(f"Error inesperado en chat_stream: {e}")
        yield {"delta": "Lo siento, tuve un problema procesando tu mensaje. Intenta de nuevo."}
        yield {"done": True, "used_tools": []}


# ── Función pública de chat ───────────────────────────────────────────
async def chat(
    session_id: str,
    message: str,
    company_slug: str,
) -> tuple[str, list[str]]:
    """Procesa un mensaje de chat y retorna (respuesta, tools_usados)."""
    company = await _get_company_context(company_slug)
    if not company:
        return "Empresa no encontrada.", []

    company_id    = company["id"]
    company_name  = company["name"]
    settings_data = company["settings"]
    features      = company["features"]
    ai_rules      = settings_data.get("ai_rules") or []
    currency_code = settings_data.get("currency") or "USD"
    show_stock    = settings_data.get("show_stock", True)
    company_timezone = settings_data.get("timezone") or "America/Tegucigalpa"

    if company["subscription_status"] == "suspended":
        return "Este servicio está temporalmente suspendido.", []

    try:
        return await _run_agent(
            session_id, message, company_id, company_name,
            ai_rules, currency_code, show_stock, features, company_timezone,
        )
    except Exception as e:
        logger.error(f"Error inesperado en chat: {e}")
        return "Lo siento, tuve un problema procesando tu mensaje. Intenta de nuevo.", []


# ── Chat con imagen — comparación visual real con Qwen2.5-VL ────────
async def chat_with_image(
    session_id: str,
    company_slug: str,
    image_base64: str,
    image_media_type: str = "image/jpeg",
    user_text: str = "¿Qué producto es este y cuánto cuesta?",
) -> tuple[str, list[str]]:
    """
    Flujo:
    1. Qwen2.5-VL describe brevemente la imagen para seedear la búsqueda.
    2. Búsqueda semántica + complemento por keyword.
    3. Qwen2.5-VL compara la imagen del cliente contra las fotos de los
       candidatos del inventario y elige la mejor coincidencia.
    """
    company_resp = await run_with_retry(lambda: supabase.table("companies")
        .select("id, name, settings")
        .eq("slug", company_slug)
        .eq("is_active", True)
        .single()
        .execute())

    if not company_resp.data:
        return "Empresa no encontrada.", []

    company       = company_resp.data
    company_id    = company["id"]
    currency_code = (company.get("settings") or {}).get("currency") or "USD"
    symbol        = _currency_symbol(currency_code)
    show_stock    = (company.get("settings") or {}).get("show_stock", True)

    try:
        from app.embeddings.embedding_service import generate_embedding
        client = _client()
        vision_tokens_in = 0
        vision_tokens_out = 0

        def add_usage(response) -> None:
            nonlocal vision_tokens_in, vision_tokens_out
            usage = getattr(response, "usage", None)
            if usage:
                vision_tokens_in += usage.prompt_tokens or 0
                vision_tokens_out += usage.completion_tokens or 0

        user_image_url = f"data:{image_media_type};base64,{image_base64}"

        import json as _json, re as _re

        # ── FASE 1: Extraer atributos estructurados de la imagen ───────
        attr_resp = await client.chat.completions.create(
            model=VISION_MODEL,
            max_tokens=120,
            temperature=0.1,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": user_image_url}},
                    {
                        "type": "text",
                        "text": (
                            "Analiza esta imagen y responde SOLO con este JSON (sin texto extra):\n"
                            '{"type": "tipo de producto en español", '
                            '"brand": "marca si la ves escrita o reconoces el logo, si no null", '
                            '"colors": ["color1", "color2"], '
                            '"style": "descripción breve del estilo/uso", '
                            '"search_query": "frase de búsqueda de 5-10 palabras para encontrar este producto"}'
                        ),
                    },
                ],
            }],
        )
        add_usage(attr_resp)
        attr_raw = (attr_resp.choices[0].message.content or "").strip()
        logger.info(f"Atributos imagen: {attr_raw[:300]}")

        attrs = {}
        json_m = _re.search(r'\{.*\}', attr_raw, _re.DOTALL)
        if json_m:
            try:
                attrs = _json.loads(json_m.group())
            except Exception:
                pass

        product_type  = attrs.get("type", "producto")
        brand         = attrs.get("brand") or ""
        colors        = attrs.get("colors") or []
        search_query  = attrs.get("search_query") or f"{product_type} {brand} {' '.join(colors)}".strip()
        logger.info(f"Tipo: {product_type} | Marca: {brand} | Colores: {colors} | Query: {search_query}")

        # ── FASE 2: Búsqueda semántica + keyword ──────────────────────
        query_embedding = await generate_embedding(f"{search_query} {user_text}".strip())

        rpc_result = await run_with_retry(lambda: supabase.rpc("search_products_semantic", {
            "query_embedding":   query_embedding,
            "company_id_filter": company_id,
            "match_threshold":   0.10,
            "match_count":       8,
        }).execute())

        candidate_ids = [p["id"] for p in (rpc_result.data or [])]

        # Complementar con keyword del tipo de producto
        for kw in [product_type] + ([brand] if brand else []):
            if len(kw) > 2:
                kw_res = await run_with_retry(lambda kw=kw: supabase.table("products")
                    .select("id").eq("company_id", company_id).eq("is_active", True)
                    .ilike("name", f"%{kw}%").limit(4).execute())
                for row in (kw_res.data or []):
                    if row["id"] not in candidate_ids:
                        candidate_ids.append(row["id"])

        if not candidate_ids:
            _log_ai_usage(
                company_id, session_id, VISION_MODEL,
                vision_tokens_in, vision_tokens_out,
            )
            return (
                f"🔍 Veo que es {product_type}{' ' + brand if brand else ''}. "
                "No encontré ese tipo de producto en el inventario. "
                "¿Puedes describirlo con más detalle?",
                ["vision_no_candidates"],
            )

        details_res = await run_with_retry(lambda: supabase.table("products")
            .select("id, name, price, unit, description, tags")
            .in_("id", candidate_ids[:8])
            .execute())
        candidates = details_res.data or []

        # ── FASE 3: Puntuar cada candidato con texto (sin cargar URLs) ─
        catalog_text = "\n".join(
            f'- "{p["name"]}": {(p.get("description") or ""[:100])} tags:[{",".join(p.get("tags") or [])}]'
            for p in candidates
        )

        score_resp = await client.chat.completions.create(
            model=VISION_MODEL,
            max_tokens=400,
            temperature=0.1,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": user_image_url}},
                    {
                        "type": "text",
                        "text": (
                            f"El producto de la imagen es: {product_type}"
                            + (f", marca {brand}" if brand else "")
                            + (f", colores {', '.join(colors)}" if colors else "")
                            + f", estilo: {attrs.get('style', '')}.\n\n"
                            f"Estos son los productos disponibles en el inventario:\n{catalog_text}\n\n"
                            "Puntúa cada producto del inventario según qué tan similar es al de la imagen. "
                            "Responde SOLO con este JSON:\n"
                            '{"candidates": [{"name": "nombre exacto del producto", "score": 0-100, "reason": "una frase"}]}\n\n'
                            "Criterios de score:\n"
                            "- 85-100: mismo tipo Y misma marca (o sin marca conocida y muy parecido)\n"
                            "- 60-84: mismo tipo de producto, diferente marca o color\n"
                            "- 30-59: categoría parecida pero diferente uso o estilo\n"
                            "- 0-29: producto completamente diferente\n"
                            "Si el inventario tiene un producto del mismo tipo que la imagen, score mínimo 50."
                        ),
                    },
                ],
            }],
        )
        add_usage(score_resp)
        score_raw = (score_resp.choices[0].message.content or "").strip()
        logger.info(f"Scores: {score_raw[:400]}")

        scored_candidates = []
        json_m2 = _re.search(r'\{.*\}', score_raw, _re.DOTALL)
        if json_m2:
            try:
                scored_candidates = _json.loads(json_m2.group()).get("candidates", [])
            except Exception:
                pass

        # Mapear a productos reales
        def find_product(name: str):
            nl = name.lower()
            for p in candidates:
                if p["name"].lower() in nl or nl in p["name"].lower():
                    return p
            return None

        async def _stock_badge(product):
            res   = await run_with_retry(lambda: supabase.table("product_warehouse_stock")
                .select("quantity").eq("product_id", product["id"]).execute())
            total = sum(s["quantity"] for s in (res.data or []))
            if show_stock:
                return f"✅ {total} en stock" if total > 0 else "❌ Sin stock"
            return "✅ Disponible" if total > 0 else "❌ Sin stock"

        scored_candidates.sort(key=lambda c: c.get("score", 0), reverse=True)

        exact_match  = None
        similar_list = []

        for c in scored_candidates:
            score   = c.get("score", 0)
            product = find_product(c.get("name", ""))
            if not product:
                continue
            if score >= 85 and not exact_match:
                exact_match = (product, c)
            elif 50 <= score < 85 and len(similar_list) < 3:
                similar_list.append((product, c))

        _log_ai_usage(
            company_id, session_id, VISION_MODEL,
            vision_tokens_in, vision_tokens_out,
        )

        # ── Helper para guardar en historial ──────────────────────────
        def _save_to_history(assistant_reply: str, found_product_id: str | None = None):
            history_key = _history_key(company_id, session_id)
            if history_key not in _history_store:
                _history_store[history_key] = []
            _touch_history(history_key)
            _history_store[history_key].append({
                "role": "user",
                "content": f"[Imagen enviada] {user_text}",
            })
            content = assistant_reply
            if found_product_id:
                content = f"[PRODUCTO_ID:{found_product_id}]\n{assistant_reply}"
            _history_store[history_key].append({
                "role": "assistant",
                "content": content,
            })
            _history_store[history_key] = _history_store[history_key][-_STORE_LIMIT:]

        # ── CASO 1: Match exacto ───────────────────────────────────────
        if exact_match:
            product, c = exact_match
            badge     = await _stock_badge(product)
            price_fmt = f"{float(product['price']):,.2f}"
            reply = (
                f"🎯 {c.get('reason', 'Producto encontrado')}\n\n"
                f"**{product['name']}**  {badge}\n"
                f"💰 {symbol}{price_fmt} / {product['unit']}\n\n"
                "¿Te interesa? Puedo hacer una reserva o darte más detalles."
            )
            _save_to_history(reply, found_product_id=product["id"])
            return reply, ["vision_exact_match"]

        # ── CASO 2: Similares ──────────────────────────────────────────
        if similar_list:
            brand_str = f" {brand}" if brand else ""
            lines = [f"🔍 No tenemos {product_type}{brand_str} exacto, pero encontré opciones similares:\n"]
            first_product_id = None
            for i, (product, c) in enumerate(similar_list):
                badge     = await _stock_badge(product)
                price_fmt = f"{float(product['price']):,.2f}"
                lines.append(
                    f"**{product['name']}**  {badge}\n"
                    f"💰 {symbol}{price_fmt} / {product['unit']}"
                )
                if i == 0:
                    first_product_id = product["id"]
            lines.append("\n¿Alguna de estas te interesa?")
            reply = "\n\n".join(lines)
            _save_to_history(reply, found_product_id=first_product_id)
            return reply, ["vision_similar"]

        # ── CASO 3: Nada encontrado ────────────────────────────────────
        brand_str = f" {brand}" if brand else ""
        reply = (
            f"🔍 Veo que buscas {product_type}{brand_str}. "
            "No tenemos ese producto ni algo similar en el inventario.\n"
            "¿Quieres que busque por otra característica?"
        )
        _save_to_history(reply)
        return reply, ["vision_no_match"]

    except Exception as e:
        logger.error(f"Error en chat_with_image: {e}")
        return "No pude analizar la imagen. Intenta con una imagen más clara.", []


# ── Utilidades ────────────────────────────────────────────────────────

# Precios DeepInfra por 1M tokens (USD)
_MODEL_PRICING: dict[str, tuple[float, float]] = {
    "Qwen/Qwen3.6-35B-A3B": (0.15, 0.95),
}

def _calculate_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    price_in, price_out = _MODEL_PRICING.get(model, (0.10, 0.30))
    return round((tokens_in * price_in + tokens_out * price_out) / 1_000_000, 8)

def _log_ai_usage(
    company_id: str,
    session_id: str,
    model: str,
    tokens_input: int = 0,
    tokens_output: int = 0,
):
    """
    Logging de uso best-effort — no debe demorar ni afectar la respuesta al
    cliente. Se llama sin `await` desde ~6 puntos (turnos de chat, imagen,
    fallbacks); en vez de bloquear el event loop con el insert síncrono, se
    dispara como tarea en segundo plano (mismo patrón que el email de
    reservas) y no se espera su resultado.
    """
    cost = _calculate_cost(model, tokens_input, tokens_output)

    async def _insert():
        try:
            await run_with_retry(lambda: supabase.table("ai_usage_log").insert({
                "company_id":    company_id,
                "session_id":    session_id,
                "model":         model,
                "tokens_input":  tokens_input,
                "tokens_output": tokens_output,
                "cost_usd":      cost,
            }).execute(), idempotent=False)
        except Exception:
            logger.exception("No se pudo registrar ai_usage_log")

    try:
        asyncio.create_task(_insert())
    except RuntimeError:
        pass  # no hay event loop corriendo — no debería pasar en producción


def clear_session(session_id: str, company_id: str | None = None):
    """Limpia el historial de una sesión."""
    keys = (
        [_history_key(company_id, session_id)]
        if company_id
        else [key for key in _history_store if key.endswith(f":{session_id}")]
    )
    for key in keys:
        _history_store.pop(key, None)
        _history_last_seen.pop(key, None)


async def warmup_chat_model() -> None:
    """
    Mantiene el modelo de chat caliente en DeepInfra (mismo motivo que
    `warmup_embedding_model` en embedding_service.py). Sin esto, el primer
    mensaje de chat después de un rato de inactividad paga el cold start
    completo del modelo — con esto casi siempre lo encuentra ya despierto.
    Costo despreciable: 1 token de salida cada 10 min.
    """
    try:
        client = _client()
        await client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[{"role": "user", "content": "hola"}],
            max_tokens=1,
            temperature=0,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        logger.info("Chat model warm-up OK")
    except Exception as e:
        logger.warning(f"Chat model warm-up falló (no crítico): {e}")


async def start_chat_warmup_loop(interval_seconds: int = 600) -> None:
    """Loop infinito de warm-up del modelo de chat. Correr como background task."""
    await asyncio.sleep(45)  # deja que el warm-up de embeddings arranque primero
    while True:
        await warmup_chat_model()
        await asyncio.sleep(interval_seconds)
