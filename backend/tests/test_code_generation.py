"""
tests/test_code_generation.py
Códigos de reserva/booking (`_generate_code`): deben ser cortos, legibles,
en mayúsculas y suficientemente únicos para no colisionar.
"""
import string

from app.routers.reservations import _generate_code


def test_longitud_por_defecto():
    assert len(_generate_code()) == 8


def test_longitud_personalizada():
    assert len(_generate_code(12)) == 12


def test_solo_mayusculas_y_digitos():
    permitido = set(string.ascii_uppercase + string.digits)
    code = _generate_code()
    assert set(code) <= permitido


def test_practicamente_unicos():
    # 1000 códigos no deberían colisionar en la práctica
    codes = {_generate_code() for _ in range(1000)}
    assert len(codes) == 1000
