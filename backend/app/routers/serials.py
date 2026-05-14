"""
app/routers/serials.py
Gestión de números de serie por empresa.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional

from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase

router = APIRouter(prefix="/serials", tags=["serials"])

VALID_STATUSES = ("in_stock", "reserved", "sold", "retired")


@router.get("/")
async def list_serials(
    product_id: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    user: dict = Depends(require_staff),
):
    """Lista números de serie de la empresa."""
    company_id = user["company_id"]

    query = supabase.table("product_serial_numbers")\
        .select("*, products(name, unit), warehouses(name)")\
        .eq("company_id", company_id)\
        .order("created_at", desc=True)

    if product_id:
        query = query.eq("product_id", product_id)
    if status:
        query = query.eq("status", status)
    if search:
        query = query.ilike("serial_number", f"%{search}%")

    result = query.limit(200).execute()
    return result.data or []


@router.post("/")
async def create_serial(data: dict, user: dict = Depends(require_admin)):
    """Registra uno o más números de serie."""
    company_id = user["company_id"]

    # Verificar que el producto pertenece a la empresa
    product_id = data.get("product_id")
    warehouse_id = data.get("warehouse_id")
    serials = data.get("serial_numbers", [])  # lista de strings

    if not product_id or not warehouse_id or not serials:
        raise HTTPException(400, "product_id, warehouse_id y serial_numbers son requeridos")

    prod = supabase.table("products")\
        .select("id")\
        .eq("id", product_id)\
        .eq("company_id", company_id)\
        .single().execute()
    if not prod.data:
        raise HTTPException(404, "Producto no encontrado")

    rows = [
        {
            "company_id": company_id,
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "serial_number": sn.strip(),
            "status": "in_stock",
            "notes": data.get("notes"),
        }
        for sn in serials if sn.strip()
    ]

    if not rows:
        raise HTTPException(400, "No se proporcionaron números de serie válidos")

    result = supabase.table("product_serial_numbers").insert(rows).execute()
    return {"created": len(result.data or []), "serials": result.data}


@router.get("/search/{serial_number}")
async def find_serial(serial_number: str, user: dict = Depends(require_staff)):
    """Busca un número de serie específico."""
    company_id = user["company_id"]

    result = supabase.table("product_serial_numbers")\
        .select("*, products(name, unit, price), warehouses(name)")\
        .eq("company_id", company_id)\
        .eq("serial_number", serial_number.upper())\
        .single()\
        .execute()

    if not result.data:
        raise HTTPException(404, f"Número de serie '{serial_number}' no encontrado")

    return result.data


@router.patch("/{serial_id}")
async def update_serial(serial_id: str, data: dict, user: dict = Depends(require_admin)):
    """Actualiza el estado o notas de un número de serie."""
    company_id = user["company_id"]

    existing = supabase.table("product_serial_numbers")\
        .select("id")\
        .eq("id", serial_id)\
        .eq("company_id", company_id)\
        .single().execute()

    if not existing.data:
        raise HTTPException(404, "Número de serie no encontrado")

    allowed = {k: v for k, v in data.items() if k in ("status", "notes", "warehouse_id")}
    if "status" in allowed and allowed["status"] not in VALID_STATUSES:
        raise HTTPException(400, f"Estado inválido. Válidos: {VALID_STATUSES}")

    result = supabase.table("product_serial_numbers")\
        .update(allowed)\
        .eq("id", serial_id)\
        .execute()

    return result.data[0] if result.data else {}


@router.delete("/{serial_id}")
async def delete_serial(serial_id: str, user: dict = Depends(require_admin)):
    """Elimina un número de serie (solo si está en in_stock)."""
    company_id = user["company_id"]

    existing = supabase.table("product_serial_numbers")\
        .select("id, status")\
        .eq("id", serial_id)\
        .eq("company_id", company_id)\
        .single().execute()

    if not existing.data:
        raise HTTPException(404, "No encontrado")
    if existing.data["status"] != "in_stock":
        raise HTTPException(400, "Solo se pueden eliminar series con estado 'in_stock'")

    supabase.table("product_serial_numbers").delete().eq("id", serial_id).execute()
    return {"message": "Eliminado"}
