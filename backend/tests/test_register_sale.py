"""
tests/test_register_sale.py
Endpoint de registro de venta (`/recipes/register-sale`): descuenta los insumos
de cada platillo según su receta. Se prueban los puntos sensibles:

- el redondeo de `cantidad_receta × cantidad_vendida`
- el aislamiento multi-tenant (no descuenta platillos de otra empresa)
- platillos sin receta se reportan, no truenan
"""
import asyncio
import uuid

import pytest

from app.routers import recipes
from app.models.schemas import RegisterSale, SaleItem


COMPANY = "comp-1"
USER = {"id": "user-1", "company_id": COMPANY}


@pytest.fixture
def patched(monkeypatch, fake_supabase):
    monkeypatch.setattr(recipes, "supabase", fake_supabase)
    return fake_supabase


def _run(data):
    return recipes.register_sale(data, user=USER)


def test_redondea_cantidad_de_insumo(patched):
    dish_id = str(uuid.uuid4())
    ing_id = "ing-1"
    patched.seed("products", [
        {"id": dish_id, "name": "Sopa", "company_id": COMPANY},
        {"id": ing_id, "name": "Sal"},
    ])
    # 0.3 por platillo × 4 platillos = 1.2 -> round -> 1
    patched.seed("recipes", [
        {"dish_id": dish_id, "company_id": COMPANY, "ingredient_id": ing_id, "quantity": 0.3},
    ])
    patched.seed("product_warehouse_stock", [
        {"product_id": ing_id, "warehouse_id": "wh-1", "quantity": 100, "min_stock_alert": 5},
    ])

    out = _run(RegisterSale(items=[SaleItem(dish_id=dish_id, quantity=4)]))

    assert out["total_descontado"] == 1
    assert patched.db["product_warehouse_stock"][0]["quantity"] == 99


def test_no_descuenta_platillo_de_otra_empresa(patched):
    """Multi-tenancy: un dish de otra empresa se ignora, no se descuenta nada."""
    dish_otra_empresa = str(uuid.uuid4())
    ing_id = "ing-1"
    patched.seed("products", [
        {"id": dish_otra_empresa, "name": "Ajeno", "company_id": "OTRA-EMPRESA"},
        {"id": ing_id, "name": "Sal"},
    ])
    patched.seed("recipes", [
        {"dish_id": dish_otra_empresa, "company_id": "OTRA-EMPRESA", "ingredient_id": ing_id, "quantity": 5},
    ])
    patched.seed("product_warehouse_stock", [
        {"product_id": ing_id, "warehouse_id": "wh-1", "quantity": 100, "min_stock_alert": 5},
    ])

    out = _run(RegisterSale(items=[SaleItem(dish_id=dish_otra_empresa, quantity=10)]))

    assert out["total_descontado"] == 0
    # El stock NO se tocó
    assert patched.db["product_warehouse_stock"][0]["quantity"] == 100


def test_platillo_sin_receta_se_reporta(patched):
    dish_id = str(uuid.uuid4())
    patched.seed("products", [{"id": dish_id, "name": "Agua", "company_id": COMPANY}])

    out = _run(RegisterSale(items=[SaleItem(dish_id=dish_id, quantity=2)]))

    assert out["platillos_sin_receta"] == ["Agua"]
    assert out["total_descontado"] == 0
