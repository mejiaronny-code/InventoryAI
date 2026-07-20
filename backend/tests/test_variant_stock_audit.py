"""
tests/test_variant_stock_audit.py
Regresión: el endpoint de stock por variante (PUT /products/{id}/variant-stock)
era el único camino para BAJAR stock que no pedía motivo ni quedaba registrado
en stock_movements — invisible en el historial (riesgo real de robo/faltante
sin rastro, reportado por un usuario viendo el modal "Stock por variante").
Ahora debe comportarse igual que un ajuste manual de stock general: exige
motivo en toda baja y registra el movimiento.
"""
import pytest
from fastapi import HTTPException

from app.routers import products
from app.models.schemas import VariantStockUpsertRequest, VariantStockUpsert


COMPANY_ID = "comp-x"
USER = {"id": "user-x", "company_id": COMPANY_ID, "role": "admin"}
PRODUCT_ID = "prod-jansport"
WAREHOUSE_ID = "33333333-3333-3333-3333-333333333333"


@pytest.fixture
def seeded(fake_supabase, monkeypatch):
    monkeypatch.setattr(products, "supabase", fake_supabase)
    fake_supabase.seed("products", [
        {"id": PRODUCT_ID, "company_id": COMPANY_ID, "name": "Mochila JanSport"},
    ])
    fake_supabase.seed("product_variants_stock", [
        {"id": "vs-morado", "product_id": PRODUCT_ID, "warehouse_id": WAREHOUSE_ID,
         "combination": {"Color": "Morado"}, "quantity": 3},
        {"id": "vs-azul", "product_id": PRODUCT_ID, "warehouse_id": WAREHOUSE_ID,
         "combination": {"Color": "Azul"}, "quantity": 3},
    ])
    return fake_supabase


def test_baja_sin_motivo_se_rechaza(seeded):
    body = VariantStockUpsertRequest(items=[
        VariantStockUpsert(warehouse_id=WAREHOUSE_ID, combination={"Color": "Morado"}, quantity=1),
    ])
    with pytest.raises(HTTPException) as exc:
        products.upsert_variant_stock(PRODUCT_ID, body, USER)
    assert exc.value.status_code == 400

    # La cantidad NO debió cambiar en la BD — el rechazo debe ser antes de escribir.
    row = next(r for r in seeded.db["product_variants_stock"] if r["combination"] == {"Color": "Morado"})
    assert row["quantity"] == 3


def test_baja_con_motivo_se_registra_en_historial(seeded):
    body = VariantStockUpsertRequest(items=[
        VariantStockUpsert(warehouse_id=WAREHOUSE_ID, combination={"Color": "Morado"}, quantity=1),
        VariantStockUpsert(warehouse_id=WAREHOUSE_ID, combination={"Color": "Azul"}, quantity=3),
    ], notes="Venta en mostrador")

    products.upsert_variant_stock(PRODUCT_ID, body, USER)

    movements = seeded.db.get("stock_movements", [])
    assert len(movements) == 1  # solo cambió "Morado" (3->1); "Azul" quedó igual, sin movimiento
    mv = movements[0]
    assert mv["type"] == "salida"
    assert mv["quantity"] == 2
    assert mv["product_id"] == PRODUCT_ID
    assert mv["created_by"] == USER["id"]
    assert "Venta en mostrador" in mv["notes"]
    assert "Morado" in mv["notes"]


def test_alza_no_exige_motivo_pero_igual_se_registra(seeded):
    body = VariantStockUpsertRequest(items=[
        VariantStockUpsert(warehouse_id=WAREHOUSE_ID, combination={"Color": "Morado"}, quantity=10),
    ])

    products.upsert_variant_stock(PRODUCT_ID, body, USER)  # no debe lanzar pese a no traer notes

    movements = seeded.db.get("stock_movements", [])
    assert len(movements) == 1
    assert movements[0]["type"] == "entrada"
    assert movements[0]["quantity"] == 7
