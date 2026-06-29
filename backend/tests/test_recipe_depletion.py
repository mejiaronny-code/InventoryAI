"""
tests/test_recipe_depletion.py
Confiabilidad del descuento de insumos por receta (`_deplete_ingredient`).
Es la lógica que MUEVE inventario real, así que se prueba a fondo:

- descuenta la cantidad correcta del almacén con más stock
- nunca deja el stock por debajo de 0 (reporta el faltante)
- registra el movimiento de salida SIN company_id (la tabla no lo tiene)
- dispara una solicitud de reorden al cruzar el mínimo (y solo entonces)
- no duplica la solicitud de reorden si ya hay una pendiente
- maneja el caso de insumo sin stock
"""
import pytest

from app.routers import recipes


COMPANY = "comp-1"
INGREDIENT = "ing-harina"
USER = "user-1"


@pytest.fixture
def patched(monkeypatch, fake_supabase):
    """Inyecta el Supabase falso dentro del módulo de recetas."""
    monkeypatch.setattr(recipes, "supabase", fake_supabase)
    return fake_supabase


def _seed_stock(db, *, warehouses):
    """warehouses: lista de (warehouse_id, quantity, min_stock_alert)."""
    db.seed("product_warehouse_stock", [
        {"product_id": INGREDIENT, "warehouse_id": wh,
         "quantity": qty, "min_stock_alert": minimo}
        for wh, qty, minimo in warehouses
    ])
    db.seed("products", [{"id": INGREDIENT, "name": "Harina"}])


def test_descuenta_cantidad_correcta(patched):
    _seed_stock(patched, warehouses=[("wh-1", 100, 5)])

    res = recipes._deplete_ingredient(COMPANY, INGREDIENT, 30, USER, None, "venta")

    assert res["deducted"] == 30
    assert res["short"] == 0
    assert res["warehouse_id"] == "wh-1"
    # El stock quedó actualizado
    stock = patched.db["product_warehouse_stock"][0]
    assert stock["quantity"] == 70


def test_elige_almacen_con_mas_stock(patched):
    _seed_stock(patched, warehouses=[("wh-bajo", 10, 5), ("wh-alto", 80, 5)])

    res = recipes._deplete_ingredient(COMPANY, INGREDIENT, 20, USER, None, "venta")

    assert res["warehouse_id"] == "wh-alto"
    por_wh = {r["warehouse_id"]: r["quantity"] for r in patched.db["product_warehouse_stock"]}
    assert por_wh["wh-alto"] == 60   # 80 - 20
    assert por_wh["wh-bajo"] == 10   # intacto


def test_respeta_warehouse_id_indicado(patched):
    _seed_stock(patched, warehouses=[("wh-1", 10, 5), ("wh-2", 80, 5)])

    res = recipes._deplete_ingredient(COMPANY, INGREDIENT, 5, USER, "wh-1", "venta")

    assert res["warehouse_id"] == "wh-1"   # aunque wh-2 tenga más, se respeta el pedido


def test_nunca_baja_de_cero_y_reporta_faltante(patched):
    _seed_stock(patched, warehouses=[("wh-1", 8, 5)])

    res = recipes._deplete_ingredient(COMPANY, INGREDIENT, 20, USER, None, "venta")

    assert res["deducted"] == 8     # solo lo que había
    assert res["short"] == 12       # faltaron 12
    assert patched.db["product_warehouse_stock"][0]["quantity"] == 0


def test_insumo_sin_stock(patched):
    # producto existe pero sin filas de stock
    patched.seed("products", [{"id": INGREDIENT, "name": "Harina"}])

    res = recipes._deplete_ingredient(COMPANY, INGREDIENT, 10, USER, None, "venta")

    assert res["deducted"] == 0
    assert res["short"] == 10
    assert res["warehouse_id"] is None


def test_registra_movimiento_salida_sin_company_id(patched):
    _seed_stock(patched, warehouses=[("wh-1", 50, 5)])

    recipes._deplete_ingredient(COMPANY, INGREDIENT, 10, USER, None, "venta de prueba")

    movs = patched.db["stock_movements"]
    assert len(movs) == 1
    mov = movs[0]
    assert mov["type"] == "salida"
    assert mov["quantity"] == 10
    assert mov["product_id"] == INGREDIENT
    assert mov["created_by"] == USER
    # Bug histórico: stock_movements NO debe llevar company_id
    assert "company_id" not in mov


def test_dispara_reorden_al_cruzar_minimo(patched):
    # Queda en 4, por debajo del mínimo de 5 -> debe generar reorden + notificación
    _seed_stock(patched, warehouses=[("wh-1", 14, 5)])

    res = recipes._deplete_ingredient(COMPANY, INGREDIENT, 10, USER, None, "venta")

    assert res["deducted"] == 10
    reorders = patched.db.get("reorder_requests", [])
    assert len(reorders) == 1
    assert reorders[0]["product_id"] == INGREDIENT
    assert reorders[0]["status"] == "pending"
    assert reorders[0]["current_stock"] == 4
    # También notifica
    notifs = patched.db.get("notifications", [])
    assert len(notifs) == 1
    assert notifs[0]["type"] == "low_stock"


def test_no_dispara_reorden_si_queda_sobre_el_minimo(patched):
    _seed_stock(patched, warehouses=[("wh-1", 100, 5)])

    recipes._deplete_ingredient(COMPANY, INGREDIENT, 10, USER, None, "venta")

    assert patched.db.get("reorder_requests", []) == []
    assert patched.db.get("notifications", []) == []


def test_no_duplica_reorden_si_ya_hay_pendiente(patched):
    _seed_stock(patched, warehouses=[("wh-1", 14, 5)])
    # Ya existe una solicitud pendiente para este insumo/almacén
    patched.seed("reorder_requests", [{
        "company_id": COMPANY, "product_id": INGREDIENT,
        "warehouse_id": "wh-1", "status": "pending",
    }])

    recipes._deplete_ingredient(COMPANY, INGREDIENT, 10, USER, None, "venta")

    # Sigue habiendo solo 1 (no se duplicó)
    assert len(patched.db["reorder_requests"]) == 1
