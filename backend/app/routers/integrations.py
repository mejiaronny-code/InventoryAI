"""
app/routers/integrations.py
Endpoints de integración machine-to-machine, de SOLO LECTURA, para que
otros sistemas (actualmente: Papyrus/RAG) consulten el inventario en
tiempo real y lo combinen con sus propias respuestas.

Seguridad:
- TODOS los endpoints dependen de `verify_service_key` (header X-Service-Key).
- El `company_slug` siempre se resuelve aquí, server-side, contra la tabla
  `companies` — nunca se acepta un company_id directo del caller.
- No hay endpoints de escritura aquí. Cero riesgo de modificar inventario.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from datetime import datetime, timedelta
import asyncio
import logging

from app.core.service_auth import verify_service_key
from app.core.supabase_client import supabase

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/integrations",
    tags=["integrations"],
    dependencies=[Depends(verify_service_key)],
)


# ── Helpers ──────────────────────────────────────────────────────────────

async def _resolve_company(company_slug: str) -> dict:
    """Resuelve company_slug -> {id, name, settings}. 404 si no existe o está inactiva."""
    result = await asyncio.to_thread(
        lambda: supabase.table("companies")
            .select("id, name, settings")
            .eq("slug", company_slug)
            .eq("is_active", True)
            .maybe_single()
            .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail=f"Empresa '{company_slug}' no encontrada o inactiva.")
    return result.data


def _currency_symbol(code: str) -> str:
    return {"USD": "$", "HNL": "L", "EUR": "€", "MXN": "$", "GTQ": "Q"}.get((code or "").upper(), "$")


# ── Schemas ──────────────────────────────────────────────────────────────

class ProductSearchRequest(BaseModel):
    company_slug: str = Field(..., min_length=1)
    query: str = Field(..., min_length=1, max_length=500)
    limit: int = Field(default=8, ge=1, le=20)


# ── 1. Búsqueda semántica de productos ────────────────────────────────────

@router.post("/products/search")
async def search_products(body: ProductSearchRequest):
    """
    Busca productos por texto (semántico + fallback por nombre/tags) y
    devuelve, por cada producto, su stock por almacén.
    """
    from app.embeddings.embedding_service import generate_embedding

    company = await _resolve_company(body.company_slug)
    company_id = company["id"]

    # 1. Búsqueda semántica
    products_map: dict[str, dict] = {}
    try:
        query_embedding = await generate_embedding(body.query)
        sem_result = await asyncio.to_thread(
            lambda: supabase.rpc("search_products_semantic", {
                "query_embedding": query_embedding,
                "company_id_filter": company_id,
                "match_threshold": 0.4,
                "match_count": body.limit,
            }).execute()
        )
        for p in (sem_result.data or []):
            products_map[p["id"]] = p
    except Exception as e:
        logger.warning(f"Búsqueda semántica falló (continuando con fallback): {e}")

    # 2. Fallback por nombre/descripción/tags
    search_term = body.query.strip().lower()
    if search_term.endswith("s") and len(search_term) > 4:
        search_term_singular = search_term[:-1]
    else:
        search_term_singular = search_term

    for term in {search_term, search_term_singular}:
        try:
            kw_res = await asyncio.to_thread(
                lambda t=term: supabase.table("products")
                    .select("id, name, price, unit, description, tags")
                    .eq("company_id", company_id)
                    .eq("is_active", True)
                    .or_(f"name.ilike.%{t}%,description.ilike.%{t}%,use_cases.ilike.%{t}%")
                    .limit(body.limit)
                    .execute()
            )
            for p in (kw_res.data or []):
                products_map.setdefault(p["id"], p)
        except Exception:
            pass

    if not products_map:
        return {"products": []}

    products = list(products_map.values())[:body.limit]
    product_ids = [p["id"] for p in products]

    # 3. Stock por almacén para cada producto
    stock_res = await asyncio.to_thread(
        lambda: supabase.table("product_warehouse_stock")
            .select("product_id, quantity, store_location, warehouses(name)")
            .in_("product_id", product_ids)
            .execute()
    )
    stock_by_product: dict[str, list] = {}
    for s in (stock_res.data or []):
        stock_by_product.setdefault(s["product_id"], []).append({
            "warehouse_name": (s.get("warehouses") or {}).get("name", "Almacén"),
            "quantity": s["quantity"],
            "store_location": s.get("store_location") or None,
        })

    # 4. Opciones (color/talla) por producto
    extra_res = await asyncio.to_thread(
        lambda: supabase.table("products")
            .select("id, product_options")
            .in_("id", product_ids)
            .execute()
    )
    options_by_product = {r["id"]: (r.get("product_options") or []) for r in (extra_res.data or [])}

    out = []
    for p in products:
        rows = stock_by_product.get(p["id"], [])
        out.append({
            "id": p["id"],
            "name": p["name"],
            "price": p.get("price"),
            "unit": p.get("unit"),
            "description": p.get("description"),
            "tags": p.get("tags") or [],
            "total_stock": sum(r["quantity"] for r in rows),
            "stock_by_warehouse": rows,
            "options": options_by_product.get(p["id"], []),
        })

    return {"products": out}


# ── 2. Detalle de un producto ─────────────────────────────────────────────

@router.get("/products/{product_id}")
async def get_product(product_id: str, company_slug: str = Query(...)):
    """Detalle completo de un producto, incluyendo stock por almacén y variantes."""
    company = await _resolve_company(company_slug)
    company_id = company["id"]

    result = await asyncio.to_thread(
        lambda: supabase.table("products")
            .select("*, categories(name, reservation_time_hours)")
            .eq("id", product_id)
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Producto no encontrado.")

    p = result.data
    cat = p.get("categories") or {}

    stock_res = await asyncio.to_thread(
        lambda: supabase.table("product_warehouse_stock")
            .select("quantity, store_location, warehouses(name, location)")
            .eq("product_id", product_id)
            .execute()
    )
    stock_by_warehouse = [
        {
            "warehouse_name": (s.get("warehouses") or {}).get("name", "Almacén"),
            "warehouse_location": (s.get("warehouses") or {}).get("location"),
            "quantity": s["quantity"],
            "store_location": s.get("store_location") or None,
        }
        for s in (stock_res.data or [])
    ]

    variant_stock = []
    if p.get("product_options"):
        vs_res = await asyncio.to_thread(
            lambda: supabase.table("product_variants_stock")
                .select("combination, quantity")
                .eq("product_id", product_id)
                .execute()
        )
        variant_stock = vs_res.data or []

    return {
        "id": p["id"],
        "name": p["name"],
        "sku": p.get("sku"),
        "barcode": p.get("barcode"),
        "price": p.get("price"),
        "unit": p.get("unit"),
        "category": cat.get("name"),
        "tags": p.get("tags") or [],
        "description": p.get("description"),
        "use_cases": p.get("use_cases"),
        "units": p.get("units") or [],
        "product_options": p.get("product_options") or [],
        "variant_stock": variant_stock,
        "stock_by_warehouse": stock_by_warehouse,
        "total_stock": sum(s["quantity"] for s in stock_by_warehouse),
        "reservation_time_hours": p.get("reservation_time_hours") or cat.get("reservation_time_hours") or 24,
    }


# ── 3. Disponibilidad real (descontando reservas) ─────────────────────────

@router.get("/stock/{product_id}")
async def get_stock(product_id: str, company_slug: str = Query(...)):
    """Stock real disponible por almacén, descontando reservas pending/confirmed."""
    company = await _resolve_company(company_slug)
    company_id = company["id"]

    stock_res = await asyncio.to_thread(
        lambda: supabase.table("product_warehouse_stock")
            .select("quantity, warehouse_id, store_location, warehouses(name)")
            .eq("product_id", product_id)
            .execute()
    )
    if not stock_res.data:
        return {"product_id": product_id, "warehouses": [], "total_available": 0}

    reservas_res = await asyncio.to_thread(
        lambda: supabase.table("reservations")
            .select("quantity, warehouse_id")
            .eq("product_id", product_id)
            .eq("company_id", company_id)
            .in_("status", ["pending", "confirmed"])
            .execute()
    )
    reserved_by_wh: dict[str, int] = {}
    for r in (reservas_res.data or []):
        reserved_by_wh[r["warehouse_id"]] = reserved_by_wh.get(r["warehouse_id"], 0) + r["quantity"]

    warehouses = []
    total_available = 0
    for s in stock_res.data:
        wh_id = s["warehouse_id"]
        reserved = reserved_by_wh.get(wh_id, 0)
        available = max(s["quantity"] - reserved, 0)
        total_available += available
        warehouses.append({
            "warehouse_id": wh_id,
            "warehouse_name": (s.get("warehouses") or {}).get("name", "Almacén"),
            "store_location": s.get("store_location") or None,
            "quantity_total": s["quantity"],
            "quantity_reserved": reserved,
            "quantity_available": available,
        })

    return {"product_id": product_id, "warehouses": warehouses, "total_available": total_available}


# ── 4. Productos por vencer ────────────────────────────────────────────────

@router.get("/expiring")
async def get_expiring(company_slug: str = Query(...), days: int = Query(30, le=365)):
    """Productos con stock cuya fecha de vencimiento más cercana está dentro de N días."""
    company = await _resolve_company(company_slug)
    company_id = company["id"]

    cutoff  = (datetime.utcnow() + timedelta(days=days)).isoformat()
    now_iso = datetime.utcnow().isoformat()

    product_ids_res = await asyncio.to_thread(
        lambda: supabase.table("products")
            .select("id").eq("company_id", company_id).eq("is_active", True).execute()
    )
    product_ids = [p["id"] for p in (product_ids_res.data or [])]
    if not product_ids:
        return {"items": []}

    stock_res = await asyncio.to_thread(
        lambda: supabase.table("product_warehouse_stock")
            .select("product_id, warehouse_id, quantity, nearest_expiry, warehouses(name)")
            .in_("product_id", product_ids)
            .not_.is_("nearest_expiry", "null")
            .lte("nearest_expiry", cutoff)
            .gte("nearest_expiry", now_iso)
            .order("nearest_expiry")
            .execute()
    )
    if not stock_res.data:
        return {"items": []}

    pid_set = list({r["product_id"] for r in stock_res.data})
    products_res = await asyncio.to_thread(
        lambda: supabase.table("products").select("id, name, unit").in_("id", pid_set).execute()
    )
    name_map = {p["id"]: p for p in (products_res.data or [])}

    items = []
    for s in stock_res.data:
        p = name_map.get(s["product_id"], {})
        expiry = s["nearest_expiry"]
        days_left = (datetime.fromisoformat(expiry.replace("Z", "")) - datetime.utcnow()).days
        items.append({
            "product_id": s["product_id"],
            "product_name": p.get("name", "—"),
            "unit": p.get("unit", "—"),
            "warehouse_name": (s.get("warehouses") or {}).get("name", "—"),
            "quantity": s["quantity"],
            "nearest_expiry": expiry,
            "days_left": max(days_left, 0),
        })

    return {"items": items}


# ── 5. Lista de tiendas/almacenes ──────────────────────────────────────────

@router.get("/warehouses")
async def list_warehouses(company_slug: str = Query(...)):
    """Lista de tiendas/almacenes activos de la empresa."""
    company = await _resolve_company(company_slug)
    company_id = company["id"]

    result = await asyncio.to_thread(
        lambda: supabase.table("warehouses")
            .select("id, name, location")
            .eq("company_id", company_id)
            .eq("is_active", True)
            .execute()
    )
    return {"warehouses": result.data or []}
