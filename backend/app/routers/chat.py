"""
app/routers/chat.py
Endpoints del chat IA.
- POST /chat/message → chat de texto (llama-3.3-70b)
- POST /chat/image → búsqueda por imagen (llama-4-scout, solo cuando hay imagen)
"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
import base64
import imghdr

from app.models.schemas import ChatMessage, ChatResponse
from app.agents.chat_agent import chat, chat_with_image

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("/message", response_model=ChatResponse)
async def send_message(data: ChatMessage):
    """
    Procesa un mensaje de chat de texto.
    Usa llama-3.3-70b-versatile via Groq.
    """
    if not data.message.strip():
        raise HTTPException(400, "El mensaje no puede estar vacío")

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


@router.post("/image", response_model=ChatResponse)
async def send_image_message(
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

    # Leer y convertir a base64
    image_bytes = await image.read()
    if len(image_bytes) > 10 * 1024 * 1024:  # 10MB máximo
        raise HTTPException(400, "La imagen no puede superar 10MB")

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
