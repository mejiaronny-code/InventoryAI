"""
app/main.py
Punto de entrada principal de la API FastAPI.
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from contextlib import asynccontextmanager
import asyncio
import logging

from app.core.config import settings
from app.embeddings.embedding_service import start_warmup_loop
from app.routers import (
    auth,
    products,
    categories,
    warehouses,
    stock,
    batches,
    serials,
    reservations,
    picking,
    putaway,
    reorder,
    reports,
    chat,
    notifications,
    companies,
    dashboard,
    knowledge,
    integrations,
    recipes,
    tables,
    bookings,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 InventoryAI API iniciando...")
    logger.info(f"   Entorno: {settings.environment}")
    logger.info(f"   LangSmith: {'✅' if settings.langchain_tracing_v2 else '❌'}")
    # Warm-up del modelo de embeddings cada 10 minutos para evitar cold starts
    warmup_task = asyncio.create_task(start_warmup_loop(interval_seconds=600))
    logger.info("   Embedding warm-up: ✅ (cada 10 min)")
    yield
    warmup_task.cancel()
    logger.info("🛑 API apagándose...")


app = FastAPI(
    title="InventoryAI API",
    version="1.0.0",
    description="SaaS de gestión de inventario con chat IA multi-tenant",
    lifespan=lifespan,
)

# ── SECURITY HEADERS ─────────────────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# ── CORS ─────────────────────────────────────────────────────────────
_cors_origins = [
    settings.frontend_url,
    "http://localhost:5173",
    "http://localhost:3000",
]
if settings.extra_cors_origins:
    _cors_origins += [o.strip() for o in settings.extra_cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── ROUTERS ──────────────────────────────────────────────────────────
API_PREFIX = "/api/v1"

app.include_router(auth.router,          prefix=API_PREFIX)
app.include_router(companies.router,     prefix=API_PREFIX)
app.include_router(categories.router,    prefix=API_PREFIX)
app.include_router(warehouses.router,    prefix=API_PREFIX)
app.include_router(products.router,      prefix=API_PREFIX)
app.include_router(stock.router,         prefix=API_PREFIX)
app.include_router(batches.router,       prefix=API_PREFIX)
app.include_router(serials.router,       prefix=API_PREFIX)
app.include_router(reservations.router,  prefix=API_PREFIX)
app.include_router(picking.router,       prefix=API_PREFIX)
app.include_router(putaway.router,       prefix=API_PREFIX)
app.include_router(reorder.router,       prefix=API_PREFIX)
app.include_router(reports.router,       prefix=API_PREFIX)
app.include_router(chat.router,          prefix=API_PREFIX)
app.include_router(notifications.router, prefix=API_PREFIX)
app.include_router(dashboard.router,     prefix=API_PREFIX)
app.include_router(knowledge.router,     prefix=API_PREFIX)
app.include_router(integrations.router,  prefix=API_PREFIX)
app.include_router(recipes.router,       prefix=API_PREFIX)
app.include_router(tables.router,        prefix=API_PREFIX)
app.include_router(bookings.router,      prefix=API_PREFIX)


# ── HEALTH CHECK ─────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "1.0.0",
        "environment": settings.environment,
    }


@app.get("/")
async def root():
    return {"message": "InventoryAI API — visita /docs para la documentación"}
