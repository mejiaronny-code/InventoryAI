"""
app/routers/putaway.py
Reglas de ubicación automática (putaway rules).
Cuando llega stock, el sistema sugiere dónde guardarlo según categoría o producto.
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
import asyncio

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase

router = APIRouter(prefix="/putaway", tags=["putaway"])


@router.get("/")
async def list_rules(user: dict = Depends(require_staff)):
    """Lista todas las reglas de putaway de la empresa."""
    company_id = user["company_id"]
    result = await asyncio.to_thread(
        lambda: supabase.table("putaway_rules")
            .select("*, warehouses(name), categories(name), products(name)")
            .eq("company_id", company_id)
            .order("priority", desc=True)
            .execute()
    )
    return result.data or []


@router.post("/")
async def create_rule(data: dict, user: dict = Depends(require_admin)):
    """Crea una regla de putaway."""
    company_id = user["company_id"]

    if not data.get("category_id") and not data.get("product_id"):
        raise HTTPException(400, "Debe especificar category_id o product_id")
    if not data.get("warehouse_id"):
        raise HTTPException(400, "warehouse_id es requerido")

    row = {
        "company_id":   company_id,
        "warehouse_id": data["warehouse_id"],
        "category_id":  data.get("category_id"),
        "product_id":   data.get("product_id"),
        "aisle":        data.get("aisle"),
        "shelf":        data.get("shelf"),
        "bin":          data.get("bin"),
        "priority":     data.get("priority", 0),
        "notes":        data.get("notes"),
    }
    result = await asyncio.to_thread(
        lambda: supabase.table("putaway_rules").insert(row).execute()
    )
    return result.data[0] if result.data else {}


@router.patch("/{rule_id}")
async def update_rule(rule_id: str, data: dict, user: dict = Depends(require_admin)):
    """Actualiza una regla de putaway."""
    company_id = user["company_id"]
    existing = await asyncio.to_thread(
        lambda: supabase.table("putaway_rules")
            .select("id").eq("id", rule_id).eq("company_id", company_id)
            .maybe_single().execute()
    )
    if not (existing and existing.data):
        raise HTTPException(404, "Regla no encontrada")

    allowed = {k: v for k, v in data.items() if k in
               ("warehouse_id", "category_id", "product_id", "aisle", "shelf", "bin", "priority", "notes")}
    await asyncio.to_thread(
        lambda: supabase.table("putaway_rules").update(allowed).eq("id", rule_id).execute()
    )
    return {"message": "Regla actualizada"}


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str, user: dict = Depends(require_admin)):
    company_id = user["company_id"]
    existing = await asyncio.to_thread(
        lambda: supabase.table("putaway_rules")
            .select("id").eq("id", rule_id).eq("company_id", company_id)
            .maybe_single().execute()
    )
    if not (existing and existing.data):
        raise HTTPException(404, "Regla no encontrada")
    await asyncio.to_thread(
        lambda: supabase.table("putaway_rules").delete().eq("id", rule_id).execute()
    )
    return {"message": "Regla eliminada"}


@router.get("/suggest")
async def suggest_location(
    product_id: str,
    warehouse_id: str,
    user: dict = Depends(require_staff),
):
    """
    Sugiere ubicación para un producto en un almacén.
    Prioridad: regla específica de producto > regla de categoría.
    """
    company_id = user["company_id"]

    # Obtener categoría del producto
    prod = await asyncio.to_thread(
        lambda: supabase.table("products")
            .select("category_id")
            .eq("id", product_id)
            .eq("company_id", company_id)
            .maybe_single().execute()
    )
    category_id = (prod.data or {}).get("category_id") if prod else None

    # Buscar regla específica de producto primero
    rules_res = await asyncio.to_thread(
        lambda: supabase.table("putaway_rules")
            .select("*")
            .eq("company_id", company_id)
            .eq("warehouse_id", warehouse_id)
            .order("priority", desc=True)
            .execute()
    )
    rules = rules_res.data or []

    # 1. Buscar regla de producto específico
    for rule in rules:
        if rule.get("product_id") == product_id:
            return {"aisle": rule.get("aisle"), "shelf": rule.get("shelf"), "bin": rule.get("bin"), "source": "product"}

    # 2. Buscar regla de categoría
    if category_id:
        for rule in rules:
            if rule.get("category_id") == category_id:
                return {"aisle": rule.get("aisle"), "shelf": rule.get("shelf"), "bin": rule.get("bin"), "source": "category"}

    return {"aisle": None, "shelf": None, "bin": None, "source": None}
