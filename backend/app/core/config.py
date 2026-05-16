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
    groq_api_key: str
    openai_api_key: str
    deepinfra_api_key: str = ""

    # LangSmith
    langchain_tracing_v2: bool = True
    langchain_api_key: str = ""
    langchain_project: str = "inventoryai-prod"

    # App
    app_secret_key: str = "dev-secret-key"
    frontend_url: str = "http://localhost:5173"
    environment: str = "development"

    # Email (opcional — Resend)
    resend_api_key: str = ""
    notification_from_email: str = "noreply@inventoryai.app"
    support_email: str = ""  # Email del equipo de soporte (para solicitudes de eliminación)

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
