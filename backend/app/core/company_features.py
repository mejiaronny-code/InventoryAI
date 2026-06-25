"""
app/core/company_features.py
Helpers compartidos para endpoints públicos: cargar la empresa por slug
y verificar si el catálogo público (catálogo, chat IA, reservas) está activo.
"""
from fastapi import HTTPException
from app.core.supabase_client import supabase


def get_active_company(company_slug: str, select: str = "id, name, features") -> dict:
    """Obtiene una empresa activa por slug o lanza 404."""
    res = supabase.table("companies")\
        .select(select)\
        .eq("slug", company_slug)\
        .eq("is_active", True)\
        .single()\
        .execute()
    if not res.data:
        raise HTTPException(404, "Empresa no encontrada")
    return res.data


def require_public_catalog(company: dict) -> None:
    """Lanza 404 si la empresa desactivó el catálogo público (features.public_catalog = false)."""
    features = company.get("features") or {}
    if features.get("public_catalog", True) is False:
        raise HTTPException(404, "Esta empresa no tiene catálogo público disponible")
