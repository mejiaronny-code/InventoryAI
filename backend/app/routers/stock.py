"""
app/routers/stock.py
Movimientos de stock y ajustes de inventario.
"""
from fastapi import APIRouter, Depends, HTTPException
from typing import List

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase
from app.models.schemas import StockMovementCreate, StockMovementOut, StockUpdate

router = APIRouter(prefix="/stock", tags=["stock"])


@router.get("/movements")
async def list_movements(
    product_id: str = None,
    warehouse_id: str = None,
    user: dict = Depends(require_staff),
):
    query = supabase.table("stock_movements")\
        .select("*, products(name), warehouses(name)")\
        .order("created_at", desc=True)\
        .limit(200)

    # Filtrar por empresa via producto
    if product_id:
        query = query.eq("product_id", product_id)
    if warehouse_id:
        query = query.eq("warehouse_id", warehouse_id)

    result = query.execute()
    return result.data or []


@router.post("/movement")
async def create_movement(data: StockMovementCreate, user: dict = Depends(require_staff)):
    """
    Registra un movimiento de stock y actualiza la cantidad en product_warehouse_stock.
    """
    movement_data = {
        **data.model_dump(),
        "product_id": str(data.product_id),
        "warehouse_id": str(data.warehouse_id),
        "created_by": user["id"],
    }

    # Obtener stock actual
    current = supabase.table("product_warehouse_stock")\
        .select("quantity")\
        .eq("product_id", str(data.product_id))\
        .eq("warehouse_id", str(data.warehouse_id))\
        .single()\
        .execute()

    current_qty = current.data["quantity"] if current.data else 0

    # Calcular nuevo stock
    if data.type == "entrada":
        new_qty = current_qty + data.quantity
    elif data.type == "salida":
        new_qty = current_qty - data.quantity
        if new_qty < 0:
            raise HTTPException(400, "Stock insuficiente para la salida")
    elif data.type == "ajuste":
        new_qty = data.quantity  # ajuste directo al valor indicado
    else:
        new_qty = current_qty  # transferencia se maneja por separado

    # Actualizar stock
    if current.data:
        supabase.table("product_warehouse_stock")\
            .update({"quantity": new_qty})\
            .eq("product_id", str(data.product_id))\
            .eq("warehouse_id", str(data.warehouse_id))\
            .execute()
    else:
        supabase.table("product_warehouse_stock").insert({
            "product_id": str(data.product_id),
            "warehouse_id": str(data.warehouse_id),
            "quantity": max(new_qty, 0),
        }).execute()

    # Registrar movimiento
    result = supabase.table("stock_movements").insert(movement_data).execute()

    # Verificar alerta de stock mínimo
    stock_alert = supabase.table("product_warehouse_stock")\
        .select("min_stock_alert")\
        .eq("product_id", str(data.product_id))\
        .eq("warehouse_id", str(data.warehouse_id))\
        .single()\
        .execute()

    if stock_alert.data and new_qty <= stock_alert.data.get("min_stock_alert", 5):
        product = supabase.table("products").select("name, company_id").eq("id", str(data.product_id)).single().execute()
        if product.data:
            supabase.table("notifications").insert({
                "company_id": product.data["company_id"],
                "type": "low_stock",
                "message": f"⚠️ Stock bajo: {product.data['name']} — {new_qty} unidades restantes",
                "target_role": "all",
                "metadata": {"product_id": str(data.product_id), "current_stock": new_qty},
            }).execute()

    return {"message": "Movimiento registrado", "new_quantity": new_qty}


@router.put("/set")
async def set_stock(data: StockUpdate, product_id: str, user: dict = Depends(require_admin)):
    """Establece el stock de un producto en un almacén directamente."""
    existing = supabase.table("product_warehouse_stock")\
        .select("id")\
        .eq("product_id", product_id)\
        .eq("warehouse_id", str(data.warehouse_id))\
        .execute()

    if existing.data:
        supabase.table("product_warehouse_stock")\
            .update({"quantity": data.quantity, "min_stock_alert": data.min_stock_alert})\
            .eq("product_id", product_id)\
            .eq("warehouse_id", str(data.warehouse_id))\
            .execute()
    else:
        supabase.table("product_warehouse_stock").insert({
            "product_id": product_id,
            "warehouse_id": str(data.warehouse_id),
            "quantity": data.quantity,
            "min_stock_alert": data.min_stock_alert,
        }).execute()

    return {"message": "Stock actualizado"}
