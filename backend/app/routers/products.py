"""
app/routers/products.py
CRUD de productos con generación automática de embeddings.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from typing import Optional, List
from uuid import UUID
import httpx
import time
import logging

logger = logging.getLogger(__name__)

from app.core.auth import require_admin, require_staff, get_current_user
from app.core.supabase_client import supabase
from app.core.config import settings
from app.core.company_features import get_active_company, require_public_catalog
from app.models.schemas import ProductCreate, ProductUpdate, ProductOut, ProductWithStock, StockByWarehouse, VariantStockUpsert, VariantStockOut
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
    company = get_active_company(company_slug)
    require_public_catalog(company)

    company_id = company["id"]

    query = supabase.table("products")\
        .select("*, product_warehouse_stock(quantity, warehouse_id, aisle, shelf, bin, nearest_expiry)")\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .neq("product_type", "ingredient")  # los insumos son internos, nunca públicos

    if category_id:
        query = query.eq("category_id", category_id)

    if search:
        query = query.ilike("name", f"%{search}%")

    result = query.range(offset, offset + limit - 1).execute()

    products = []
    for p in (result.data or []):
        stock_records = p.pop("product_warehouse_stock", []) or []
        total_stock = sum(s["quantity"] for s in stock_records)
        products.append({
            **p,
            "total_stock": total_stock,
            "available_stock": total_stock,
            "stock_by_warehouse": stock_records,
        })

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
        .select("*, product_warehouse_stock(quantity, warehouse_id, aisle, shelf, bin, store_location, min_stock_alert, nearest_expiry)")\
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
        products.append({
            **p,
            "total_stock": total_stock,
            "available_stock": total_stock,
            "stock_by_warehouse": stock_records,
        })

    return products


@router.get("/{product_id}", response_model=ProductWithStock)
async def get_product(product_id: str, user: dict = Depends(require_staff)):
    result = supabase.table("products")\
        .select("*, product_warehouse_stock(quantity, warehouse_id, aisle, shelf, bin, nearest_expiry)")\
        .eq("id", product_id)\
        .eq("company_id", user["company_id"])\
        .single()\
        .execute()

    if not result.data:
        raise HTTPException(404, "Producto no encontrado")

    p = result.data
    stock_records = p.pop("product_warehouse_stock", []) or []
    total_stock = sum(s["quantity"] for s in stock_records)
    return {
        **p,
        "total_stock": total_stock,
        "available_stock": total_stock,
        "stock_by_warehouse": stock_records,
    }


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


@router.post("/upload-image")
async def upload_product_image(
    file: UploadFile = File(...),
    user: dict = Depends(require_admin),
):
    """Sube una imagen de producto a Storage y retorna la URL pública."""
    ext = file.filename.split(".")[-1].lower()
    if ext not in ("png", "jpg", "jpeg", "webp"):
        raise HTTPException(400, "Formato no permitido. Usa PNG, JPG o WEBP.")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(400, "El archivo supera 5MB.")

    bucket = "product-images"
    storage_path = f"{user['company_id']}/{int(time.time())}_{file.filename}"
    upload_url = f"{settings.supabase_url}/storage/v1/object/{bucket}/{storage_path}"

    response = httpx.put(
        upload_url,
        content=content,
        headers={
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "apikey": settings.supabase_service_role_key,
            "Content-Type": file.content_type,
            "x-upsert": "true",
        },
        timeout=30,
    )

    if response.status_code not in (200, 201):
        raise HTTPException(500, f"Error al subir imagen: {response.text}")

    public_url = f"{settings.supabase_url}/storage/v1/object/public/{bucket}/{storage_path}"
    return {"url": public_url}


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


@router.post("/reembed-all")
async def reembed_all_products(user: dict = Depends(require_admin)):
    """
    Re-genera los embeddings de TODOS los productos activos de la empresa.
    Usar después de migrar el modelo de embeddings (ej. OpenAI → Qwen3).
    Retorna el número de productos procesados y los fallidos.
    """
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(401, "No se encontró la empresa asociada")

    products_res = supabase.table("products")\
        .select("id, name, description, use_cases")\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .execute()

    products = products_res.data or []
    if not products:
        return {"message": "No hay productos activos", "processed": 0, "failed": 0}

    processed, failed = 0, []

    for p in products:
        try:
            embedding = await generate_product_embedding(
                p["name"], p.get("description") or "", p.get("use_cases") or ""
            )
            supabase.table("products")\
                .update({"embedding": embedding})\
                .eq("id", p["id"])\
                .execute()
            processed += 1
        except Exception as e:
            logger.warning(f"Error re-embebiendo producto {p['id']}: {e}")
            failed.append(p["id"])

    return {
        "message": f"Re-embedding completado: {processed} OK, {len(failed)} fallidos",
        "processed": processed,
        "failed": failed,
    }


@router.get("/{product_id}/variant-stock")
async def get_variant_stock(product_id: str, user: dict = Depends(require_staff)):
    """Retorna el stock de todas las combinaciones de opciones de un producto."""
    # Verificar que el producto pertenece a la empresa
    prod = supabase.table("products")\
        .select("id")\
        .eq("id", product_id)\
        .eq("company_id", user["company_id"])\
        .maybe_single()\
        .execute()
    if not prod.data:
        raise HTTPException(404, "Producto no encontrado")

    result = supabase.table("product_variants_stock")\
        .select("*")\
        .eq("product_id", product_id)\
        .execute()
    return result.data or []


@router.get("/public/{company_slug}/{product_id}/variant-stock")
async def get_variant_stock_public(company_slug: str, product_id: str):
    """Stock de variantes para el catálogo público."""
    company = get_active_company(company_slug)
    require_public_catalog(company)

    result = supabase.table("product_variants_stock")\
        .select("combination, quantity, warehouse_id")\
        .eq("product_id", product_id)\
        .execute()
    return result.data or []


@router.put("/{product_id}/variant-stock")
async def upsert_variant_stock(
    product_id: str,
    items: List[VariantStockUpsert],
    user: dict = Depends(require_admin),
):
    """
    Upsert batch de stock por combinación.
    Reemplaza todas las combinaciones del producto+almacén indicados.
    """
    company_id = user["company_id"]

    # Verificar que el producto pertenece a la empresa
    prod = supabase.table("products")\
        .select("id")\
        .eq("id", product_id)\
        .eq("company_id", company_id)\
        .maybe_single()\
        .execute()
    if not prod.data:
        raise HTTPException(404, "Producto no encontrado")

    if not items:
        return {"message": "Sin cambios"}

    # Agrupar por warehouse para hacer upserts
    rows = [
        {
            "product_id": product_id,
            "warehouse_id": str(item.warehouse_id),
            "combination": item.combination,
            "quantity": item.quantity,
        }
        for item in items
    ]

    result = supabase.table("product_variants_stock")\
        .upsert(rows, on_conflict="product_id,warehouse_id,combination")\
        .execute()

    # ── Sincronizar stock general por almacén ────────────────────────
    # Sumar todas las combinaciones de este producto por warehouse
    # y actualizar product_warehouse_stock para que el catálogo muestre bien
    from collections import defaultdict
    all_vs = supabase.table("product_variants_stock")\
        .select("warehouse_id, quantity")\
        .eq("product_id", product_id)\
        .execute()

    totals: dict[str, int] = defaultdict(int)
    for vs in (all_vs.data or []):
        totals[vs["warehouse_id"]] += vs["quantity"]

    for warehouse_id, total_qty in totals.items():
        existing = supabase.table("product_warehouse_stock")\
            .select("id")\
            .eq("product_id", product_id)\
            .eq("warehouse_id", warehouse_id)\
            .maybe_single()\
            .execute()

        if existing.data:
            supabase.table("product_warehouse_stock")\
                .update({"quantity": total_qty})\
                .eq("product_id", product_id)\
                .eq("warehouse_id", warehouse_id)\
                .execute()
        else:
            supabase.table("product_warehouse_stock").insert({
                "product_id": product_id,
                "warehouse_id": warehouse_id,
                "quantity": total_qty,
                "min_stock_alert": 5,
            }).execute()

    return {"message": f"{len(rows)} combinaciones guardadas", "data": result.data}


@router.get("/{product_id}/variants")
async def get_variants(product_id: str, user: dict = Depends(require_staff)):
    """Retorna todas las variantes de un producto padre."""
    result = supabase.table("products")\
        .select("*, product_warehouse_stock(quantity, warehouse_id, aisle, shelf, bin, nearest_expiry)")\
        .eq("parent_product_id", product_id)\
        .eq("company_id", user["company_id"])\
        .eq("is_active", True)\
        .execute()

    variants = []
    for p in (result.data or []):
        stock_records = p.pop("product_warehouse_stock", []) or []
        total_stock = sum(s["quantity"] for s in stock_records)
        variants.append({
            **p,
            "total_stock": total_stock,
            "available_stock": total_stock,
            "stock_by_warehouse": stock_records,
        })
    return variants
