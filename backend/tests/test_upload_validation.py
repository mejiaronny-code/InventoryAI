"""Los uploads se validan por bytes reales, no por nombre o Content-Type."""
import io
import zipfile

from app.core.uploads import detect_image_type, validate_document_type


def _minimal_docx() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types />")
        archive.writestr("word/document.xml", "<document />")
    return buffer.getvalue()


def test_detecta_imagenes_por_firma():
    assert detect_image_type(b"\x89PNG\r\n\x1a\nresto") == ("png", "image/png")
    assert detect_image_type(b"\xff\xd8\xffresto") == ("jpg", "image/jpeg")
    assert detect_image_type(b"RIFF\x00\x00\x00\x00WEBPresto") == ("webp", "image/webp")


def test_rechaza_html_disfrazado_de_imagen():
    assert detect_image_type(b"<svg><script>alert(1)</script></svg>") is None
    assert detect_image_type(b"<html>no soy foto</html>") is None


def test_documentos_validan_contenido_real():
    assert validate_document_type(b"%PDF-1.7\n", "pdf") == "pdf"
    assert validate_document_type(_minimal_docx(), "docx") == "docx"
    assert validate_document_type("Texto válido".encode(), "txt") == "txt"


def test_rechaza_extension_falsa_o_texto_binario():
    assert validate_document_type(b"<html>falso</html>", "pdf") is None
    assert validate_document_type(b"PK\x03\x04no-es-docx", "docx") is None
    assert validate_document_type(b"\x00\xff\x00", "txt") is None
