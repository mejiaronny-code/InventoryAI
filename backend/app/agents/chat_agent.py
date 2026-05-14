"""
app/agents/chat_agent.py
Agente LangChain + Groq para el chat de inventario.
- Modelo principal: llama-3.3-70b-versatile (Groq) para chat
- Modelo alterno: meta-llama/llama-4-scout-17b-16e-instruct (Groq) para búsqueda por imagen
- Memoria: ConversationBufferWindowMemory(k=10) por session
- Tracing: LangSmith
"""
from langchain_groq import ChatGroq
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain.memory import ConversationBufferWindowMemory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage
import base64
import logging
import os
import json
import re
from typing import Optional

from app.core.config import settings
from app.core.supabase_client import supabase
from app.agents.tools import create_inventory_tools

# Configurar LangSmith
os.environ["LANGCHAIN_TRACING_V2"] = str(settings.langchain_tracing_v2).lower()
os.environ["LANGCHAIN_API_KEY"] = settings.langchain_api_key
os.environ["LANGCHAIN_PROJECT"] = settings.langchain_project

logger = logging.getLogger(__name__)

# Almacén en memoria de sesiones: session_id → AgentExecutor
_session_store: dict[str, AgentExecutor] = {}
_memory_store: dict[str, ConversationBufferWindowMemory] = {}


SYSTEM_PROMPT = """Eres un asistente de inventario inteligente y amigable para la empresa "{company_name}".

Tu rol es ayudar a los clientes a:
1. Encontrar productos en el catálogo
2. Consultar precios, características y disponibilidad
3. Crear reservas de productos
4. Consultar y cancelar sus reservas

REGLAS IMPORTANTES:
- Solo conoces el inventario de esta empresa — nunca inventas productos ni precios
- Siempre verifica stock disponible ANTES de crear una reserva
- Al crear una reserva, SIEMPRE muestra el código y la fecha de expiración
- Responde SIEMPRE en el idioma que usa el cliente
- Si no encuentras un producto, sugiérale al cliente reformular su búsqueda
- Sé conciso, amigable y profesional
- Nunca muestres IDs técnicos al cliente en la respuesta final — solo el código de reserva
- Si el cliente no tiene email ni teléfono, puedes crear la reserva igualmente con solo el nombre
- Si el cliente pregunta DÓNDE está un producto o cómo encontrarlo físicamente, usa get_stock_availability o get_product_detail y reporta el pasillo (aisle), estante (shelf) y posición (bin) si están definidos. Ejemplo: "Está en el Pasillo A, Estante 3, Posición B2"

Fecha/hora actual: {current_datetime}
"""


def get_llm_chat():
    """LLM principal para chat — llama-3.3-70b en Groq"""
    return ChatGroq(
        model="llama-3.3-70b-versatile",
        temperature=0.3,
        groq_api_key=settings.groq_api_key,
    )


def get_llm_vision():
    """
    LLM de visión para búsqueda por imagen — llama-4-scout en Groq.
    Se activa ÚNICAMENTE cuando el usuario sube una imagen buscando un producto.
    """
    return ChatGroq(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        temperature=0.2,
        groq_api_key=settings.groq_api_key,
    )


