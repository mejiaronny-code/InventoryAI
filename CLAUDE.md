# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InventoryAI is a multi-tenant SaaS for inventory management with an AI chat assistant. Each company gets isolated data, a public product catalog, and a configurable feature set.

Stack: **FastAPI + Supabase** (backend) · **React + Vite + DaisyUI/Tailwind** (frontend) · **DeepInfra Qwen3** (chat + vision) · **DeepInfra Qwen3-Embedding-8B** (semantic search, 1536d MRL) · LangSmith tracing.

Deployment target: **Railway** (backend, Dockerfile-based) + **Vercel** (frontend).
- Backend live at `https://inventoryai-production.up.railway.app` (Root Directory = `backend`, builder = Dockerfile)
- Frontend live at `https://inventory-ai-ruddy.vercel.app` (Root Directory = `frontend`, framework = Vite)
- `backend/railway.json` — `startCommand` must use `sh -c "... --port ${PORT:-8000}"` (shell form, so `$PORT` expands)
- `backend/Dockerfile` `CMD` also uses shell form for the same reason
- `backend/.dockerignore` excludes `venv/`, `__pycache__/`, `.git/` etc. from the Docker build context
- Required env vars in Railway: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (must be `service_role`, not `anon`), `DEEPINFRA_API_KEY`, `APP_SECRET_KEY`, `ENVIRONMENT=production`, `FRONTEND_URL` (must match the Vercel URL exactly for CORS), `LANGCHAIN_TRACING_V2`, `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, `SUPPORT_EMAIL`
- `email-validator` is required in `requirements.txt` for Pydantic `EmailStr` fields (`auth.LoginRequest`, `ReservationCreate.client_email`, `UserProfileCreate.email`) — easy to miss since it's a transitive dep locally but not in a clean container
- See `SECURITY_ROADMAP.md` for pending hardening (rate limiting by IP, message length caps, Cloudflare, Redis, billing alerts)

---

## Dev Commands

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload          # http://localhost:8000
# Swagger UI: http://localhost:8000/docs

# Frontend
cd frontend
npm install
npm run dev                            # http://localhost:5173
npm run build
```

Copy `backend/.env.example` → `backend/.env` and fill required vars before running.

---

## Architecture

### Backend (`backend/app/`)

| Path | Purpose |
|------|---------|
| `main.py` | FastAPI app, CORS, router registration, `/health` |
| `core/config.py` | Pydantic-settings (`Settings`), loaded via `get_settings()` |
| `core/auth.py` | JWT verification + in-memory cache (5 min TTL) |
| `core/supabase_client.py` | Service-role Supabase client (singleton) |
| `models/schemas.py` | All Pydantic schemas (input/output) |
| `routers/` | One file per domain (see below) |
| `agents/chat_agent.py` | LangChain agent with tools, Qwen3 via DeepInfra |
| `agents/tools.py` | AI tools: product search, stock lookup, catalog, etc. |
| `embeddings/embedding_service.py` | DeepInfra Qwen3-Embedding-8B (4096d), instruction-aware |
| `services/notifications.py` | Email via Resend |

All routes use prefix `/api/v1`. Multi-tenancy is enforced **manually** in Python — Supabase RLS is NOT active; every query filters by `company_id`.

**Auth guards** (import from `app.core.auth`):
- `require_super_admin` — platform owner only, `company_id = None`
- `require_admin` — admin + super_admin
- `require_staff` — admin + employee + super_admin

⚠️ **Critical:** `super_admin` has `company_id = None`. Any endpoint using `require_staff` that queries by company_id must guard:
```python
company_id = user.get("company_id")
if not company_id:
    raise HTTPException(status_code=401, detail="No se encontró la empresa asociada")
```

**Supabase query patterns:**
- Use `.maybe_single()` (not `.single()`) when a row may not exist — avoids `PGRST116` errors.
- HTTP/2 connection drops from Supabase: use `_run_with_retry()` pattern (see `routers/reorder.py`) catching `httpx.RemoteProtocolError`.

### Frontend (`frontend/src/`)

| Path | Purpose |
|------|---------|
| `pages/public/` | Catalog, reservation status, auth pages — no login required |
| `pages/admin/` | Full admin UI (products, stock, picking, reports, etc.) |
| `pages/superadmin/` | CompaniesPage, MetricsPage — super_admin only |
| `context/CompanyFeaturesContext.jsx` | Feature flags + currency formatting for admin pages |
| `services/api.js` | Axios instance with JWT interceptor + GET response cache |

**Feature flags** are stored as `features JSONB` on the `companies` table and exposed via `useCompanyFeatures()`. Every admin page reads flags to show/hide UI. Default features: `physical_location`, `tags`, `barcodes_qr`, `public_catalog` (see `DEFAULT_FEATURES` in `backend/app/models/schemas.py` and `frontend/src/context/CompanyFeaturesContext.jsx`).

