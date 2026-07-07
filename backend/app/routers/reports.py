"""
app/routers/reports.py
Reportes profesionales:
  - Aging report (stock sin movimiento)
  - Valuación de inventario (valor total en costo)
  - Importación masiva de productos via CSV/JSON
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import asyncio

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase, run_with_retry as _run_with_retry

router = APIRouter(prefix="/reports", tags=["reports"])


# ── 4.1  Aging Report ─────────────────────────────────────────────────
@router.get("/aging")
async def aging_report(user: dict = Depends(require_staff)):
    """
    Retorna productos agrupados por antigüedad de su último movimiento:
    0-30d (activo), 31-60d, 61-90d, 91-180d, 180d+ (stock muerto).
    """
    company_id = user["company_id"]

    # 1. Productos activos con stock
    products_res, movements_res = await asyncio.gather(
        _run_with_retry(lambda: supabase.table("products")
            .select("id, name, sku, unit, category_id, images, "
                    "product_warehouse_stock(quantity, warehouse_id)")
            .eq("company_id", company_id)
            .eq("is_active", True)
            .execute()),
        _run_with_retry(lambda: supabase.table("stock_movements")
            .select("product_id, created_at, products!inner(company_id)")
            .eq("products.company_id", company_id)
            .order("created_at", desc=True)
            .execute()),
    )

    products = products_res.data or []
    movements = movements_res.data or []

    # Mapa: product_id → last movement date (timezone-aware UTC)
    last_movement_map: dict[str, datetime] = {}
    for m in movements:
        pid = m["product_id"]
        # Supabase devuelve "2024-01-15T10:30:00+00:00" o "...Z"
        dt = datetime.fromisoformat(m["created_at"].replace("Z", "+00:00"))
        if pid not in last_movement_map or dt > last_movement_map[pid]:
            last_movement_map[pid] = dt

    now = datetime.now(timezone.utc)

    # 2. Categorías para enriquecer
    cat_res = await _run_with_retry(
        lambda: supabase.table("categories")
            .select("id, name").eq("company_id", company_id).execute()
    )
    cat_map = {c["id"]: c["name"] for c in (cat_res.data or [])}

    result = []
    for p in products:
        stock_records = p.get("product_warehouse_stock") or []
        total_stock = sum(s["quantity"] for s in stock_records)

        last_mv = last_movement_map.get(p["id"])
        days_idle = (now - last_mv).days if last_mv else None

        # Bucket
        if days_idle is None:
            bucket = "sin_movimiento"
        elif days_idle <= 30:
            bucket = "0_30"
        elif days_idle <= 60:
            bucket = "31_60"
        elif days_idle <= 90:
            bucket = "61_90"
        elif days_idle <= 180:
            bucket = "91_180"
        else:
            bucket = "180_plus"

        result.append({
            "product_id":    p["id"],
            "product_name":  p["name"],
            "sku":           p.get("sku"),
            "unit":          p["unit"],
            "category_name": cat_map.get(p.get("category_id"), "—"),
            "image":         (p.get("images") or [None])[0],
            "total_stock":   total_stock,
            "last_movement": last_mv.isoformat() if last_mv else None,
            "days_idle":     days_idle,
            "bucket":        bucket,
        })

    # Ordenar: más parado primero
    result.sort(key=lambda x: (x["days_idle"] is None, -(x["days_idle"] or 999999)))
    return result


# ── 4.2  Valuación ────────────────────────────────────────────────────
@router.get("/valuation")
async def valuation_report(user: dict = Depends(require_staff)):
    """
    Retorna el valor total del inventario por producto (stock × costo).
    Solo incluye productos con cost_price definido.
    """
    company_id = user["company_id"]

    products_res = await _run_with_retry(
        lambda: supabase.table("products")
            .select("id, name, sku, unit, price, cost_price, category_id, "
                    "product_warehouse_stock(quantity, warehouse_id, warehouses(name))")
            .eq("company_id", company_id)
            .eq("is_active", True)
            .execute()
    )
    products = products_res.data or []

    cat_res = await _run_with_retry(
        lambda: supabase.table("categories")
            .select("id, name").eq("company_id", company_id).execute()
    )
    cat_map = {c["id"]: c["name"] for c in (cat_res.data or [])}

    total_value = 0.0
    rows = []

    for p in products:
        stock_records = p.get("product_warehouse_stock") or []
        total_stock = sum(s["quantity"] for s in stock_records)
        cost = p.get("cost_price") or 0
        value = total_stock * cost
        total_value += value

        rows.append({
            "product_id":    p["id"],
            "product_name":  p["name"],
            "sku":           p.get("sku"),
            "unit":          p["unit"],
            "category_name": cat_map.get(p.get("category_id"), "—"),
            "sale_price":    p.get("price", 0),
            "cost_price":    cost,
            "total_stock":   total_stock,
            "total_value":   value,
            "margin_pct":    round(((p.get("price", 0) - cost) / p.get("price", 1)) * 100, 1)
                             if p.get("price", 0) > 0 and cost > 0 else None,
            "by_warehouse":  [
                {
                    "warehouse_name": (s.get("warehouses") or {}).get("name", "—"),
                    "quantity":       s["quantity"],
                    "value":          s["quantity"] * cost,
                }
                for s in stock_records
            ],
        })

    rows.sort(key=lambda x: x["total_value"], reverse=True)
    return {"total_value": round(total_value, 2), "products": rows}


# ── 4.4  Importación masiva ───────────────────────────────────────────
@router.post("/import/products")
async def import_products(payload: dict, user: dict = Depends(require_admin)):
    """
    Importación masiva de productos.
    Recibe lista de productos parseados desde CSV/Excel en el frontend.
    Retorna resultado con creados/actualizados/errores.
    """
    from app.embeddings.embedding_service import generate_embedding

    company_id = user["company_id"]
    rows: list = payload.get("products", [])

    if not rows:
        raise HTTPException(400, "Sin productos para importar")
    if len(rows) > 500:
        raise HTTPException(400, "Máximo 500 productos por importación")

    created, updated, errors = 0, 0, []

    for i, row in enumerate(rows):
        try:
            name = str(row.get("name") or "").strip()
            if not name:
                errors.append({"row": i + 1, "error": "Nombre requerido"})
                continue

            price = float(row.get("price") or 0)
            cost_price = float(row.get("cost_price") or 0) or None

            product_data = {
                "company_id":   company_id,
                "name":         name,
                "description":  str(row.get("description") or ""),
                "sku":          str(row.get("sku") or "").strip() or None,
                "barcode":      str(row.get("barcode") or "").strip() or None,
                "price":        price,
                "cost_price":   cost_price,
                "unit":         str(row.get("unit") or "unidad"),
                "tags":         [t.strip() for t in str(row.get("tags") or "").split(",") if t.strip()],
                "is_active":    True,
                "attributes":   {},
                "images":       [],
                "units":        [],
                "variant_attributes": {},
            }

            # Generar embedding
            embedding_text = f"{name} {product_data['description']}"
            try:
                embedding = await generate_embedding(embedding_text)
                product_data["embedding"] = embedding
            except Exception:
                pass

            # Verificar si existe por SKU
            if product_data["sku"]:
                existing_query = supabase.table("products")\
                    .select("id")\
                    .eq("company_id", company_id)\
                    .eq("sku", product_data["sku"])\
                    .maybe_single()
                existing = await _run_with_retry(lambda q=existing_query: q.execute())
                if existing and existing.data:
                    update_query = supabase.table("products")\
                        .update({k: v for k, v in product_data.items() if k != "company_id"})\
                        .eq("id", existing.data["id"])
                    await _run_with_retry(lambda q=update_query: q.execute())
                    updated += 1
                    continue

            insert_query = supabase.table("products").insert(product_data)
            await _run_with_retry(lambda q=insert_query: q.execute())
            created += 1

        except Exception as e:
            errors.append({"row": i + 1, "error": str(e)[:100]})

    return {
        "created": created,
        "updated": updated,
        "errors":  errors,
        "total":   len(rows),
    }
