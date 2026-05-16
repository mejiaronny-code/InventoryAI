"""
app/routers/picking.py
Lista de picking: reservas pendientes ordenadas por ubicación física (pasillo→estante→bin).
Permite a los empleados de almacén recoger los ítems de forma eficiente.
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
import asyncio

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase

router = APIRouter(prefix="/picking", tags=["picking"])


@router.get("/")
async def get_picking_list(
    warehouse_id: Optional[str] = None,
    status: Optional[str] = None,   # pending | confirmed | all (default: pending+confirmed)
    user: dict = Depends(require_staff),
):
    """
    Retorna los ítems de picking: reservas activas enriquecidas con la
    ubicación física del producto (pasillo/estante/bin), ordenadas por
    ubicación para minimizar recorrido en el almacén.
    """
    company_id = user["company_id"]

    # 1. Obtener reservas activas
    valid_statuses = ["pending", "confirmed"] if not status or status == "all" else [status]

    reservations_res = await asyncio.to_thread(
        lambda: supabase.table("reservations")
            .select("id, reservation_code, client_name, client_phone, client_email, "
                    "product_id, warehouse_id, quantity, status, expires_at, notes, created_at")
            .eq("company_id", company_id)
            .in_("status", valid_statuses)
            .order("created_at", desc=False)
            .execute()
    )
    reservations = reservations_res.data or []
    if not reservations:
        return []

    # 2. Obtener productos e info de ubicación en paralelo
    product_ids  = list({r["product_id"]  for r in reservations})
    warehouse_ids = list({r["warehouse_id"] for r in reservations})

    products_res, stock_res = await asyncio.gather(
        asyncio.to_thread(
            lambda: supabase.table("products")
                .select("id, name, unit, images, sku, barcode")
                .in_("id", product_ids)
                .execute()
        ),
        asyncio.to_thread(
            lambda: supabase.table("product_warehouse_stock")
                .select("product_id, warehouse_id, quantity, aisle, shelf, bin")
                .in_("product_id", product_ids)
                .execute()
        ),
    )

    warehouses_res = await asyncio.to_thread(
        lambda: supabase.table("warehouses")
            .select("id, name")
            .in_("id", warehouse_ids)
            .execute()
    )

    product_map  = {p["id"]: p for p in (products_res.data or [])}
    warehouse_map = {w["id"]: w for w in (warehouses_res.data or [])}

    # Mapa de stock: (product_id, warehouse_id) → location
    stock_map = {}
    for s in (stock_res.data or []):
        stock_map[(s["product_id"], s["warehouse_id"])] = s

    # 3. Ensamblar ítems de picking
    items = []
    for r in reservations:
        # Filtrar por almacén si se especificó
        if warehouse_id and r["warehouse_id"] != warehouse_id:
            continue

        product = product_map.get(r["product_id"], {})
        warehouse = warehouse_map.get(r["warehouse_id"], {})
        stock = stock_map.get((r["product_id"], r["warehouse_id"]), {})

        aisle = stock.get("aisle") or ""
        shelf = stock.get("shelf") or ""
        bin_  = stock.get("bin")   or ""

        location_label = " · ".join(filter(None, [aisle, shelf, bin_])) or "Sin ubicación"

        items.append({
            "reservation_id":   r["id"],
            "reservation_code": r["reservation_code"],
            "reservation_status": r["status"],
            "client_name":      r["client_name"],
            "client_phone":     r.get("client_phone"),
            "expires_at":       r["expires_at"],
            "notes":            r.get("notes"),
            "product_id":       r["product_id"],
            "product_name":     product.get("name", "—"),
            "product_unit":     product.get("unit", ""),
            "product_sku":      product.get("sku"),
            "product_image":    (product.get("images") or [None])[0],
            "warehouse_id":     r["warehouse_id"],
            "warehouse_name":   warehouse.get("name", "—"),
            "quantity":         r["quantity"],
            "stock_available":  stock.get("quantity", 0),
            "aisle":            aisle,
            "shelf":            shelf,
            "bin":              bin_,
            "location_label":   location_label,
            "created_at":       r["created_at"],
        })

    # 4. Ordenar por ubicación: almacén → pasillo → estante → bin
    items.sort(key=lambda x: (
        x["warehouse_name"],
        x["aisle"].zfill(10) if x["aisle"] else "zzz",
        x["shelf"].zfill(10) if x["shelf"] else "zzz",
        x["bin"].zfill(10)   if x["bin"]   else "zzz",
    ))

    return items


@router.patch("/{reservation_id}/confirm")
async def confirm_pick(reservation_id: str, user: dict = Depends(require_staff)):
    """Marca una reserva como 'confirmed' (ítem recogido por el picker)."""
    company_id = user["company_id"]

    existing = await asyncio.to_thread(
        lambda: supabase.table("reservations")
            .select("id, status")
            .eq("id", reservation_id)
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
    )
    res_row = existing.data if existing else None
    if not res_row:
        raise HTTPException(404, "Reserva no encontrada")
    if res_row["status"] not in ("pending", "confirmed"):
        raise HTTPException(400, f"No se puede confirmar una reserva con estado '{res_row['status']}'")

    await asyncio.to_thread(
        lambda: supabase.table("reservations")
            .update({"status": "confirmed"})
            .eq("id", reservation_id)
            .execute()
    )
    return {"message": "Ítem marcado como recogido"}


@router.patch("/{reservation_id}/complete")
async def complete_pick(reservation_id: str, user: dict = Depends(require_staff)):
    """Marca una reserva como 'completed' (entregada al cliente)."""
    company_id = user["company_id"]

    existing = await asyncio.to_thread(
        lambda: supabase.table("reservations")
            .select("id, status, product_id, warehouse_id, quantity")
            .eq("id", reservation_id)
            .eq("company_id", company_id)
            .maybe_single()
            .execute()
    )
    res_row = existing.data if existing else None
    if not res_row:
        raise HTTPException(404, "Reserva no encontrada")
    if res_row["status"] == "completed":
        raise HTTPException(400, "La reserva ya está completada")
    if res_row["status"] == "cancelled":
        raise HTTPException(400, "No se puede completar una reserva cancelada")

    # Descontar stock físico
    stock = supabase.table("product_warehouse_stock")\
        .select("quantity")\
        .eq("product_id", res_row["product_id"])\
        .eq("warehouse_id", res_row["warehouse_id"])\
        .maybe_single()\
        .execute()
    stock_row = stock.data if stock else None
    current_qty = stock_row["quantity"] if stock_row else 0
    new_qty = max(current_qty - res_row["quantity"], 0)

    if stock_row:
        supabase.table("product_warehouse_stock")\
            .update({"quantity": new_qty})\
            .eq("product_id", res_row["product_id"])\
            .eq("warehouse_id", res_row["warehouse_id"])\
            .execute()

    # Registrar movimiento de salida
    supabase.table("stock_movements").insert({
        "product_id":   res_row["product_id"],
        "warehouse_id": res_row["warehouse_id"],
        "type":         "salida",
        "quantity":     res_row["quantity"],
        "notes":        f"Entrega de reserva #{reservation_id[:8]}",
        "created_by":   user["id"],
    }).execute()

    # Actualizar reserva
    supabase.table("reservations")\
        .update({"status": "completed"})\
        .eq("id", reservation_id)\
        .execute()

    return {"message": "Reserva completada y stock descontado", "new_stock": new_qty}
