"""
app/routers/recipes.py
Recetas de platillos (sector restaurantes) y registro de ventas que
descuenta automáticamente los insumos del inventario.

- GET  /recipes/{dish_id}        → receta de un platillo (insumos + cantidades)
- PUT  /recipes/{dish_id}         → reemplaza la receta del platillo (admin)
- POST /recipes/register-sale     → registra venta de platillos y descuenta insumos
"""
from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import require_staff, require_admin
from app.core.supabase_client import supabase
from app.models.schemas import RecipeUpsert, RegisterSale

router = APIRouter(prefix="/recipes", tags=["recipes"])


@router.get("/{dish_id}")
def get_recipe(dish_id: str, user: dict = Depends(require_staff)):
    """Receta de un platillo: insumos con cantidad y unidad."""
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(401, "No se encontró la empresa asociada")

    result = supabase.table("recipes")\
        .select("id, ingredient_id, quantity, unit, products!recipes_ingredient_id_fkey(name, unit)")\
        .eq("dish_id", dish_id)\
        .eq("company_id", company_id)\
        .execute()

    items = []
    for r in (result.data or []):
        ing = r.get("products") or {}
        items.append({
            "ingredient_id": r["ingredient_id"],
            "ingredient_name": ing.get("name"),
            "quantity": r["quantity"],
            "unit": r.get("unit") or ing.get("unit"),
        })
    return items


@router.put("/{dish_id}")
def set_recipe(dish_id: str, data: RecipeUpsert, user: dict = Depends(require_admin)):
    """Reemplaza por completo la receta de un platillo."""
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(401, "No se encontró la empresa asociada")

    # Verificar que el platillo pertenezca a la empresa
    dish = supabase.table("products")\
        .select("id")\
        .eq("id", dish_id)\
        .eq("company_id", company_id)\
        .maybe_single()\
        .execute()
    if not (dish and dish.data):
        raise HTTPException(404, "Platillo no encontrado")

    # Verificar que TODOS los insumos pertenezcan a la empresa — si no, un
    # admin podría (sin querer o no) descontar stock de OTRA empresa cada vez
    # que se registre una venta de este platillo (vía register-sale abajo).
    ingredient_ids = list({str(item.ingredient_id) for item in data.items})
    if ingredient_ids:
        owned = supabase.table("products")\
            .select("id")\
            .in_("id", ingredient_ids)\
            .eq("company_id", company_id)\
            .execute()
        owned_ids = {r["id"] for r in (owned.data or [])}
        if owned_ids != set(ingredient_ids):
            raise HTTPException(404, "Uno o más insumos no pertenecen a tu empresa")

    rows = [{
        "ingredient_id": str(item.ingredient_id),
        "quantity": item.quantity,
        "unit": item.unit,
    } for item in data.items]

    try:
        result = supabase.rpc("replace_recipe", {
            "p_company_id": company_id,
            "p_dish_id": dish_id,
            "p_items": rows,
        }).execute()
    except Exception as exc:
        message = str(exc)
        if "DISH_NOT_FOUND" in message:
            raise HTTPException(404, "Platillo no encontrado")
        if "INGREDIENT_NOT_FOUND" in message:
            raise HTTPException(404, "Uno o más insumos no pertenecen a tu empresa")
        if "PGRST202" in message or (
            "replace_recipe" in message and "schema cache" in message
        ):
            raise HTTPException(503, "La migración de integridad de recetas está pendiente")
        raise

    count = result.data if isinstance(result.data, int) else len(rows)
    return {"message": "Receta actualizada", "items": count}