def get_or_create_session(session_id: str, company_id: str, company_name: str) -> AgentExecutor:
    """
    Obtiene o crea un AgentExecutor con memoria para la sesión dada.
    Cada sesión mantiene los últimos 10 turnos de conversación.
    """
    if session_id in _session_store:
        return _session_store[session_id]

    # Crear memoria de ventana
    memory = ConversationBufferWindowMemory(
        k=10,
        memory_key="chat_history",
        return_messages=True,
    )
    _memory_store[session_id] = memory

    # Crear tools con company_id inyectado
    tools = create_inventory_tools(company_id, supabase)

    # LLM
    llm = get_llm_chat()

    # Prompt
    from datetime import datetime
    prompt = ChatPromptTemplate.from_messages([
        ("system", SYSTEM_PROMPT.format(
            company_name=company_name,
            current_datetime=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
        )),
        MessagesPlaceholder(variable_name="chat_history"),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])

    # ── Normalizador de tool calls malformados ──────────────────────────────
    # Groq/llama a veces genera: name='search_products {"query":"x"}' args={}
    # Lo corregimos antes de que ToolsAgentOutputParser lo rechace.
    def _fix_tool_calls(msg):
        calls = getattr(msg, "tool_calls", None)
        if not calls:
            return msg
        fixed = []
        changed = False
        for tc in calls:
            name = tc.get("name", "")
            if "{" in name or (name and " " in name.strip()):
                m = re.match(r'^(\w+)\s+(\{.*\})$', name.strip(), re.DOTALL)
                if m:
                    try:
                        new_args = json.loads(m.group(2))
                        tc = {**tc, "name": m.group(1), "args": new_args}
                        logger.warning(f"Tool call normalizado: '{name}' → '{m.group(1)}'")
                        changed = True
                    except Exception:
                        pass
            fixed.append(tc)
        if not changed:
            return msg
        try:
            return msg.model_copy(update={"tool_calls": fixed})
        except Exception:
            return msg

    # ── Construir agente manualmente para insertar el normalizador ────────
    try:
        from langchain.agents.format_scratchpad.tool_calling import format_to_tool_messages
        from langchain.agents.output_parsers.tools import ToolsAgentOutputParser
        from langchain_core.runnables import RunnablePassthrough, RunnableLambda

        agent = (
            RunnablePassthrough.assign(
                agent_scratchpad=lambda x: format_to_tool_messages(x["intermediate_steps"])
            )
            | prompt
            | llm.bind_tools(tools)
            | RunnableLambda(_fix_tool_calls)
            | ToolsAgentOutputParser()
        )
        logger.debug("Agente creado con normalizador de tool calls")
    except Exception as import_err:
        logger.warning(f"Fallback a create_tool_calling_agent: {import_err}")
        agent = create_tool_calling_agent(llm, tools, prompt)
    def _on_parse_error(err: Exception) -> str:
        err_str = str(err)
        logger.warning(f"AgentExecutor parse error: {err_str[:120]}")
        if "tool call validation failed" in err_str or "not in request.tools" in err_str:
            return "Hubo un error de formato en la llamada a herramientas. Por favor reintenta la misma acción."
        return f"Error al procesar la respuesta: {err_str[:80]}"

    executor = AgentExecutor(
        agent=agent,
        tools=tools,
        memory=memory,
        verbose=True,
        max_iterations=5,
        handle_parsing_errors=_on_parse_error,
        metadata={
            "session_id": session_id,
            "company_id": company_id,
        }
    )

    _session_store[session_id] = executor
    logger.info(f"Nueva sesión creada: {session_id} para empresa {company_name}")
    return executor


async def chat(
    session_id: str,
    message: str,
    company_slug: str,
) -> tuple[str, list[str]]:
    """
    Procesa un mensaje de chat y retorna (respuesta, tools_usados).
    """
    # Obtener datos de la empresa
    company_resp = supabase.table("companies")\
        .select("id, name, settings")\
        .eq("slug", company_slug)\
        .eq("is_active", True)\
        .single()\
        .execute()

    if not company_resp.data:
        return "Empresa no encontrada.", []

    company = company_resp.data
    company_id = company["id"]
    company_name = company["name"]

    # Verificar suscripción activa
    company_full = supabase.table("companies")\
        .select("subscription_id, subscriptions(status)")\
        .eq("id", company_id)\
        .single()\
        .execute()

    if company_full.data:
        sub_data = company_full.data.get("subscriptions")
        if sub_data and sub_data.get("status") == "suspended":
            return "Este servicio está temporalmente suspendido.", []

    # Obtener o crear sesión
    executor = get_or_create_session(session_id, company_id, company_name)

    invoke_config = {
        "metadata": {
            "session_id": session_id,
            "company_id": company_id,
            "company_slug": company_slug,
        }
    }

    # Patrones de error conocidos del modelo Groq/llama que requieren reintento
    _RETRYABLE_ERRORS = (
        "Failed to call a function",
        "failed_generation",
        "tool call validation failed",
        "not in request.tools",
        "tool_use_failed",
        "invalid tool",
    )

    # Intentar hasta 3 veces antes de usar fallback sin tools
    for attempt in range(3):
        try:
            # En reintento 2+, forzar nueva sesión para limpiar estado corrupto
            if attempt >= 1:
                _session_store.pop(session_id, None)
                _memory_store.pop(session_id, None)
                executor = get_or_create_session(session_id, company_id, company_name)

            result = await executor.ainvoke({"input": message}, config=invoke_config)
            response = result.get("output", "No pude procesar tu mensaje.")
            _log_ai_usage(company_id, session_id, model="llama-3.3-70b-versatile")
            used_tools = []
            if "intermediate_steps" in result:
                for step in result["intermediate_steps"]:
                    if hasattr(step[0], "tool"):
                        used_tools.append(step[0].tool)
            return response, used_tools

        except Exception as e:
            error_str = str(e)
            logger.warning(f"Intento {attempt + 1} fallido: {error_str[:150]}")

            if any(pattern in error_str for pattern in _RETRYABLE_ERRORS):
                if attempt < 2:
                    continue  # reintentar

                # Fallback: respuesta directa sin tools
                logger.warning("Usando fallback sin tools para esta consulta")
                try:
                    llm = get_llm_chat()
                    fallback_prompt = (
                        f"Eres el asistente de inventario de {company_name}. "
                        f"El cliente pregunta: {message}\n\n"
                        "No tienes acceso a herramientas en este momento. "
                        "Responde de forma amigable indicando que puedes ayudar con búsqueda de productos, "
                        "precios y reservas, pero que en este momento hay un inconveniente técnico temporal. "
                        "Invita al cliente a intentar de nuevo en unos segundos."
                    )
                    fallback = await llm.ainvoke(fallback_prompt)
                    return fallback.content, []
                except Exception as fe:
                    logger.error(f"Fallback también falló: {fe}")
                    return "Lo siento, hay un problema técnico temporal. Por favor intenta en unos segundos.", []

            # Error no recuperable
            logger.error(f"Error en chat (intento {attempt + 1}): {e}")
            return "Lo siento, tuve un problema procesando tu mensaje. Intenta de nuevo.", []


