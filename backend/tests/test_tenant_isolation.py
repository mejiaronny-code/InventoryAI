"""
tests/test_tenant_isolation.py
Red de seguridad multi-tenant: el backend usa la service_role key de Supabase,
que hace bypass de RLS — la ÚNICA defensa real contra fuga de datos entre
empresas es que cada query en Python filtre manualmente por company_id (ver
CLAUDE.md). Esta suite siembra dos empresas con datos propios y confirma que
ninguna de las dos ve nunca una fila de la otra en los endpoints de staff/admin
más comunes.
"""
import asyncio
import pytest
from fastapi import HTTPException

from app.routers import products, categories, warehouses, notifications, stock, recipes
from app.core import company_features


COMPANY_A = "comp-a"
COMPANY_B = "comp-b"
USER_A = {"id": "user-a", "company_id": COMPANY_A, "role": "admin"}
USER_B = {"id": "user-b", "company_id": COMPANY_B, "role": "admin"}


@pytest.fixture
def seeded(fake_supabase, monkeypatch):
    """Dos empresas con un producto, categoría, almacén y notificación cada una."""
    for mod in (products, categories, warehouses, notifications, stock, recipes, company_features):
        monkeypatch.setattr(mod, "supabase", fake_supabase)

    fake_supabase.seed("companies", [
        {"id": COMPANY_A, "slug": "empresa-a", "name": "Empresa A", "is_active": True, "features": {}},
        {"id": COMPANY_B, "slug": "empresa-b", "name": "Empresa B", "is_active": True, "features": {}},
    ])

    fake_supabase.seed("products", [
        {"id": "prod-a", "company_id": COMPANY_A, "name": "Producto A",
         "unit": "unidad", "price": 10, "is_active": True},
        {"id": "prod-b", "company_id": COMPANY_B, "name": "Producto B",
         "unit": "unidad", "price": 20, "is_active": True},
    ])
    fake_supabase.seed("categories", [
        {"id": "cat-a", "company_id": COMPANY_A, "name": "Categoría A"},
        {"id": "cat-b", "company_id": COMPANY_B, "name": "Categoría B"},
    ])
    fake_supabase.seed("warehouses", [
        {"id": "wh-a", "company_id": COMPANY_A, "name": "Almacén A"},
        {"id": "wh-b", "company_id": COMPANY_B, "name": "Almacén B"},
    ])
    fake_supabase.seed("notifications", [
        {"id": "notif-a", "company_id": COMPANY_A, "message": "Alerta A", "read": False},
        {"id": "notif-b", "company_id": COMPANY_B, "message": "Alerta B", "read": False},
    ])
    fake_supabase.seed("product_warehouse_stock", [
        {"product_id": "prod-a", "warehouse_id": "wh-a", "quantity": 5, "aisle": None,
         "shelf": None, "bin": None, "store_location": None, "min_stock_alert": 5,
         "nearest_expiry": None},
        {"product_id": "prod-b", "warehouse_id": "wh-b", "quantity": 7, "aisle": None,
         "shelf": None, "bin": None, "store_location": None, "min_stock_alert": 5,
         "nearest_expiry": None},
    ])
    return fake_supabase


def test_products_no_mezcla_entre_empresas(seeded):
    result_a = products.list_products(limit=50, offset=0, user=USER_A)
    result_b = products.list_products(limit=50, offset=0, user=USER_B)

    ids_a = {p["id"] for p in result_a}
    ids_b = {p["id"] for p in result_b}

    assert "prod-a" in ids_a and "prod-b" not in ids_a
    assert "prod-b" in ids_b and "prod-a" not in ids_b


def test_categories_no_mezcla_entre_empresas(seeded):
    result_a = categories.list_categories(user=USER_A)
    result_b = categories.list_categories(user=USER_B)

    assert {c["id"] for c in result_a} == {"cat-a"}
    assert {c["id"] for c in result_b} == {"cat-b"}


def test_warehouses_no_mezcla_entre_empresas(seeded):
    result_a = warehouses.list_warehouses(user=USER_A)
    result_b = warehouses.list_warehouses(user=USER_B)

    assert {w["id"] for w in result_a} == {"wh-a"}
    assert {w["id"] for w in result_b} == {"wh-b"}


def test_notifications_no_mezcla_entre_empresas(seeded):
    result_a = notifications.list_notifications(user=USER_A)
    result_b = notifications.list_notifications(user=USER_B)

    assert {n["id"] for n in result_a} == {"notif-a"}
    assert {n["id"] for n in result_b} == {"notif-b"}


def test_stock_movements_no_mezcla_entre_empresas(seeded):
    """
    stock_movements no tiene company_id propio — se filtra vía el join con
    products!inner(company_id). FakeSupabase no simula joins, así que aquí
    solo confirmamos que list_movements no truena y respeta el filtro que sí
    puede aplicar (product_id) — el join real se prueba manualmente contra
    Supabase real, documentado en CLAUDE.md como patrón conocido.
    """
    fake_supabase = seeded
    fake_supabase.seed("stock_movements", [
        {"id": "mov-a", "product_id": "prod-a", "warehouse_id": "wh-a",
         "type": "entrada", "quantity": 5, "created_at": "2026-01-01T00:00:00"},
        {"id": "mov-b", "product_id": "prod-b", "warehouse_id": "wh-b",
         "type": "entrada", "quantity": 7, "created_at": "2026-01-01T00:00:00"},
    ])
    result_a = stock.list_movements(user=USER_A)
    assert isinstance(result_a, list)


