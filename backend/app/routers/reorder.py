"""
app/routers/reorder.py
Solicitudes de reabastecimiento automático.
Se crean cuando stock < min_stock_alert; el admin las gestiona aquí.
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
import asyncio

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase, run_with_retry as _run_with_retry

router = APIRouter(prefix="/reorder", tags=["reorder"])

VALID_STATUSES = ("pending", "ordered", "received", "cancelled")


async def _assert_reorder_resources(company_id: str, product_id: str, warehouse_id: str):
    product, warehouse = await asyncio.gather(
        asyncio.to_thread(
            lambda: supabase.table("products").select("id")
                .eq("id", product_id).eq("company_id", company_id).maybe_single().execute()
        ),
        asyncio.to_thread(
            lambda: supabase.table("warehouses").select("id")
                .eq("id", warehouse_id).eq("company_id", company_id).maybe_single().execute()
        ),
    )
    if not (product and product.data):
        raise HTTPException(404, "Producto no encontrado")
    if not (warehouse and warehouse.data):
        raise HTTPException(404, "Almacén no encontrado")


@router.get("/")
async def list_requests(
    status: Optional[str] = None,
    user: dict = Depends(require_staff),
):
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(status_code=401, detail="No se encontró la empresa asociada al usuario")

    query = supabase.table("reorder_requests")\
        .select("*, products(name, unit, sku), warehouses(name)")\
        .eq("company_id", company_id)\
        .order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    result = await _run_with_retry(lambda: query.execute())
    requests = result.data or []
    if not requests:
        return requests

    # current_stock y min_stock_alert se guardan como foto al crear la solicitud y
    # quedan desactualizados en cuanto cambian después (reservas, ventas, ajustes,
    # o si el admin edita el mínimo desde Stock). Se sobreescriben aquí con los
    # valores reales para que la lista siempre refleje el estado vigente.
    pairs = {(r["product_id"], r["warehouse_id"]) for r in requests}
    product_ids = list({p for p, _ in pairs})
    stock_query = supabase.table("product_warehouse_stock")\
        .select("product_id, warehouse_id, quantity, min_stock_alert")\
        .in_("product_id", product_ids)
    stock_res = await _run_with_retry(lambda: stock_query.execute())
    stock_map = {(s["product_id"], s["warehouse_id"]): s for s in (stock_res.data or [])}

    for r in requests:
        live = stock_map.get((r["product_id"], r["warehouse_id"]))
        if live:
            r["current_stock"] = live["quantity"]
            r["min_stock_alert"] = live.get("min_stock_alert", r.get("min_stock_alert", 5))

    return requests


@router.post("/")
async def create_request(data: dict, user: dict = Depends(require_admin)):
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(status_code=401, detail="No se encontró la empresa asociada al usuario")
    if not data.get("product_id") or not data.get("warehouse_id"):
        raise HTTPException(400, "product_id y warehouse_id son requeridos")
    await _assert_reorder_resources(
        company_id, data["product_id"], data["warehouse_id"]
    )

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
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(status_code=401, detail="No se encontró la empresa asociada al usuario")
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
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(status_code=401, detail="No se encontró la empresa asociada al usuario")
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
