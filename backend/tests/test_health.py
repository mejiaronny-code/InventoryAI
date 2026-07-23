"""El healthcheck debe controlar el reemplazo de una instancia enferma."""
import json

from app import main


class _HealthySupabase:
    def table(self, _name):
        return self

    def select(self, _columns):
        return self

    def limit(self, _limit):
        return self

    def execute(self):
        return object()


class _DownSupabase(_HealthySupabase):
    def execute(self):
        raise ConnectionError("database unavailable")


def test_health_retorna_200_con_base_disponible(monkeypatch):
    monkeypatch.setattr(main, "supabase", _HealthySupabase())
    response = main.health()
    assert response.status_code == 200
    assert json.loads(response.body)["db"] == "ok"


def test_health_retorna_503_si_base_no_responde(monkeypatch):
    monkeypatch.setattr(main, "supabase", _DownSupabase())
    response = main.health()
    assert response.status_code == 503
    assert json.loads(response.body)["status"] == "degraded"
