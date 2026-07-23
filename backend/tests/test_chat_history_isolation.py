"""El historial del chat se aísla por tenant y tiene un límite duro."""
from app.agents import chat_agent


def setup_function():
    chat_agent._history_store.clear()
    chat_agent._history_last_seen.clear()


def test_mismo_session_id_no_colisiona_entre_empresas():
    key_a = chat_agent._history_key("company-a", "browser-session")
    key_b = chat_agent._history_key("company-b", "browser-session")
    assert key_a != key_b


def test_poda_expulsa_sesiones_recientes_si_supera_limite(monkeypatch):
    monkeypatch.setattr(chat_agent, "_HISTORY_MAX_SESSIONS", 3)
    for index in range(5):
        key = chat_agent._history_key("company-a", f"session-{index}")
        chat_agent._history_store[key] = []
        chat_agent._touch_history(key)

    assert len(chat_agent._history_store) <= 3
    assert "company-a:session-4" in chat_agent._history_store


def test_clear_session_limpia_todos_los_tenants_si_no_se_especifica_empresa():
    for company in ("company-a", "company-b"):
        key = chat_agent._history_key(company, "same-session")
        chat_agent._history_store[key] = []
        chat_agent._touch_history(key)

    chat_agent.clear_session("same-session")

    assert chat_agent._history_store == {}
    assert chat_agent._history_last_seen == {}
