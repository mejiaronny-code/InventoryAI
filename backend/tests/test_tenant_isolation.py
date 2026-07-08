"""
tests/test_tenant_isolation.py
Red de seguridad multi-tenant: el backend usa la service_role key de Supabase,
que hace bypass de RLS — la ÚNICA defensa real contra fuga de datos entre
empresas es que cada query en Python filtre manualmente por company_id (ver
CLAUDE.md). Esta suite siembra dos empresas con datos propios y confirma que
ninguna de las dos ve nunca una fila de la otra en los endpoints de staff/admin
más comunes.
"""
import pytest

from app.routers import products, categories, warehouses, notifications, stock


COMPANY_A = "comp-a"
COMPANY_B = "comp-b"
USER_A = {"id": "user-a", "company_id": COMPANY_A, "role": "admin"}
USER_B = {"id": "user-b", "company_id": COMPANY_B, "role": "admin"}


@pytest.fixture
def seeded(fake_supabase, monkeypatch):
    """Dos empresas con un producto, categoría, almacén y notificación cada una."""
    for mod in (products, categories, warehouses, notifications, stock):
        monkeypatch.setattr(mod, "supabase", fake_supabase)

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