async def chat_with_image(
    session_id: str,
    company_slug: str,
    image_base64: str,
    image_media_type: str = "image/jpeg",
    user_text: str = "¿Qué producto es este y cuánto cuesta?",
) -> tuple[str, list[str]]:
    """
    Procesa un mensaje con imagen usando llama-4-scout (visión).
    Se activa SOLO cuando el usuario sube una imagen buscando un producto.
    
    Flujo:
    1. llama-4-scout describe la imagen y extrae características del producto
    2. Se usa esa descripción para hacer búsqueda semántica en pgvector
    3. Se retorna el resultado con precio y disponibilidad
    """
    # Obtener empresa
    company_resp = supabase.table("companies")\
        .select("id, name")\
        .eq("slug", company_slug)\
        .eq("is_active", True)\
        .single()\
        .execute()

    if not company_resp.data:
        return "Empresa no encontrada.", []

    company = company_resp.data
    company_id = company["id"]

    try:
        # PASO 1: Usar llama-4-scout para analizar la imagen
        vision_llm = get_llm_vision()
        
        vision_prompt = (
            "Analiza esta imagen de un producto. Describe detalladamente:\n"
            "1. ¿Qué tipo de producto es?\n"
            "2. Sus características visuales (color, forma, tamaño aparente, material)\n"
            "3. Para qué se usa\n"
            "4. Cualquier texto o marca visible\n\n"
            "Responde en español con una descripción concisa para buscar este producto en un inventario."
        )

        vision_message = HumanMessage(
            content=[
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{image_media_type};base64,{image_base64}"
                    },
                },
                {"type": "text", "text": vision_prompt},
            ]
        )

        vision_response = await vision_llm.ainvoke([vision_message])
        product_description = vision_response.content
        logger.info(f"Descripción de imagen: {product_description[:200]}")

        # PASO 2: Buscar en el inventario con la descripción extraída
        from app.embeddings.embedding_service import generate_embedding
        
        search_query = f"{user_text}. {product_description}"
        query_embedding = await generate_embedding(search_query)

        rpc_result = supabase.rpc("search_products_semantic", {
            "query_embedding": query_embedding,
            "company_id_filter": company_id,
            "match_threshold": 0.35,
            "match_count": 5,
        }).execute()

        _log_ai_usage(company_id, session_id, model="meta-llama/llama-4-scout-17b-16e-instruct")

        if not rpc_result.data:
            return (
                f"Analicé tu imagen: parece ser **{product_description[:150]}**.\n\n"
                "Sin embargo, no encontré productos similares en el inventario. "
                "¿Podrías describirlo con otras palabras?",
                ["vision_search"]
            )

        # PASO 3: Formatear resultados
        products = rpc_result.data
        lines = [
            f"🔍 Analicé tu imagen y encontré productos similares:\n",
            f"*La imagen parece mostrar: {product_description[:100]}...*\n\n",
            "**Productos más parecidos:**\n"
        ]

        for p in products[:4]:
            sim = p.get("similarity", 0)
            lines.append(
                f"• **{p['name']}** — ${p['price']} / {p['unit']}\n"
                f"  {p.get('description', '')[:80]}...\n"
                f"  Similitud: {sim:.0%}\n"
            )

        lines.append("\n¿Te interesa alguno de estos productos? Puedo darte más detalles o hacer una reserva.")
        
        return "\n".join(lines), ["vision_search", "search_products"]

    except Exception as e:
        logger.error(f"Error en chat_with_image: {e}")
        return "No pude analizar la imagen. Por favor intenta con una imagen más clara.", []


def _log_ai_usage(company_id: str, session_id: str, model: str):
    """Registra uso de IA en la tabla ai_usage_log (estimación básica)."""
    try:
        supabase.table("ai_usage_log").insert({
            "company_id": company_id,
            "session_id": session_id,
            "model": model,
            "tokens_input": 0,   # LangSmith tiene los tokens reales
            "tokens_output": 0,
            "cost_usd": 0,
        }).execute()
    except Exception:
        pass  # No crítico


def clear_session(session_id: str):
    """Limpia la sesión de memoria (útil para testing o reset)."""
    _session_store.pop(session_id, None)
    _memory_store.pop(session_id, None)
