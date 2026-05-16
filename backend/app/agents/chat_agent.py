"""
app/agents/chat_agent.py
Chat de inventario usando DeepInfra (OpenAI-compatible API).
- Chat: Qwen/Qwen3-30B-A3B (MoE — rápido y capaz, soporta tool calling)
- Vision: Qwen/Qwen2.5-VL-32B-Instruct (comparación visual real)
- Loop agéntico propio
- Memoria: historial por sesión
"""
import json
import logging
import os
import base64
from datetime import datetime
from typing import Optional

from openai import AsyncOpenAI

from app.core.config import settings
from app.core.supabase_client import supabase
from app.agents.tools import create_inventory_tools

# LangSmith tracing (opcional)
os.environ["LANGCHAIN_TRACING_V2"] = str(settings.langchain_tracing_v2).lower()
os.environ["LANGCHAIN_API_KEY"]    = settings.langchain_api_key
os.environ["LANGCHAIN_PROJECT"]    = settings.langchain_project

logger = logging.getLogger(__name__)

# ── Modelos DeepInfra ─────────────────────────────────────────────────
DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai"
CHAT_MODEL   = "Qwen/Qwen3-30B-A3B"
VISION_MODEL = "Qwen/Qwen2.5-VL-32B-Instruct"

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

# ── Historial de conversación por sesión ─────────────────────────────
_history_store: dict[str, list] = {}

