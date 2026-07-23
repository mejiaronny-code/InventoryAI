"""
app/routers/products.py
CRUD de productos con generación automática de embeddings.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from typing import Optional, List
from uuid import UUID, uuid4
import asyncio
import httpx
import json
import logging

logger = logging.getLogger(__name__)

from app.core.auth import require_admin, require_staff, get_current_user
from app.core.supabase_client import supabase, run_with_retry
from app.core.config import settings
from app.core.company_features import get_active_company, require_public_catalog
from app.core.uploads import detect_image_type
from app.models.schemas import ProductCreate, ProductUpdate, ProductOut, ProductWithStock, PublicProductOut, StockByWarehouse, VariantStockUpsert, VariantStockUpsertRequest, VariantStockOut
from app.embeddings.embedding_service import (
    generate_product_embedding,
    should_regenerate_embedding,
)

router = APIRouter(prefix="/products", tags=["products"])


_PUBLIC_PRODUCT_COLUMNS = (
    "id, company_id, category_id, name, description, price, unit, images, tags, "
    "is_featured, product_type, parent_product_id, variant_attributes, product_options, "
    "allergens, dietary, is_available, prep_time_minutes, "
    "is_active, product_warehouse_stock(quantity, warehouse_id, nearest_expiry)"
)


async def _validate_product_references(company_id: str, data: dict) -> None:
    """Impide enlazar categorías o productos padre de otro tenant."""
    checks = []
    category_id = data.get("category_id")
    parent_id = data.get("parent_product_id")
    if category_id:
        checks.append((
            "Categoría no encontrada",
            supabase.table("categories").select("id")
                .eq("id", str(category_id)).eq("company_id", company_id).maybe_single(),
        ))
    if parent_id:
        checks.append((
            "Producto padre no encontrado",
            supabase.table("products").select("id")
                .eq("id", str(parent_id)).eq("company_id", company_id).maybe_single(),
        ))
    for detail, query in checks:
        result = await run_with_retry(lambda q=query: q.execute())
        if not (result and result.data):
            raise HTTPException(404, detail)


def _raise_product_write_error(exc: Exception) -> None:
    message = str(exc)
    if "uq_products_company_sku_ci" in message:
        raise HTTPException(409, "Ya existe un producto con ese SKU")
    if "uq_products_company_barcode" in message:
        raise HTTPException(409, "Ya existe un producto con ese código de barras")
    raise exc


@router.get("/public/{company_slug}", response_model=List[PublicProductOut])
async def list_public_products(
    company_slug: str,
    category_id: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    """
    Lista pública del catálogo de productos por slug de empresa.
    Solo columnas públicas — NUNCA cost_price ni aisle/shelf/bin (ver
    PublicProductOut en schemas.py).
    """
    company = await get_active_company(company_slug)
    require_public_catalog(company)

    company_id = company["id"]

    query = supabase.table("products")\
        .select(_PUBLIC_PRODUCT_COLUMNS)\
        .eq("company_id", company_id)\
        .eq("is_active", True)\
        .neq("product_type", "ingredient")  # los insumos son internos, nunca públicos

    if category_id:
        query = query.eq("category_id", category_id)

    if search:
        query = query.ilike("name", f"%{search}%")

    ranged_query = query.range(offset, offset + limit - 1)
    result = await run_with_retry(lambda: ranged_query.execute())

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
def list_products(
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
        # El placeholder del buscador en el admin promete nombre/SKU/descripción
        # — antes solo se filtraba por nombre. Se escapa la coma (separador de
        # condiciones de PostgREST or()) para que un término con coma no rompa
        # el filtro.
        term = search.replace(",", "")
        query = query.or_(f"name.ilike.%{term}%,sku.ilike.%{term}%,description.ilike.%{term}%")

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
def get_product(product_id: str, user: dict = Depends(require_staff)):
    result = supabase.table("products")\
        .select("*, product_warehouse_stock(quantity, warehouse_id, aisle, shelf, bin, store_location, min_stock_alert, nearest_expiry)")\
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
    await _validate_product_references(company_id, data.model_dump())

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

    insert_query = supabase.table("products").insert(product_data)
    try:
        result = await run_with_retry(lambda: insert_query.execute(), idempotent=False)
    except Exception as exc:
        _raise_product_write_error(exc)
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
    current_query = supabase.table("products")\
        .select("name, description, use_cases, company_id")\
        .eq("id", product_id)\
        .eq("company_id", user["company_id"])\
        .single()
    current = await run_with_retry(lambda: current_query.execute())

    if not current.data:
        raise HTTPException(404, "Producto no encontrado")

    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    await _validate_product_references(user["company_id"], update_data)

    # Regenerar embedding si es necesario
    if should_regenerate_embedding(current.data, update_data):
        new_name = update_data.get("name", current.data["name"])
        new_desc = update_data.get("description", current.data.get("description", ""))
        new_uses = update_data.get("use_cases", current.data.get("use_cases", ""))
        update_data["embedding"] = await generate_product_embedding(new_name, new_desc, new_uses)

    if update_data.get("category_id"):
        update_data["category_id"] = str(update_data["category_id"])

    update_query = supabase.table("products")\
        .update(update_data)\
        .eq("id", product_id)\
        .eq("company_id", user["company_id"])
    try:
        result = await run_with_retry(lambda: update_query.execute())
    except Exception as exc:
        _raise_product_write_error(exc)

    if not result.data:
        raise HTTPException(500, "Error al actualizar")

    return result.data[0]


@router.delete("/{product_id}")
def delete_product(product_id: str, user: dict = Depends(require_admin)):
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
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(413, "El archivo supera 5MB.")
    detected = detect_image_type(content)
    if not detected:
        raise HTTPException(400, "El archivo no es una imagen PNG, JPG o WEBP válida.")
    extension, content_type = detected

    bucket = "product-images"
    storage_path = f"{user['company_id']}/{uuid4().hex}.{extension}"
    upload_url = f"{settings.supabase_url}/storage/v1/object/{bucket}/{storage_path}"

    response = await run_with_retry(lambda: httpx.put(
        upload_url,
        content=content,
        headers={
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "apikey": settings.supabase_service_role_key,
            "Content-Type": content_type,
            "x-upsert": "false",
        },
        timeout=30,
    ), idempotent=False)

    if response.status_code not in (200, 201):
        logger.error("Storage rechazó imagen de producto: status=%s", response.status_code)
        raise HTTPException(502, "No se pudo guardar la imagen. Intenta de nuevo.")

    public_url = f"{settings.supabase_url}/storage/v1/object/public/{bucket}/{storage_path}"
    return {"url": public_url}


@router.post("/{product_id}/regenerate-embedding")
async def regenerate_embedding(product_id: str, user: dict = Depends(require_admin)):
    """Fuerza la regeneración del embedding de un producto."""
    product_query = supabase.table("products")\
        .select("name, description, use_cases")\
        .eq("id", product_id)\
        .eq("company_id", user["company_id"])\
        .single()
    product = await run_with_retry(lambda: product_query.execute())

    if not product.data:
        raise HTTPException(404, "Producto no encontrado")

    p = product.data
    embedding = await generate_product_embedding(
        p["name"], p.get("description", ""), p.get("use_cases", "")
    )

    update_query = supabase.table("products")\
        .update({"embedding": embedding})\
        .eq("id", product_id)
    await run_with_retry(lambda: update_query.execute())

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

    products_query = supabase.table("products")\
        .select("id, name, description, use_cases")\
        .eq("company_id", company_id)\
        .eq("is_active", True)
    products_res = await run_with_retry(lambda: products_query.execute())

    products = products_res.data or []
    if not products:
        return {"message": "No hay productos activos", "processed": 0, "failed": 0}

    semaphore = asyncio.Semaphore(4)

    async def reembed_one(p: dict) -> tuple[str, bool]:
        try:
            async with semaphore:
                embedding = await generate_product_embedding(
                    p["name"], p.get("description") or "", p.get("use_cases") or ""
                )
            update_query = supabase.table("products")\
                .update({"embedding": embedding})\
                .eq("id", p["id"])\
                .eq("company_id", company_id)
            await run_with_retry(lambda q=update_query: q.execute())
            return p["id"], True
        except Exception as e:
            logger.warning(f"Error re-embebiendo producto {p['id']}: {e}")
            return p["id"], False

    outcomes = await asyncio.gather(*(reembed_one(p) for p in products))
    failed = [product_id for product_id, ok in outcomes if not ok]
    processed = len(outcomes) - len(failed)

    return {
        "message": f"Re-embedding completado: {processed} OK, {len(failed)} fallidos",
        "processed": processed,
        "failed": failed,
    }


@router.get("/{product_id}/variant-stock")
def get_variant_stock(product_id: str, user: dict = Depends(require_staff)):
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
    company = await get_active_company(company_slug)
    require_public_catalog(company)

    # El producto DEBE pertenecer a esta empresa — si no, cualquiera podría
    # pasar el product_id de OTRA empresa en la URL y filtrar su stock por variante.
    owns_product = await run_with_retry(lambda: supabase.table("products")
        .select("id").eq("id", product_id).eq("company_id", company["id"]).maybe_single().execute())
    if not (owns_product and owns_product.data):
        raise HTTPException(404, "Producto no encontrado")

    query = supabase.table("product_variants_stock")\
        .select("combination, quantity, warehouse_id")\
        .eq("product_id", product_id)
    result = await run_with_retry(lambda: query.execute())
    return result.data or []


@router.put("/{product_id}/variant-stock")
def upsert_variant_stock(
    product_id: str,
    body: VariantStockUpsertRequest,
    user: dict = Depends(require_admin),
):
    """
    Upsert batch de stock por combinación.
    Reemplaza todas las combinaciones del producto+almacén indicados.

    Trazabilidad: este era el único camino para bajar stock que NO pedía
    motivo ni quedaba en `stock_movements` — un ajuste manual aquí era
    invisible en el historial (riesgo real de robo/faltante sin rastro,
    reportado por un usuario). Ahora se compara contra el stock actual en BD:
    si alguna combinación BAJA de cantidad, exige `notes` y registra un
    movimiento tipo "ajuste" por cada combinación que cambió.
    """
    items = body.items
    company_id = user["company_id"]

    # Verificar que el producto pertenece a la empresa
    prod = supabase.table("products")\
        .select("id, name")\
        .eq("id", product_id)\
        .eq("company_id", company_id)\
        .maybe_single()\
        .execute()
    if not prod.data:
        raise HTTPException(404, "Producto no encontrado")

    if not items:
        return {"message": "Sin cambios"}

    # Cantidades actuales, para poder detectar bajas y registrar el delta real
    current_res = supabase.table("product_variants_stock")\
        .select("warehouse_id, combination, quantity")\
        .eq("product_id", product_id)\
        .execute()
    current_map = {
        (row["warehouse_id"], json.dumps(row["combination"], sort_keys=True)): row["quantity"]
        for row in (current_res.data or [])
    }

    changes = []  # (warehouse_id, combination, old_qty, new_qty)
    any_decrease = False
    for item in items:
        key = (str(item.warehouse_id), json.dumps(item.combination, sort_keys=True))
        old_qty = current_map.get(key, 0)
        if item.quantity != old_qty:
            changes.append((str(item.warehouse_id), item.combination, old_qty, item.quantity))
            if item.quantity < old_qty:
                any_decrease = True

    if any_decrease and not (body.notes and body.notes.strip()):
        raise HTTPException(400, "Debes indicar el motivo de la baja de stock")

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

    rpc_rows = [
        {
            "warehouse_id": row["warehouse_id"],
            "combination": row["combination"],
            "quantity": row["quantity"],
        }
        for row in rows
    ]
    try:
        result = supabase.rpc("replace_variant_stock", {
            "p_company_id": company_id,
            "p_product_id": product_id,
            "p_items": rpc_rows,
            "p_notes": body.notes,
            "p_created_by": user["id"],
        }).execute()
    except Exception as exc:
        message = str(exc)
        if "PRODUCT_NOT_FOUND" in message:
            raise HTTPException(404, "Producto no encontrado")
        if "WAREHOUSE_NOT_FOUND" in message:
            raise HTTPException(404, "Almacén no encontrado")
        if "NOTES_REQUIRED" in message:
            raise HTTPException(400, "Debes indicar el motivo de la baja de stock")
        if "PGRST202" in message or (
            "replace_variant_stock" in message and "schema cache" in message
        ):
            raise HTTPException(503, "La migración de integridad de variantes está pendiente")
        raise

    return {"message": f"{len(rows)} combinaciones guardadas", "data": result.data}


@router.get("/{product_id}/variants")
def get_variants(product_id: str, user: dict = Depends(require_staff)):
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
