"""Validación de archivos por firma real, no por extensión/MIME declarado."""
from __future__ import annotations

import io
import zipfile


IMAGE_SIGNATURES = {
    "png": ("image/png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
    "jpg": ("image/jpeg", lambda data: data.startswith(b"\xff\xd8\xff")),
    "webp": (
        "image/webp",
        lambda data: len(data) >= 12
        and data.startswith(b"RIFF")
        and data[8:12] == b"WEBP",
    ),
}


def detect_image_type(data: bytes) -> tuple[str, str] | None:
    """Retorna (extensión segura, MIME real) para PNG/JPEG/WEBP."""
    for extension, (mime_type, matcher) in IMAGE_SIGNATURES.items():
        if matcher(data):
            return extension, mime_type
    return None


def validate_document_type(data: bytes, declared_type: str) -> str | None:
    """Confirma que los bytes corresponden al tipo detectado por nombre/MIME."""
    if declared_type == "pdf":
        return "pdf" if data.startswith(b"%PDF-") else None

    if declared_type == "docx":
        if not data.startswith(b"PK\x03\x04"):
            return None
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = set(archive.namelist())
                if "[Content_Types].xml" not in names or "word/document.xml" not in names:
                    return None
                if any(info.flag_bits & 0x1 for info in archive.infolist()):
                    return None
                # Evita ZIP bombs: un DOCX pequeño no debe expandirse a cientos
                # de MB antes de que python-docx intente procesarlo.
                if sum(info.file_size for info in archive.infolist()) > 30 * 1024 * 1024:
                    return None
            return "docx"
        except (zipfile.BadZipFile, OSError):
            return None

    if declared_type in {"md", "txt"}:
        if b"\x00" in data:
            return None
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            return None
        return declared_type

    return None