# ── Prompt del sistema ────────────────────────────────────────────────
SYSTEM_PROMPT = """Eres el asistente de inventario de "{company_name}". Ayudas a clientes a buscar productos, consultar stock y hacer reservas.

{custom_rules_section}REGLAS GENERALES:
- Antes de responder sobre productos, precios o stock SIEMPRE llama al tool correspondiente. Nunca inventes datos.
- Si el tool no devuelve resultados, díselo al cliente claramente.
- Responde en el idioma del cliente. Sé breve y amigable.
- Nunca muestres IDs técnicos al cliente.
- Al mostrar productos incluye siempre: nombre en negrita, precio con la moneda correcta, y disponibilidad.
- Para ubicaciones: reporta exactamente lo que diga el tool. Si no está registrada, díselo.

PARA RESERVAR: pide primero nombre completo y email. Verifica stock. Solo entonces llama create_reservation. Muestra el código y la fecha de expiración.

Moneda: {currency_info} — usa siempre este símbolo para precios.
{stock_rule}
Hoy: {current_datetime}
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
) -> tuple[str, list[str]]:
    """Loop agéntico usando DeepInfra (OpenAI-compatible)."""
    client = _client()

    if session_id not in _history_store:
        _history_store[session_id] = []
    history: list = _history_store[session_id]
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

    system_msg = {
        "role": "system",
        "content": SYSTEM_PROMPT.format(
            company_name=company_name,
            current_datetime=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
            custom_rules_section=custom_rules_section,
            currency_info=currency_info,
            stock_rule=stock_rule,
        ),
    }

    tools_list = create_inventory_tools(company_id, supabase, currency_symbol=symbol, show_stock=show_stock)
    tool_map = {t.name: t for t in tools_list}
    used_tools: list[str] = []
    total_tokens_in = 0
    total_tokens_out = 0

    MAX_ITERATIONS = 4
    for iteration in range(MAX_ITERATIONS):
        try:
            response = await client.chat.completions.create(
                model=CHAT_MODEL,
                messages=[system_msg] + history[-12:],
                tools=TOOL_DEFINITIONS,
                tool_choice="auto",
                max_tokens=768,
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
            history.append({"role": "assistant", "content": answer})
            _history_store[session_id] = history[-12:]
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
    return "No pude completar la solicitud. ¿Podrías reformularla?", used_tools


# ── Función pública de chat ───────────────────────────────────────────
async def chat(
    session_id: str,
    message: str,
    company_slug: str,
) -> tuple[str, list[str]]:
    """Procesa un mensaje de chat y retorna (respuesta, tools_usados)."""
    company_resp = supabase.table("companies") \
        .select("id, name, settings") \
        .eq("slug", company_slug) \
        .eq("is_active", True) \
        .single() \
        .execute()

    if not company_resp.data:
        return "Empresa no encontrada.", []

    company       = company_resp.data
    company_id    = company["id"]
    company_name  = company["name"]
    settings_data = company.get("settings") or {}
    ai_rules      = settings_data.get("ai_rules") or []
    currency_code = settings_data.get("currency") or "USD"
    show_stock    = settings_data.get("show_stock", True)

    # Verificar suscripción
    company_full = supabase.table("companies") \
        .select("subscription_id, subscriptions(status)") \
        .eq("id", company_id) \
        .single() \
        .execute()

    if company_full.data:
        sub = company_full.data.get("subscriptions")
        if sub and sub.get("status") == "suspended":
            return "Este servicio está temporalmente suspendido.", []

    try:
        return await _run_agent(
            session_id, message, company_id, company_name,
            ai_rules, currency_code, show_stock,
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
    company_resp = supabase.table("companies") \
        .select("id, name, settings") \
        .eq("slug", company_slug) \
        .eq("is_active", True) \
        .single() \
        .execute()

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

        user_image_url = f"data:{image_media_type};base64,{image_base64}"

        # ── ETAPA 1: descripción corta para seedear la búsqueda ────────
        seed_resp = await client.chat.completions.create(
            model=VISION_MODEL,
            max_tokens=40,
            temperature=0.1,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": user_image_url}},
                    {"type": "text", "text": "En máximo 8 palabras: ¿qué tipo de producto aparece en la imagen?"},
                ],
            }],
        )
        seed_description = (seed_resp.choices[0].message.content or "").strip().strip('"').strip("'")
        logger.info(f"Seed descripción: {seed_description}")

        # ── ETAPA 2: candidatos vía búsqueda semántica + keyword ──────
        query_embedding = await generate_embedding(f"{seed_description} {user_text}".strip())

        rpc_result = supabase.rpc("search_products_semantic", {
            "query_embedding":   query_embedding,
            "company_id_filter": company_id,
            "match_threshold":   0.15,
            "match_count":       8,
        }).execute()

        candidate_ids = [p["id"] for p in (rpc_result.data or [])]

        if len(candidate_ids) < 4:
            keywords = [w for w in seed_description.lower().split() if len(w) > 3][:2]
            for kw in keywords:
                kw_res = supabase.table("products") \
                    .select("id").eq("company_id", company_id).eq("is_active", True) \
                    .ilike("name", f"%{kw}%").limit(4).execute()
                for row in (kw_res.data or []):
                    if row["id"] not in candidate_ids:
                        candidate_ids.append(row["id"])

        if not candidate_ids:
            return (
                "No encontré productos en el inventario que puedan coincidir con tu imagen. "
                "¿Puedes describirlo con palabras?",
                ["vision_search"],
            )

        details_res = supabase.table("products") \
            .select("id, name, price, unit, description, images") \
            .in_("id", candidate_ids[:6]) \
            .execute()
        candidates = details_res.data or []

        with_images    = [(p, p["images"][0]) for p in candidates if p.get("images")]
        without_images = [p for p in candidates if not p.get("images")]

        # ── ETAPA 3a: comparación visual con productos que tienen foto ──
        if with_images:
            content: list = [
                {"type": "text", "text": "Imagen que el cliente está buscando:"},
                {"type": "image_url", "image_url": {"url": user_image_url}},
                {"type": "text", "text": f"\nProductos disponibles en el inventario ({len(with_images)} opciones):"},
            ]
            for i, (product, img_url) in enumerate(with_images[:4]):
                content.append({"type": "text", "text": f"\nOpción {i+1}: {product['name']}"})
                content.append({"type": "image_url", "image_url": {"url": img_url}})

            content.append({
                "type": "text",
                "text": (
                    "\nCompara la imagen del cliente con las opciones del inventario y responde "
                    "en UNA sola oración natural en español. Ejemplos de formato:\n"
                    "- 'Es exactamente la Mochila Amarilla, mismo color y diseño.'\n"
                    "- 'Se parece bastante a la Mochila Escolar Azul, misma forma pero diferente color.'\n"
                    "- 'No encontré ningún producto en el inventario que coincida con la imagen.'\n"
                    "Solo una oración, sin numeración, sin listas."
                ),
            })

            comp_resp = await client.chat.completions.create(
                model=VISION_MODEL,
                max_tokens=200,
                temperature=0.2,
                messages=[{"role": "user", "content": content}],
            )
            analysis = (comp_resp.choices[0].message.content or "").strip()
            logger.info(f"Análisis visual: {analysis[:200]}")

            matched_product = None
            analysis_lower = analysis.lower()
            for product, _ in with_images:
                if product["name"].lower() in analysis_lower:
                    matched_product = product
                    break
            if not matched_product and with_images:
                matched_product = with_images[0][0]

            stock_res   = supabase.table("product_warehouse_stock") \
                .select("quantity").eq("product_id", matched_product["id"]).execute()
            total_stock = sum(s["quantity"] for s in (stock_res.data or []))
            stock_badge = (
                (f"✅ {total_stock} en stock" if total_stock > 0 else "❌ Sin stock")
                if show_stock else
                ("✅ Disponible" if total_stock > 0 else "❌ Sin stock")
            )

            price_fmt = f"{float(matched_product['price']):,.2f}"
            response = (
                f"🔍 {analysis}\n\n"
                f"**{matched_product['name']}**  {stock_badge}\n"
                f"💰 {symbol}{price_fmt} / {matched_product['unit']}\n\n"
                "¿Te interesa? Puedo hacer una reserva o darte más detalles."
            )
            _log_ai_usage(company_id, session_id, VISION_MODEL)
            return response, ["vision_comparison"]

        # ── ETAPA 3b: fallback sin fotos en inventario ─────────────────
        catalog_text = "\n".join(
            f"- {p['name']}: {(p.get('description') or 'sin descripción')[:120]}"
            for p in without_images[:5]
        )

        text_resp = await client.chat.completions.create(
            model=VISION_MODEL,
            max_tokens=200,
            temperature=0.2,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": user_image_url}},
                    {"type": "text", "text": (
                        "Analiza el producto de la imagen con detalle: tipo, color, forma, material, uso.\n\n"
                        f"Estos son los productos disponibles en el inventario:\n{catalog_text}\n\n"
                        "¿Cuál coincide mejor con la imagen? Explica brevemente por qué. "
                        "Si ninguno coincide, dilo. Responde en español, máximo 3 oraciones."
                    )},
                ],
            }],
        )
        text_analysis = (text_resp.choices[0].message.content or "").strip()
        logger.info(f"Análisis texto-fallback: {text_analysis[:200]}")

        matched_product = None
        for p in without_images:
            if p["name"].lower() in text_analysis.lower():
                matched_product = p
                break
        if not matched_product and without_images:
            matched_product = without_images[0]

        stock_res   = supabase.table("product_warehouse_stock") \
            .select("quantity").eq("product_id", matched_product["id"]).execute()
        total_stock = sum(s["quantity"] for s in (stock_res.data or []))
        stock_badge = (
            (f"✅ {total_stock} en stock" if total_stock > 0 else "❌ Sin stock")
            if show_stock else
            ("✅ Disponible" if total_stock > 0 else "❌ Sin stock")
        )

        price_fmt = f"{float(matched_product['price']):,.2f}"
        response = (
            f"🔍 {text_analysis}\n\n"
            f"**{matched_product['name']}**  {stock_badge}\n"
            f"💰 {symbol}{price_fmt} / {matched_product['unit']}\n\n"
            "*(Los productos aún no tienen foto en el inventario — "
            "agregar imágenes mejoraría la precisión de búsqueda)*\n\n"
            "¿Es este el producto que buscas? Puedo hacer una reserva."
        )
        _log_ai_usage(company_id, session_id, VISION_MODEL)
        return response, ["vision_text_fallback"]

    except Exception as e:
        logger.error(f"Error en chat_with_image: {e}")
        return "No pude analizar la imagen. Intenta con una imagen más clara.", []


# ── Utilidades ────────────────────────────────────────────────────────

# Precios DeepInfra por 1M tokens (USD)
_MODEL_PRICING: dict[str, tuple[float, float]] = {
    "Qwen/Qwen3-30B-A3B":            (0.08, 0.29),
    "Qwen/Qwen2.5-VL-32B-Instruct":  (0.20, 0.60),
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
    cost = _calculate_cost(model, tokens_input, tokens_output)
    try:
        supabase.table("ai_usage_log").insert({
            "company_id":    company_id,
            "session_id":    session_id,
            "model":         model,
            "tokens_input":  tokens_input,
            "tokens_output": tokens_output,
            "cost_usd":      cost,
        }).execute()
    except Exception:
        pass


def clear_session(session_id: str):
    """Limpia el historial de una sesión."""
    _history_store.pop(session_id, None)
