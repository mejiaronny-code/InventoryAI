"""
app/routers/products.py
CRUD de productos con generación automática de embeddings.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional, List
from uuid import UUID

from app.core.auth import require_admin, require_staff, get_current_user
from app.core.supabase_client import supabase
from app.models.schemas import ProductCreate, ProductUpdate, ProductOut, ProductWithStock
from app.embeddings.embedding_service import (
    generate_product_embedding,
    should_regenerate_embedding,
)

router = APIRouter(prefix="/products", tags=["products"])


@router.get("/public/{company_slug}", response_model=List[ProductWithStock])
async def list_public_products(
    company_slug: str,
    category_id: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    """Lista pública del catálogo de productos por slug de empresa."""
    company = supabase.table("companies")\
        .select("id")\
        .eq("slug", company_slug)\
        .eq("is_active", True)\
        .single()\
        .execute()

    if not company.data:
        raise HTTPException(404, "Empresa no encontrada")

    company_id = company.data["id"]

    query = supabase.table("products")\
        .select("*, product_warehouse_stock(quantity, warehouse_id)")\
        .eq("company_id", company_id)\
        .eq("is_active", True)

    if category_id:
        query = query.eq("category_id", category_id)

    if search:
        query = query.ilike("name", f"%{search}%")

    result = query.range(offset, offset + limit - 1).execute()

    products = []
    for p in (result.data or []):
        stock_records = p.pop("product_warehouse_stock", []) or []
        total_stock = sum(s["quantity"] for s in stock_records)
        products.append({**p, "total_stock": total_stock, "available_stock": total_stock})

    return products


@router.get("/", response_model=List[ProductWithStock])
async def list_products(
    category_id: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    user: dict = Depends(require_staff),
):
    """Lista productos de la empresa del usuario autenticado."""
    company_id = user["company_id"]

    query = supabase.table("products")\
        .select("*, product_warehouse_stock(quantity, warehouse_id)")\
        .eq("company_id", company_id)

    if category_id:
        query = query.eq("category_id", category_id)
    if search:
        query = query.ilike("name", f"%{search}%")

    result = query.range(offset, offset + limit - 1).execute()

    products = []
    for p in (result.data or []):
        stock_records = p.pop("product_warehouse_stock", []) or []
        total_stock = sum(s["quantity"] for s in stock_records)
        products.append({**p, "total_stock": total_stock, "available_stock": total_stock})

    return products


@router.get("/{product_id}", response_model=ProductWithStock)
async def get_product(product_id: str, user: dict = Depends(require_staff)):
    result = supabase.table("products")\
        .select("*, product_warehouse_stock(quantity, warehouse_id)")\
        .eq("id", product_id)\
        .eq("company_id", user["company_id"])\
        .single()\
        .execute()

    if not result.data:
        raise HTTPException(404, "Producto no encontrado")

    p = result.data
    stock_records = p.pop("product_warehouse_stock", []) or []
    total_stock = sum(s["quantity"] for s in stock_records)
    return {**p, "total_stock": total_stock, "available_stock": total_stock}


@router.post("/", response_model=ProductOut)
async def create_product(data: ProductCreate, user: dict = Depends(require_admin)):
    """
    Crea un producto y genera su embedding automáticamente.
    El admin no necesita saber de embeddings — es transparente.
    """
    company_id = user["company_id"]

    # Generar embedding si hay texto semántico
    embedding = None
    if data.name or data.description or data.use_cases:
        embedding = await generate_product_embedding(
            data.name,
            data.description or "",
            data.use_cases or "",
        )

    product_data = data.model_dump()
    product_data["company_id"] = company_id
    if embedding:
        product_data["embedding"] = embedding
    if product_data.get("category_id"):
        product_data["category_id"] = str(product_data["category_id"])

    result = supabase.table("products").insert(product_data).execute()
    if not result.data:
        raise HTTPException(500, "Error al crear producto")

    return result.data[0]


@router.put("/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: str,
    data: ProductUpdate,
    user: dict = Depends(require_admin),
):
    """
    Actualiza un producto.
    Regenera el embedding SOLO si cambiaron name/description/use_cases.
    """
    # Obtener estado actual
    current = supabase.table("products")\
        .select("name, description, use_cases, company_id")\
        .eq("id", product_id)\
        .eq("company_id", user["company_id"])\
        .single()\
        .execute()

    if not current.data:
        raise HTTPException(404, "Producto no encontrado")

    update_data = {k: v for k, v in data.model_dump().items() if v is not None}

    # Regenerar embedding si es necesario
    if should_regenerate_embedding(current.data, update_data):
        new_name = update_data.get("name", current.data["name"])
        new_desc = update_data.get("description", current.data.get("description", ""))
        new_uses = update_data.get("use_cases", current.data.get("use_cases", ""))
        update_data["embedding"] = await generate_product_embedding(new_name, new_desc, new_uses)

    if update_data.get("category_id"):
        update_data["category_id"] = str(update_data["category_id"])

    result = supabase.table("products")\
        .update(update_data)\
        .eq("id", product_id)\
        .execute()

    if not result.data:
        raise HTTPException(500, "Error al actualizar")

    return result.data[0]


@router.delete("/{product_id}")
async def delete_product(product_id: str, user: dict = Depends(require_admin)):
    """Soft delete — marca is_active = False."""
    supabase.table("products")\
        .update({"is_active": False})\
        .eq("id", product_id)\
        .eq("company_id", user["company_id"])\
        .execute()
    return {"message": "Producto desactivado"}


@router.post("/{product_id}/regenerate-embedding")
async def regenerate_embedding(product_id: str, user: dict = Depends(require_admin)):
    """Fuerza la regeneración del embedding de un producto."""
    product = supabase.table("products")\
        .select("name, description, use_cases")\
        .eq("id", product_id)\
        .eq("company_id", user["company_id"])\
        .single()\
        .execute()

    if not product.data:
        raise HTTPException(404, "Producto no encontrado")

    p = product.data
    embedding = await generate_product_embedding(
        p["name"], p.get("description", ""), p.get("use_cases", "")
    )

    supabase.table("products")\
        .update({"embedding": embedding})\
        .eq("id", product_id)\
        .execute()

    return {"message": "Embedding regenerado correctamente"}
