"""Reservas: disponibilidad real, transición válida e idempotencia."""
import asyncio
import uuid

import pytest
from fastapi import HTTPException

from app.models.schemas import ReservationCreate, ReservationUpdate
from app.routers import reservations


COMPANY_ID = "company-a"
PRODUCT_ID = "11111111-1111-1111-1111-111111111111"
WAREHOUSE_ID = "22222222-2222-2222-2222-222222222222"
RESERVATION_ID = "33333333-3333-3333-3333-333333333333"
USER = {"id": "user-a", "company_id": COMPANY_ID, "role": "admin"}


class _Request:
    headers = {}

    class Client:
        host = "127.0.0.1"

    client = Client()


@pytest.fixture
def seeded(fake_supabase, monkeypatch):
    monkeypatch.setattr(reservations, "supabase", fake_supabase)

    async def get_company(*_args, **_kwargs):
        return {
            "id": COMPANY_ID,
            "slug": "empresa-a",
            "name": "Empresa A",
            "features": {"public_catalog": True},
        }

    async def noop_email(**_kwargs):
        return None

    monkeypatch.setattr(reservations, "get_active_company", get_company)
    monkeypatch.setattr(reservations, "require_public_catalog", lambda _company: None)
    monkeypatch.setattr(reservations, "send_reservation_email", noop_email)
    reservations._ip_reservations.clear()

    fake_supabase.seed("products", [{
        "id": PRODUCT_ID,
        "company_id": COMPANY_ID,
        "name": "Producto",
        "is_active": True,
        "reservation_time_hours": 24,
        "categories": None,
    }])
    fake_supabase.seed("warehouses", [{
        "id": WAREHOUSE_ID,
        "company_id": COMPANY_ID,
        "name": "Almacén",
        "is_active": True,
    }])
    fake_supabase.seed("product_warehouse_stock", [{
        "id": "stock-a",
        "product_id": PRODUCT_ID,
        "warehouse_id": WAREHOUSE_ID,
        "quantity": 5,
        "min_stock_alert": 1,
    }])
    return fake_supabase


def _create(quantity):
    data = ReservationCreate(
        product_id=PRODUCT_ID,
        warehouse_id=WAREHOUSE_ID,
        quantity=quantity,
        client_name="Cliente",
        client_email="cliente@example.com",
    )
    return asyncio.run(
        reservations.create_public_reservation("empresa-a", data, _Request())
    )


def test_reservas_activas_reducen_disponibilidad(seeded):
    _create(3)
    with pytest.raises(HTTPException) as exc:
        _create(3)
    assert exc.value.status_code == 400
    assert "Disponible: 2" in exc.value.detail
    assert len(seeded.db["reservations"]) == 1


def test_completar_es_idempotente_y_auditado(seeded):
    seeded.seed("reservations", [{
        "id": RESERVATION_ID,
        "company_id": COMPANY_ID,
        "product_id": PRODUCT_ID,
        "warehouse_id": WAREHOUSE_ID,
        "quantity": 2,
        "status": "confirmed",
        "notes": None,
    }])
    update = ReservationUpdate(status="completed")

    asyncio.run(reservations.update_reservation(RESERVATION_ID, update, USER))
    asyncio.run(reservations.update_reservation(RESERVATION_ID, update, USER))

    assert seeded.db["product_warehouse_stock"][0]["quantity"] == 3
    assert len(seeded.db["stock_movements"]) == 1


def test_estado_terminal_no_puede_regresar(seeded):
    seeded.seed("reservations", [{
        "id": RESERVATION_ID,
        "company_id": COMPANY_ID,
        "product_id": PRODUCT_ID,
        "warehouse_id": WAREHOUSE_ID,
        "quantity": 1,
        "status": "completed",
        "notes": None,
    }])

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            reservations.update_reservation(
                RESERVATION_ID,
                ReservationUpdate(status="confirmed"),
                USER,
            )
        )
    assert exc.value.status_code == 409
    assert seeded.db["reservations"][0]["status"] == "completed"


def test_stock_insuficiente_no_completa_reserva(seeded):
    seeded.db["product_warehouse_stock"][0]["quantity"] = 1
    seeded.seed("reservations", [{
        "id": RESERVATION_ID,
        "company_id": COMPANY_ID,
        "product_id": PRODUCT_ID,
        "warehouse_id": WAREHOUSE_ID,
        "quantity": 2,
        "status": "confirmed",
        "notes": None,
    }])

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            reservations.update_reservation(
                RESERVATION_ID,
                ReservationUpdate(status="completed"),
                USER,
            )
        )
    assert exc.value.status_code == 409
    assert seeded.db["reservations"][0]["status"] == "confirmed"
    assert seeded.db["product_warehouse_stock"][0]["quantity"] == 1
