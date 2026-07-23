"""Integridad multi-tenant y transiciones de reservas de restaurante."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.models.schemas import BookingCreate, BookingItemCreate, BookingUpdate
from app.routers import bookings


COMPANY_ID = "company-a"
OTHER_COMPANY_ID = "company-b"
DISH_ID = "11111111-1111-1111-1111-111111111111"
OTHER_DISH_ID = "22222222-2222-2222-2222-222222222222"
TABLE_ID = "33333333-3333-3333-3333-333333333333"
INGREDIENT_ID = "44444444-4444-4444-4444-444444444444"
WAREHOUSE_ID = "55555555-5555-5555-5555-555555555555"
USER = {"id": "user-a", "company_id": COMPANY_ID, "role": "admin"}


@pytest.fixture
def seeded(fake_supabase, monkeypatch):
    monkeypatch.setattr(bookings, "supabase", fake_supabase)
    fake_supabase.seed("products", [
        {
            "id": DISH_ID, "company_id": COMPANY_ID, "name": "Platillo",
            "price": 10, "product_type": "dish", "is_active": True,
            "is_available": True,
        },
        {
            "id": OTHER_DISH_ID, "company_id": OTHER_COMPANY_ID,
            "name": "Platillo ajeno", "price": 15, "product_type": "dish",
            "is_active": True, "is_available": True,
        },
        {
            "id": INGREDIENT_ID, "company_id": COMPANY_ID,
            "name": "Ingrediente", "product_type": "ingredient",
            "is_active": True, "is_available": True,
        },
    ])
    fake_supabase.seed("restaurant_tables", [{
        "id": TABLE_ID,
        "company_id": COMPANY_ID,
        "name": "Mesa 1",
        "capacity": 4,
        "is_active": True,
    }])
    fake_supabase.seed("product_warehouse_stock", [{
        "id": "stock-a",
        "product_id": INGREDIENT_ID,
        "warehouse_id": WAREHOUSE_ID,
        "quantity": 10,
        "min_stock_alert": 2,
    }])
    return fake_supabase


def _booking(**overrides):
    data = {
        "service_type": "dine_in",
        "party_size": 2,
        "reserved_at": datetime.now(timezone.utc) + timedelta(days=1),
        "table_id": TABLE_ID,
        "client_name": "Cliente",
        "client_phone": "55512345",
        "items": [BookingItemCreate(dish_id=DISH_ID, quantity=2)],
    }
    data.update(overrides)
    return BookingCreate(**data)


def test_preorden_rechaza_platillo_de_otro_tenant_antes_de_insertar(seeded):
    data = _booking(items=[BookingItemCreate(dish_id=OTHER_DISH_ID, quantity=1)])
    with pytest.raises(HTTPException) as exc:
        bookings._write_booking_sync(data, COMPANY_ID)
    assert exc.value.status_code == 400
    assert seeded.db.get("bookings", []) == []


def test_mesa_rechaza_grupo_mayor_a_capacidad(seeded):
    with pytest.raises(HTTPException) as exc:
        bookings._write_booking_sync(_booking(party_size=6), COMPANY_ID)
    assert exc.value.status_code == 409
    assert seeded.db.get("bookings", []) == []


def test_booking_y_items_se_crean_juntos(seeded):
    code = bookings._write_booking_sync(_booking(), COMPANY_ID)
    assert len(code) == 8
    assert len(seeded.db["bookings"]) == 1
    assert len(seeded.db["booking_items"]) == 1


def test_transicion_invalida_no_modifica_booking(seeded):
    booking_id = str(uuid.uuid4())
    seeded.seed("bookings", [{
        "id": booking_id,
        "company_id": COMPANY_ID,
        "status": "pending",
    }])

    with pytest.raises(HTTPException) as exc:
        bookings.update_booking(
            booking_id,
            BookingUpdate(status="completed"),
            USER,
        )
    assert exc.value.status_code == 409
    assert seeded.db["bookings"][0]["status"] == "pending"


def test_completar_descuenta_receta_una_sola_vez(seeded):
    booking_id = str(uuid.uuid4())
    seeded.seed("bookings", [{
        "id": booking_id,
        "company_id": COMPANY_ID,
        "status": "ready",
    }])
    seeded.seed("booking_items", [{
        "id": str(uuid.uuid4()),
        "booking_id": booking_id,
        "dish_id": DISH_ID,
        "quantity": 2,
    }])
    seeded.seed("recipes", [{
        "id": str(uuid.uuid4()),
        "company_id": COMPANY_ID,
        "dish_id": DISH_ID,
        "ingredient_id": INGREDIENT_ID,
        "quantity": 3,
    }])

    update = BookingUpdate(status="completed")
    bookings.update_booking(booking_id, update, USER)
    bookings.update_booking(booking_id, update, USER)

    assert seeded.db["product_warehouse_stock"][0]["quantity"] == 4
    assert len(seeded.db["stock_movements"]) == 1
