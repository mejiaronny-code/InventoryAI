"""
app/routers/knowledge.py
Base de conocimiento de la empresa: subir/listar/eliminar documentos
(PDF/Word/Markdown/texto) que el chat IA usa para responder preguntas
institucionales (horarios, políticas, sucursales, FAQs).

Multi-tenant: todo se filtra manualmente por company_id (RLS es la
segunda capa, no la principal — ver CLAUDE.md).
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import Optional, List
import logging

from app.core.auth import require_admin
from app.core.supabase_client import supabase
from app.models.schemas import CompanyDocumentOut
from app.services.knowledge_base import (
    detect_file_type, extract_text, chunk_text,
    ALLOWED_DOC_TYPES, MAX_DOC_SIZE,
)
from app.embeddings.embedding_service import generate_embedding

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/knowledge", tags=["knowledge"])

_DEFAULT_DOCS_LIMIT = 5


def _get_company_id(user: dict) -> str:
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(status_code=401, detail="No se encontró la empresa asociada")
    return company_id


def _get_docs_limit(company_id: str) -> int:
    try:
        res = supabase.table("companies").select("settings").eq("id", company_id).maybe_single().execute()
        limit = (res.data or {}).get("settings", {}).get("knowledge_docs_limit", _DEFAULT_DOCS_LIMIT)
        return int(limit)
    except Exception:
        return _DEFAULT_DOCS_LIMIT


@router.get("/documents", response_model=List[CompanyDocumentOut])
async def list_documents(user: dict = Depends(require_admin)):
    """Lista los documentos de la base de conocimiento de la empresa."""
    company_id = _get_company_id(user)
    res = supabase.table("company_documents")\
        .select("id, title, filename, file_type, status, error_message, chunk_count, created_at")\
        .eq("company_id", company_id)\
        .order("created_at", desc=True)\
        .execute()
    return res.data or []


@router.get("/documents/limit")
async def get_documents_limit(user: dict = Depends(require_admin)):
    """Devuelve el límite de documentos y cuántos lleva subidos la empresa."""
    company_id = _get_company_id(user)
    limit = _get_docs_limit(company_id)
    count_res = supabase.table("company_documents")\
        .select("id", count="exact")\
        .eq("company_id", company_id)\
        .execute()
    current = count_res.count or 0
    return {"limit": limit, "current": current, "remaining": max(0, limit - current)}


@router.post("/documents/upload", response_model=CompanyDocumentOut)
async def upload_document(
    title: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(require_admin),
):
    """
    Sube un documento institucional (PDF/Word/Markdown/texto), extrae su
    texto, lo trocea y genera embeddings para que el chat IA pueda
    responder preguntas basadas en su contenido.

    Respeta el límite de documentos configurado por el superadmin
    (companies.settings.knowledge_docs_limit, default 5).
    """
    company_id = _get_company_id(user)

    # 1. Verificar límite
    limit = _get_docs_limit(company_id)
    count_res = supabase.table("company_documents")\
        .select("id", count="exact")\
        .eq("company_id", company_id)\
        .execute()
    if (count_res.count or 0) >= limit:
        raise HTTPException(
            status_code=403,
            detail=f"Alcanzaste el límite de {limit} documentos en tu plan. "
                   "Elimina alguno o solicita un aumento de límite.",
        )

    # 2. Validar tipo y tamaño
    file_type = detect_file_type(file.filename or "", file.content_type)
    if not file_type:
        raise HTTPException(
            status_code=400,
            detail="Formato no soportado. Sube un archivo PDF, Word (.docx), Markdown (.md) o texto (.txt).",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    if len(file_bytes) > MAX_DOC_SIZE:
        raise HTTPException(status_code=413, detail="El archivo no puede superar 15 MB.")

    # 3. Crear el registro del documento (status=processing)
    doc_res = supabase.table("company_documents").insert({
        "company_id": company_id,
        "title": title.strip()[:200],
        "filename": file.filename or "documento",
        "file_type": file_type,
        "status": "processing",
        "uploaded_by": user.get("id"),
    }).execute()
    document = doc_res.data[0]
    document_id = document["id"]

    # 4. Extraer texto, trocear y generar embeddings
    try:
        text = extract_text(file_bytes, file_type)
        if not text or len(text.strip()) < 20:
            raise ValueError("No se encontró texto legible en el documento.")

        chunks = chunk_text(text)
        if not chunks:
            raise ValueError("No se pudo dividir el documento en fragmentos de texto.")

        rows = []
        for i, chunk in enumerate(chunks):
            embedding = await generate_embedding(chunk, is_query=False)
            rows.append({
                "document_id": document_id,
                "company_id": company_id,
                "chunk_index": i,
                "content": chunk,
                "embedding": embedding,
            })

        supabase.table("company_document_chunks").insert(rows).execute()

        supabase.table("company_documents").update({
            "status": "ready",
            "chunk_count": len(rows),
        }).eq("id", document_id).execute()

        document["status"] = "ready"
        document["chunk_count"] = len(rows)

    except Exception as e:
        logger.error(f"Error procesando documento {document_id}: {e}")
        supabase.table("company_documents").update({
            "status": "error",
            "error_message": str(e)[:500],
        }).eq("id", document_id).execute()
        document["status"] = "error"
        document["error_message"] = str(e)[:500]

    return document


@router.delete("/documents/{document_id}")
async def delete_document(document_id: str, user: dict = Depends(require_admin)):
    """Elimina un documento y sus chunks (multi-tenant: solo de tu empresa)."""
    company_id = _get_company_id(user)

    doc = supabase.table("company_documents")\
        .select("id, company_id")\
        .eq("id", document_id)\
        .maybe_single()\
        .execute()
    if not doc.data or doc.data["company_id"] != company_id:
        raise HTTPException(status_code=404, detail="Documento no encontrado")

    # Los chunks se eliminan en cascada (FK ON DELETE CASCADE)
    supabase.table("company_documents").delete().eq("id", document_id).execute()
    return {"message": "Documento eliminado"}