**`public_catalog` feature flag** — lets a company run InventoryAI purely as an internal ERP, hiding its public catalog/chat/reservations.
- Defaults to `true` when missing (backward compatible).
- Backend: `app/core/company_features.py` exports `get_active_company(slug)` (404 if company not found/inactive) and `require_public_catalog(company)` (404 if `features.public_catalog === False`). Used by `routers/products.py`, `categories.py`, `reservations.py`, `chat.py` (all message/image/audio/transcribe endpoints) on every public-facing endpoint.
- `routers/companies.py` `list_companies_public()` (`GET /companies/`, no auth) now also selects `business_type` and `features` so the frontend can read the flag.
- Frontend: `pages/public/HomePage.jsx` filters companies where `features?.public_catalog === false` out of the public directory entirely. `pages/public/CompanyCatalogPage.jsx` still resolves by slug and shows a "catálogo no disponible" screen if a disabled company's URL is visited directly.
- Super admin toggle: `pages/superadmin/CompaniesPage.jsx` `FEATURE_LABELS` includes `public_catalog: 'Catálogo público (chat IA, reservas)'`. Fixed: `customFeatures` state now initializes as `{ ...DEFAULT_FEATURES, ...(company.features || {}) }` (imported from `CompanyFeaturesContext.jsx`), so a company with no `public_catalog` key in `features` shows the toggle as ON (matching real backend behavior). The non-custom "Features que se activarán" preview also merges each business-type preset with `DEFAULT_FEATURES` (`{ ...DEFAULT_FEATURES, ...presets[btype] }[key]`) so `public_catalog` shows as active for every sector preset, since none of the hardcoded presets (general/alimentos/farmacia/etc.) explicitly list it.

**Theming:** Each company has a `brand_color` (hex). Applied as CSS `--brand` variable via ThemeProvider. All public-facing pages use this color.

**API cache** (`services/api.js`): GET responses are cached in memory with per-route TTLs (e.g. `/products` = 30s, `/categories` = 60s). Call `clearCache('/products')` after mutations.

---

## Key Database Tables

- `companies` — `business_type`, `features JSONB`, `currency`, `brand_color`, `logo_url`
- `user_profiles` — mirrors `auth.users`, adds `company_id`, `role`, `is_active`
- `products` — `company_id`, `images JSONB`, `tags TEXT[]`, `embedding vector(1536)`, `cost_price`
- `categories` — `company_id`, `max_reservation_qty`
- `product_warehouse_stock` — `quantity`, `min_stock_alert`, `aisle`, `shelf`, `bin` (warehouse-internal), `store_location` (customer-facing), `nearest_expiry`
- `stock_movements` — audit log for every stock change
- `product_batches` — batch/lot tracking with expiry
- `product_serial_numbers` — 1:1 serial tracking
- `reservations` — public reservations with unique `code`
- `reorder_requests` — auto-created when `quantity <= min_stock_alert`
- `putaway_rules` — suggested warehouse locations per category
- `notifications` — in-app alerts (Supabase Realtime)

---

## Business Logic Highlights

**Stock movement types:** `entrada` (add), `salida` (subtract, fails if insufficient), `ajuste` (set absolute), `transferencia` (handled separately).

**Auto-reorder:** When a movement or `set_stock` results in `quantity <= min_stock_alert`, the backend auto-creates a `reorder_requests` row (if none pending) and sends in-app + email notifications.

**Batch tracking:** On `entrada` movements, if `features.batch_tracking` is enabled, a `product_batches` row is created automatically (generates `LOTE-YYYYMMDD-XXXX` if no `batch_code` provided).

**Picking lists:** Generated from reservations, items sorted by warehouse location (aisle/shelf/bin). Employees see both warehouse location and store location.

**AI tools** (visible only to chat): `get_product_detail`, `get_stock_availability` — these expose only `store_location`, never internal warehouse coordinates.

**Chat routing — generic catalog questions vs. institutional info:** "¿Qué me ofreces / qué tienen / qué venden?" must route to `search_products` (broad query) — it's a catalog browse request, NOT institutional. `search_company_info` is reserved for clearly institutional questions (horarios, ubicación, políticas, pagos, envíos). See `SYSTEM_PROMPT` in `chat_agent.py`.

**Dual location:**
- `aisle/shelf/bin` → warehouse internal, visible to employees and picking
- `store_location` → free-text, visible to customers in catalog and AI chat

---

## Roles Summary

| Role | company_id | Access |
|------|-----------|--------|
| `super_admin` | `None` | All companies, platform metrics |
| `admin` | set | Full company management |
| `employee` | set | Read + stock movements + picking |
| Public | — | Catalog + reservation by code |

---

## What This App Does NOT Do

- No payment processing (Stripe not integrated)
- No PDF export — CSV/Excel export exists in ReportsPage; PDF generation (jsPDF/react-pdf) is not implemented
- No N8n / external automation (must be added externally via webhooks)
- No real-time stock updates across tabs — Supabase Realtime is only wired for in-app notifications; stock numbers shown on screen may be stale if another user changed them without a page refresh

## What This App DOES Do (non-obvious)

- **Barcode/QR scanner**: `BarcodeScannerModal.jsx` uses `html5-qrcode` (lazy-loaded); available in StockPage and ProductsPage
- **Supabase RLS**: Enabled on all tables with policies in `supabase/schema.sql`; the Python layer adds a second enforcement layer
- **Instruction-aware semantic search**: `embedding_service.py` adds a task instruction prefix to search queries (not documents) for better Qwen3-Embedding retrieval
- **Embedding model**: `POST /products/reembed-all` re-generates all company product embeddings (use after model changes)
