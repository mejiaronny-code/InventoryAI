"""Regresiones de validación y auditoría del inventario."""
import pytest
from pydantic import ValidationError

from app.models.schemas import StockMovementCreate, StockUpdate
from app.routers import stock


COMPANY_ID = "company-a"
USER = {"id": "user-a", "company_id": COMPANY_ID, "role": "admin"}
PRODUCT_ID = "11111111-1111-1111-1111-111111111111"
WAREHOUSE_ID = "22222222-2222-2222-2222-222222222222"
DESTINATION_ID = "33333333-3333-3333-3333-333333333333"


@pytest.fixture
def seeded(fake_supabase, monkeypatch):
    monkeypatch.setattr(stock, "supabase", fake_supabase)
    fake_supabase.seed("companies", [{
        "id": COMPANY_ID,
        "features": {"batch_tracking": False},
    }])
    fake_supabase.seed("products", [{
        "id": PRODUCT_ID,
        "company_id": COMPANY_ID,
        "name": "Producto",
    }])
    fake_supabase.seed("warehouses", [
        {"id": WAREHOUSE_ID, "company_id": COMPANY_ID, "name": "Origen"},
        {"id": DESTINATION_ID, "company_id": COMPANY_ID, "name": "Destino"},
    ])
    fake_supabase.seed("product_warehouse_stock", [{
        "id": "stock-a",
        "product_id": PRODUCT_ID,
        "warehouse_id": WAREHOUSE_ID,
        "quantity": 10,
        "min_stock_alert": 2,
    }])
    return fake_supabase


@pytest.mark.parametrize("quantity", [-1, -50])
def test_stock_update_rechaza_cantidades_negativas(quantity):
    with pytest.raises(ValidationError):
        StockUpdate(warehouse_id=WAREHOUSE_ID, quantity=quantity)


@pytest.mark.parametrize("movement_type", ["entrada", "salida", "transferencia"])
def test_movimientos_no_ajuste_rechazan_cero(movement_type):
    kwargs = {
        "product_id": PRODUCT_ID,
        "warehouse_id": WAREHOUSE_ID,
        "type": movement_type,
        "quantity": 0,
        "notes": "Prueba",
    }
    if movement_type == "transferencia":
        kwargs["to_warehouse_id"] = DESTINATION_ID
    with pytest.raises(ValidationError):
        StockMovementCreate(**kwargs)


def test_ajuste_permite_cero():
    data = StockMovementCreate(
        product_id=PRODUCT_ID,
        warehouse_id=WAREHOUSE_ID,
        type="ajuste",
        quantity=0,
    )
    assert data.quantity == 0


def test_movimiento_actualiza_stock_y_auditoria_juntos(seeded):
    data = StockMovementCreate(
        product_id=PRODUCT_ID,
        warehouse_id=WAREHOUSE_ID,
        type="salida",
        quantity=3,
        notes="Venta mostrador",
    )

    result, _ = stock._create_movement_sync(data, USER)

    assert result["new_quantity"] == 7
    assert seeded.db["product_warehouse_stock"][0]["quantity"] == 7
    assert seeded.db["stock_movements"][0]["quantity"] == 3
    assert seeded.db["stock_movements"][0]["notes"] == "Venta mostrador"


def test_transferencia_mueve_origen_y_destino_y_audita(seeded):
    data = StockMovementCreate(
        product_id=PRODUCT_ID,
        warehouse_id=WAREHOUSE_ID,
        to_warehouse_id=DESTINATION_ID,
        type="transferencia",
        quantity=4,
    )

    stock._create_movement_sync(data, USER)

    rows = seeded.db["product_warehouse_stock"]
    origin = next(r for r in rows if r["warehouse_id"] == WAREHOUSE_ID)
    destination = next(r for r in rows if r["warehouse_id"] == DESTINATION_ID)
    assert origin["quantity"] == 6
    assert destination["quantity"] == 4
    assert seeded.db["stock_movements"][0]["to_warehouse_id"] == DESTINATION_ID


def test_set_stock_deja_movimiento_de_ajuste(seeded):
    data = StockUpdate(
        warehouse_id=WAREHOUSE_ID,
        quantity=6,
        min_stock_alert=2,
        notes="Conteo físico",
    )

    stock.set_stock(data, product_id=PRODUCT_ID, user=USER)

    assert seeded.db["product_warehouse_stock"][0]["quantity"] == 6
    movement = seeded.db["stock_movements"][0]
    assert movement["type"] == "ajuste"
    assert movement["notes"] == "Conteo físico"
