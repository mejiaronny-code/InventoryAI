"""
app/routers/batches.py
Gestión de lotes (batch tracking) por empresa.
Solo activo cuando la empresa tiene el feature 'batch_tracking' habilitado.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from datetime import datetime, timedelta
import asyncio

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase
from app.models.schemas import BatchCreate, BatchOut, BatchUpdate

router = APIRouter(prefix="/batches", tags=["batches"])


def _generate_batch_code(product_id: str) -> str:
    """Genera un código de lote único basado en fecha + producto."""
    date_part = datetime.utcnow().strftime("%y%m%d%H%M")
    prod_part = product_id[:4].upper()
    return f"LOT-{date_part}-{prod_part}"


@router.get("/")
async def list_batches(
    product_id: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    include_empty: bool = False,
    expiring_days: Optional[int] = None,
    user: dict = Depends(require_staff),
):
    """Lista lotes de la empresa, ordenados FIFO (más antiguo primero)."""
    company_id = user["company_id"]

    product_ids_res = await asyncio.to_thread(
        lambda: supabase.table("products")
            .select("id, name, unit")
            .eq("company_id", company_id)
            .eq("is_active", True)
            .execute()
    )
    product_map = {p["id"]: p for p in (product_ids_res.data or [])}
    all_ids = list(product_map.keys())
    if not all_ids:
        return []

    # Filtrar por producto específico si se pide
    filter_ids = [product_id] if product_id else all_ids

    query_fn_parts = {
        "base": lambda: supabase.table("product_batches")
            .select("*, warehouses(name)")
            .in_("product_id", filter_ids)
            .order("received_at", desc=False),
    }

    def _build_query():
        q = supabase.table("product_batches")\
            .select("*, warehouses(name)")\
            .in_("product_id", filter_ids)\
            .order("received_at", desc=False)
        if warehouse_id:
            q = q.eq("warehouse_id", warehouse_id)
        if not include_empty:
            q = q.gt("quantity", 0)
        if expiring_days is not None:
            cutoff = (datetime.utcnow() + timedelta(days=expiring_days)).isoformat()
            q = q.not_.is_("expires_at", "null").lte("expires_at", cutoff)
        return q.execute()

    result = await asyncio.to_thread(_build_query)
    rows = result.data or []

    enriched = []
    for row in rows:
        p = product_map.get(row["product_id"], {})
        wh = (row.get("warehouses") or {}).get("name", "—")
        expires = row.get("expires_at")
        days_left = None
        if expires:
            try:
                days_left = (datetime.fromisoformat(expires.replace("Z", "")) - datetime.utcnow()).days
            except Exception:
                pass
        enriched.append({
            **{k: v for k, v in row.items() if k != "warehouses"},
            "product_name": p.get("name", "—"),
            "product_unit": p.get("unit", "—"),
            "warehouse_name": wh,
            "days_left": days_left,
            "consumed": (row.get("initial_quantity") or row["quantity"]) - row["quantity"],
        })

    return enriched


@router.post("/")
async def create_batch(data: BatchCreate, user: dict = Depends(require_admin)):
    """Crea un nuevo lote manualmente."""
    company_id = user["company_id"]

    product_res = await asyncio.to_thread(
        lambda: supabase.table("products")
            .select("id, name")
            .eq("id", str(data.product_id))
            .eq("company_id", company_id)
            .single()
            .execute()
    )
    if not product_res.data:
        raise HTTPException(404, "Producto no encontrado")

    batch_code = data.batch_code or _generate_batch_code(str(data.product_id))

    existing = await asyncio.to_thread(
        lambda: supabase.table("product_batches")
            .select("id")
            .eq("company_id", company_id)
            .eq("batch_code", batch_code)
            .execute()
    )
    if existing.data:
        batch_code = f"{batch_code}-{str(data.product_id)[:4].upper()}"

    batch_data = {
        "company_id": company_id,
        "product_id": str(data.product_id),
        "warehouse_id": str(data.warehouse_id),
        "batch_code": batch_code,
        "quantity": data.quantity,
        "initial_quantity": data.quantity,
        "received_at": (data.received_at or datetime.utcnow()).isoformat(),
        "notes": data.notes,
    }
    if data.expires_at:
        batch_data["expires_at"] = data.expires_at.isoformat()

    result = await asyncio.to_thread(
        lambda: supabase.table("product_batches").insert(batch_data).execute()
    )
    if not result.data:
        raise HTTPException(500, "Error al crear lote")

    return result.data[0]


@router.patch("/{batch_id}")
async def update_batch(batch_id: str, data: BatchUpdate, user: dict = Depends(require_admin)):
    """Actualiza un lote."""
    company_id = user["company_id"]

    existing = await asyncio.to_thread(
        lambda: supabase.table("product_batches")
            .select("id")
            .eq("id", batch_id)
            .eq("company_id", company_id)
            .single()
            .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Lote no encontrado")

    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if update.get("expires_at"):
        update["expires_at"] = update["expires_at"].isoformat()

    await asyncio.to_thread(
        lambda: supabase.table("product_batches").update(update).eq("id", batch_id).execute()
    )
    return {"message": "Lote actualizado"}


@router.delete("/{batch_id}")
async def delete_batch(batch_id: str, user: dict = Depends(require_admin)):
    """Elimina un lote vacío."""
    company_id = user["company_id"]

    batch = await asyncio.to_thread(
        lambda: supabase.table("product_batches")
            .select("id, quantity, batch_code")
            .eq("id", batch_id)
            .eq("company_id", company_id)
            .single()
            .execute()
    )
    if not batch.data:
        raise HTTPException(404, "Lote no encontrado")
    if batch.data["quantity"] > 0:
        raise HTTPException(400, f"No se puede eliminar: el lote tiene {batch.data['quantity']} unidades")

    await asyncio.to_thread(
        lambda: supabase.table("product_batches").delete().eq("id", batch_id).execute()
    )
    return {"message": "Lote eliminado"}
