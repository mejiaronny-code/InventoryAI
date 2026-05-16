"""
app/routers/reorder.py
Solicitudes de reabastecimiento automático.
Se crean cuando stock < min_stock_alert; el admin las gestiona aquí.
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
import asyncio

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase

router = APIRouter(prefix="/reorder", tags=["reorder"])

VALID_STATUSES = ("pending", "ordered", "received", "cancelled")


@router.get("/")
async def list_requests(
    status: Optional[str] = None,
    user: dict = Depends(require_staff),
):
    company_id = user["company_id"]
    query = supabase.table("reorder_requests")\
        .select("*, products(name, unit, sku), warehouses(name)")\
        .eq("company_id", company_id)\
        .order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    result = await asyncio.to_thread(lambda: query.execute())
    return result.data or []


@router.post("/")
async def create_request(data: dict, user: dict = Depends(require_admin)):
    company_id = user["company_id"]
    if not data.get("product_id") or not data.get("warehouse_id"):
        raise HTTPException(400, "product_id y warehouse_id son requeridos")

    # Verificar que no exista un pending para el mismo producto+almacén
    existing = await asyncio.to_thread(
        lambda: supabase.table("reorder_requests")
            .select("id")
            .eq("company_id", company_id)
            .eq("product_id", data["product_id"])
            .eq("warehouse_id", data["warehouse_id"])
            .eq("status", "pending")
            .maybe_single().execute()
    )
    if existing and existing.data:
        raise HTTPException(409, "Ya existe una solicitud pendiente para este producto en este almacén")

    # Stock actual
    stock = await asyncio.to_thread(
        lambda: supabase.table("product_warehouse_stock")
            .select("quantity, min_stock_alert")
            .eq("product_id", data["product_id"])
            .eq("warehouse_id", data["warehouse_id"])
            .maybe_single().execute()
    )
    stock_row = stock.data if stock else {}

    row = {
        "company_id":         company_id,
        "product_id":         data["product_id"],
        "warehouse_id":       data["warehouse_id"],
        "requested_quantity": data.get("requested_quantity", 0),
        "current_stock":      (stock_row or {}).get("quantity", 0),
        "min_stock_alert":    (stock_row or {}).get("min_stock_alert", 5),
        "notes":              data.get("notes"),
        "status":             "pending",
    }
    result = await asyncio.to_thread(
        lambda: supabase.table("reorder_requests").insert(row).execute()
    )
    return result.data[0] if result.data else {}


@router.patch("/{request_id}")
async def update_request(request_id: str, data: dict, user: dict = Depends(require_admin)):
    company_id = user["company_id"]
    existing = await asyncio.to_thread(
        lambda: supabase.table("reorder_requests")
            .select("id, status")
            .eq("id", request_id).eq("company_id", company_id)
            .maybe_single().execute()
    )
    if not (existing and existing.data):
        raise HTTPException(404, "Solicitud no encontrada")

    new_status = data.get("status")
    if new_status and new_status not in VALID_STATUSES:
        raise HTTPException(400, f"Estado inválido. Válidos: {VALID_STATUSES}")

    allowed = {k: v for k, v in data.items() if k in ("status", "requested_quantity", "notes")}
    allowed["updated_at"] = "now()"
    await asyncio.to_thread(
        lambda: supabase.table("reorder_requests").update(allowed).eq("id", request_id).execute()
    )
    return {"message": "Solicitud actualizada"}


@router.delete("/{request_id}")
async def delete_request(request_id: str, user: dict = Depends(require_admin)):
    company_id = user["company_id"]
    existing = await asyncio.to_thread(
        lambda: supabase.table("reorder_requests")
            .select("id").eq("id", request_id).eq("company_id", company_id)
            .maybe_single().execute()
    )
    if not (existing and existing.data):
        raise HTTPException(404, "Solicitud no encontrada")
    await asyncio.to_thread(
        lambda: supabase.table("reorder_requests").delete().eq("id", request_id).execute()
    )
    return {"message": "Solicitud eliminada"}
