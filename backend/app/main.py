"""
app/main.py
Punto de entrada principal de la API FastAPI.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from app.core.config import settings
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
    yield
    logger.info("🛑 API apagándose...")


app = FastAPI(
    title="InventoryAI API",
    version="1.0.0",
    description="SaaS de gestión de inventario con chat IA multi-tenant",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_url,
        "http://localhost:5173",
        "http://localhost:3000",
    ],
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