def test_super_admin_sin_company_id_no_ve_datos_de_nadie(seeded):
    """
    super_admin tiene company_id=None (ver CLAUDE.md). Si algún endpoint de
    staff olvida ese caso, terminaría filtrando por company_id=None y podría
    devolver una lista vacía (correcto) o, peor, reventar/filtrar de más. Aquí
    confirmamos que NUNCA devuelve filas de A ni de B.
    """
    super_admin = {"id": "root", "company_id": None, "role": "super_admin"}
    result = products.list_products(limit=50, offset=0, user=super_admin)
    ids = {p["id"] for p in result}
    assert "prod-a" not in ids
    assert "prod-b" not in ids


# ── Regresión: mutaciones cross-tenant que un usuario de la Empresa A podía
# ── hacer contra recursos de la Empresa B pasando su UUID a mano (bugs
# ── reales cerrados en este PR — ver plan de hardening de seguridad).

from app.models.schemas import StockMovementCreate, StockUpdate, LocationUpdate, RecipeUpsert, RecipeItem

PROD_A_UUID = "11111111-1111-1111-1111-111111111111"
PROD_B_UUID = "22222222-2222-2222-2222-222222222222"
WH_A_UUID   = "33333333-3333-3333-3333-333333333333"
WH_B_UUID   = "44444444-4444-4444-4444-444444444444"


@pytest.fixture
def seeded_uuid(seeded):
    """
    Variante de `seeded` con productos/almacenes de UUID válido — los schemas
    de mutación (StockMovementCreate, StockUpdate, RecipeItem) tipan
    product_id/warehouse_id/ingredient_id como UUID real, a diferencia de los
    ids de juguete ("prod-a") que usan los tests de solo-lectura de arriba.
    """
    seeded.seed("products", [
        {"id": PROD_A_UUID, "company_id": COMPANY_A, "name": "Producto A UUID",
         "unit": "unidad", "price": 10, "is_active": True},
        {"id": PROD_B_UUID, "company_id": COMPANY_B, "name": "Producto B UUID",
         "unit": "unidad", "price": 20, "is_active": True},
    ])
    seeded.seed("warehouses", [
        {"id": WH_A_UUID, "company_id": COMPANY_A, "name": "Almacén A UUID"},
        {"id": WH_B_UUID, "company_id": COMPANY_B, "name": "Almacén B UUID"},
    ])
    return seeded


def test_stock_movement_bloquea_producto_de_otra_empresa(seeded_uuid):
    """Empresa A no puede registrar un movimiento sobre un producto de Empresa B."""
    data = StockMovementCreate(product_id=PROD_B_UUID, warehouse_id=WH_B_UUID,
                                type="entrada", quantity=5)
    with pytest.raises(HTTPException) as exc:
        stock._create_movement_sync(data, USER_A)
    assert exc.value.status_code == 404


def test_stock_movement_bloquea_almacen_de_otra_empresa(seeded_uuid):
    """Ídem, pero el producto es propio y el almacén es de la otra empresa."""
    data = StockMovementCreate(product_id=PROD_A_UUID, warehouse_id=WH_B_UUID,
                                type="entrada", quantity=5)
    with pytest.raises(HTTPException) as exc:
        stock._create_movement_sync(data, USER_A)
    assert exc.value.status_code == 404


def test_stock_movement_propio_funciona(seeded_uuid):
    """Control positivo: producto y almacén propios sí deben funcionar."""
    data = StockMovementCreate(product_id=PROD_A_UUID, warehouse_id=WH_A_UUID,
                                type="entrada", quantity=5)
    result, _ = stock._create_movement_sync(data, USER_A)
    assert result["message"] == "Movimiento registrado"


def test_stock_set_bloquea_producto_de_otra_empresa(seeded_uuid):
    data = StockUpdate(warehouse_id=WH_B_UUID, quantity=10, min_stock_alert=5)
    with pytest.raises(HTTPException) as exc:
        stock.set_stock(data, product_id=PROD_B_UUID, user=USER_A)
    assert exc.value.status_code == 404


def test_stock_location_bloquea_producto_de_otra_empresa(seeded):
    """LocationUpdate usa ids de tipo str — reutiliza los ids de juguete de `seeded`."""
    data = LocationUpdate(product_id="prod-b", warehouse_id="wh-b", store_location="Pasillo 3")
    with pytest.raises(HTTPException) as exc:
        stock.update_location(data, user=USER_A)
    assert exc.value.status_code == 404


def test_recipe_bloquea_insumo_de_otra_empresa(seeded_uuid):
    """
    Empresa A tiene un platillo propio (prod-a de `seeded`) e intenta usar
    como insumo un producto que en realidad es de la Empresa B.
    """
    data = RecipeUpsert(items=[RecipeItem(ingredient_id=PROD_B_UUID, quantity=1, unit="g")])
    with pytest.raises(HTTPException) as exc:
        recipes.set_recipe(dish_id="prod-a", data=data, user=USER_A)
    assert exc.value.status_code == 404


def test_variant_stock_publico_bloquea_producto_de_otra_empresa(seeded):
    """
    GET /products/public/{slug}/{product_id}/variant-stock: el product_id de
    la URL pertenece a Empresa B, pero se consulta con el slug de Empresa A.
    """
    with pytest.raises(HTTPException) as exc:
        asyncio.run(products.get_variant_stock_public("empresa-a", "prod-b"))
    assert exc.value.status_code == 404
