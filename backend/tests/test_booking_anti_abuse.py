"""
tests/test_booking_anti_abuse.py
Defensas anti-abuso de las reservas públicas (sector restaurantes).
Estas pruebas son de SEGURIDAD: cubren rate-limit, honeypot, validación de
fecha, requisito de contacto, feature gating y topes de pre-orden.
"""
import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.routers import bookings
from app.models.schemas import BookingCreate, BookingItemCreate


SLUG = "mi-restaurante"
COMPANY = {"id": "comp-1", "name": "Mi Restaurante",
           "features": {"table_reservations": True, "pickup_orders": True, "public_catalog": True}}


class _FakeRequest:
    """Request mínimo: solo lo que usa `_client_ip`."""
    def __init__(self, ip="1.2.3.4"):
        self.headers = {}
        self.client = type("C", (), {"host": ip})()


@pytest.fixture(autouse=True)
def reset_rate_limit():
    """Limpia el contador en memoria entre tests."""
    bookings._ip_bookings.clear()
    yield
    bookings._ip_bookings.clear()


@pytest.fixture
def patched(monkeypatch, fake_supabase):
    """Inyecta supabase falso y neutraliza dependencias externas."""
    monkeypatch.setattr(bookings, "supabase", fake_supabase)
    monkeypatch.setattr(bookings, "get_active_company", lambda slug, cols=None: dict(COMPANY))
    monkeypatch.setattr(bookings, "require_public_catalog", lambda company: None)

    async def _noop_email(*a, **k):
        return None
    monkeypatch.setattr(bookings, "send_reservation_email", _noop_email)
    return fake_supabase


def _future(hours=24):
    return datetime.now(timezone.utc) + timedelta(hours=hours)


def _valid_booking(**overrides):
    base = dict(
        service_type="dine_in",
        party_size=4,
        reserved_at=_future(),
        client_name="Ana López",
        client_phone="55512345",
    )
    base.update(overrides)
    return BookingCreate(**base)


def _create(data, ip="1.2.3.4"):
    return asyncio.run(bookings.create_public_booking(SLUG, data, _FakeRequest(ip)))


# ── Rate limit ────────────────────────────────────────────────────────────
def test_rate_limit_bloquea_a_la_sexta(patched):
    for _ in range(bookings._MAX_BOOKINGS_PER_IP_HOUR):
        _create(_valid_booking())
    with pytest.raises(HTTPException) as exc:
        _create(_valid_booking())
    assert exc.value.status_code == 429


def test_rate_limit_es_por_ip(patched):
    for _ in range(bookings._MAX_BOOKINGS_PER_IP_HOUR):
        _create(_valid_booking(), ip="1.1.1.1")
    # Otra IP no está limitada
    res = _create(_valid_booking(), ip="2.2.2.2")
    assert "code" in res


# ── Honeypot ──────────────────────────────────────────────────────────────
def test_honeypot_descarta_silenciosamente(patched):
    res = _create(_valid_booking(website="http://spam.com"))
    assert res["code"] == "OK"             # respuesta falsa
    assert patched.db.get("bookings", []) == []   # NO se creó nada


# ── Validación de fecha ───────────────────────────────────────────────────
def test_rechaza_fecha_en_pasado(patched):
    with pytest.raises(HTTPException) as exc:
        _create(_valid_booking(reserved_at=datetime.now(timezone.utc) - timedelta(hours=2)))
    assert exc.value.status_code == 400


def test_rechaza_fecha_demasiado_a_futuro(patched):
    lejos = datetime.now(timezone.utc) + timedelta(days=bookings._MAX_DAYS_AHEAD + 5)
    with pytest.raises(HTTPException) as exc:
        _create(_valid_booking(reserved_at=lejos))
    assert exc.value.status_code == 400


# ── Contacto requerido ────────────────────────────────────────────────────
def test_requiere_telefono_o_email(patched):
    with pytest.raises(HTTPException) as exc:
        _create(_valid_booking(client_phone=None, client_email=None))
    assert exc.value.status_code == 400


# ── Feature gating ────────────────────────────────────────────────────────
def test_rechaza_dine_in_si_no_acepta_mesas(patched, monkeypatch):
    sin_mesas = dict(COMPANY)
    sin_mesas["features"] = {"table_reservations": False, "pickup_orders": True, "public_catalog": True}
    monkeypatch.setattr(bookings, "get_active_company", lambda slug, cols=None: sin_mesas)
    with pytest.raises(HTTPException) as exc:
        _create(_valid_booking(service_type="dine_in"))
    assert exc.value.status_code == 400


# ── Topes de pre-orden ────────────────────────────────────────────────────
def test_rechaza_demasiadas_lineas_de_preorden(patched):
    items = [BookingItemCreate(dish_id=uuid.uuid4(), quantity=1)
             for _ in range(bookings._MAX_PREORDER_LINES + 1)]
    with pytest.raises(HTTPException) as exc:
        _create(_valid_booking(items=items))
    assert exc.value.status_code == 400


def test_rechaza_cantidad_excesiva_por_platillo(patched):
    item = BookingItemCreate(dish_id=uuid.uuid4(), quantity=bookings._MAX_PREORDER_QTY + 1)
    with pytest.raises(HTTPException) as exc:
        _create(_valid_booking(items=[item]))
    assert exc.value.status_code == 400


# ── Camino feliz ──────────────────────────────────────────────────────────
def test_reserva_valida_se_crea_con_codigo(patched):
    res = _create(_valid_booking())
    assert "code" in res and len(res["code"]) == 8
    assert len(patched.db["bookings"]) == 1
    assert patched.db["bookings"][0]["status"] == "pending"
    # Genera notificación al staff
    assert len(patched.db.get("notifications", [])) == 1
