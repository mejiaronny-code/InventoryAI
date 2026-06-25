"""
app/core/config.py
Configuración central de la aplicación usando pydantic-settings
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Supabase
    supabase_url: str
    supabase_service_role_key: str

    # AI APIs
    groq_api_key: str = ""          # Legacy — ya no se usa
    openai_api_key: str = ""        # Legacy — embeddings migrados a DeepInfra
    deepinfra_api_key: str = ""     # Chat + visión + embeddings (Qwen3)

    # LangSmith
    langchain_tracing_v2: bool = True
    langchain_api_key: str = ""
    langchain_project: str = "inventoryai-prod"

    # App
    app_secret_key: str = "dev-secret-key"
    frontend_url: str = "http://localhost:5173"
    # Orígenes adicionales separados por coma (para Vercel previews, dominio custom, etc.)
    extra_cors_origins: str = ""
    environment: str = "development"

    # Email (opcional — Resend)
    resend_api_key: str = ""
    notification_from_email: str = "noreply@inventoryai.app"
    support_email: str = ""  # Email del equipo de soporte (para solicitudes de eliminación)

    # Integración con Papyrus (RAG) — endpoints de solo lectura protegidos
    # por este header compartido. Vacío = endpoints de integración deshabilitados.
    integration_service_key: str = ""

    # Margen sobre el costo real de IA que se le muestra a la empresa.
    # `ai_usage_log.cost_usd` siempre guarda el costo REAL de DeepInfra (para
    # las métricas internas del super admin); este multiplicador solo se aplica
    # al número que ve la empresa en su propio dashboard. Configurable por si
    # se ajusta el margen por plan.
    ai_cost_multiplier: float = 20.0

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