def _deplete_ingredient(company_id: str, ingredient_id: str, needed: int,
                        created_by: str, warehouse_id: str | None, note: str) -> dict:
    """
    Descuenta `needed` unidades de un insumo del inventario.
    Elige el almacén con más stock (o el indicado). Registra el movimiento
    de salida y dispara la solicitud de reabastecimiento si queda en bajo.
    Devuelve info de lo descontado y si quedó corto.
    """
    stock_q = supabase.table("product_warehouse_stock")\
        .select("warehouse_id, quantity, min_stock_alert")\
        .eq("product_id", ingredient_id)\
        .execute()
    rows = stock_q.data or []
    if warehouse_id:
        rows = [r for r in rows if r["warehouse_id"] == warehouse_id]

    if not rows:
        return {"deducted": 0, "short": needed, "warehouse_id": None}

    # Almacén con más stock
    row = max(rows, key=lambda r: r["quantity"])
    wh_id = row["warehouse_id"]
    current = row["quantity"]
    deducted = min(current, needed)
    short = needed - deducted

    # Decremento atómico (nunca baja de 0 — mismo comportamiento que antes,
    # ver migración 011_atomic_stock.sql). Elimina la carrera del
    # read-modify-write si dos ventas descuentan el mismo insumo casi a la vez.
    rpc_result = supabase.rpc("decrement_stock_clamped", {
        "p_product_id": ingredient_id,
        "p_warehouse_id": wh_id,
        "p_qty": deducted,
    }).execute()
    new_qty = rpc_result.data if rpc_result.data is not None else max(current - deducted, 0)

    # Movimiento de salida (stock_movements NO tiene company_id — va por product_id)
    supabase.table("stock_movements").insert({
        "product_id":   ingredient_id,
        "warehouse_id": wh_id,
        "type":         "salida",
        "quantity":     deducted,
        "notes":        note,
        "created_by":   created_by,
    }).execute()

    # Auto-reorden si quedó en o bajo el mínimo
    min_alert = row.get("min_stock_alert", 5) or 5
    if new_qty <= min_alert:
        try:
            existing = supabase.table("reorder_requests")\
                .select("id")\
                .eq("company_id", company_id)\
                .eq("product_id", ingredient_id)\
                .eq("warehouse_id", wh_id)\
                .eq("status", "pending")\
                .maybe_single().execute()
            if not (existing and existing.data):
                prod = supabase.table("products").select("name")\
                    .eq("id", ingredient_id).single().execute()
                supabase.table("reorder_requests").insert({
                    "company_id":         company_id,
                    "product_id":         ingredient_id,
                    "warehouse_id":       wh_id,
                    "requested_quantity": min_alert * 3,
                    "current_stock":      new_qty,
                    "min_stock_alert":    min_alert,
                    "status":             "pending",
                    "notes":              "Generado automáticamente por consumo de receta",
                }).execute()
                supabase.table("notifications").insert({
                    "company_id": company_id,
                    "type": "low_stock",
                    "message": f"⚠️ Insumo bajo: {(prod.data or {}).get('name', 'insumo')} — {new_qty} restantes",
                    "target_role": "all",
                    "metadata": {"product_id": ingredient_id, "current_stock": new_qty},
                }).execute()
        except Exception:
            pass  # no crítico

    return {"deducted": deducted, "short": short, "warehouse_id": wh_id}


@router.post("/register-sale")
def register_sale(data: RegisterSale, user: dict = Depends(require_staff)):
    """
    Registra la venta/consumo de platillos y descuenta sus insumos del inventario
    según la receta de cada platillo. Devuelve un resumen con advertencias.
    """
    company_id = user.get("company_id")
    if not company_id:
        raise HTTPException(401, "No se encontró la empresa asociada")

    warehouse_id = str(data.warehouse_id) if data.warehouse_id else None
    dishes_without_recipe: list[str] = []
    shortages: list[dict] = []
    valid_sales: list[dict] = []

    for sale in data.items:
        dish_id = str(sale.dish_id)

        # Nombre del platillo (y validar que sea de la empresa)
        dish = supabase.table("products")\
            .select("name")\
            .eq("id", dish_id)\
            .eq("company_id", company_id)\
            .maybe_single().execute()
        if not (dish and dish.data):
            continue
        dish_name = dish.data["name"]

        # Conserva la respuesta existente para platillos sin receta.
        recipe = supabase.table("recipes")\
            .select("id")\
            .eq("dish_id", dish_id)\
            .eq("company_id", company_id)\
            .limit(1)\
            .execute()
        if not (recipe.data or []):
            dishes_without_recipe.append(dish_name)
            continue

        valid_sales.append({"dish_id": dish_id, "quantity": sale.quantity})

    try:
        result = supabase.rpc("register_recipe_sale", {
            "p_company_id": company_id,
            "p_items": valid_sales,
            "p_warehouse_id": warehouse_id,
            "p_created_by": user["id"],
        }).execute()
    except Exception as exc:
        message = str(exc)
        if "WAREHOUSE_NOT_FOUND" in message:
            raise HTTPException(404, "Almacén no encontrado")
        if "PGRST202" in message or (
            "register_recipe_sale" in message and "schema cache" in message
        ):
            raise HTTPException(503, "La migración de integridad de ventas está pendiente")
        raise

    result_rows = result.data or []
    total_deductions = sum(int(row.get("deducted") or 0) for row in result_rows)
    for row in result_rows:
        if int(row.get("short") or 0) > 0:
            shortages.append({
                "ingredient": row.get("ingredient_name") or "insumo",
                "faltante": int(row["short"]),
                "platillo": row.get("dish_name") or "platillo",
            })

    return {
        "message": "Venta registrada",
        "total_descontado": total_deductions,
        "platillos_sin_receta": dishes_without_recipe,
        "faltantes": shortages,
    }
