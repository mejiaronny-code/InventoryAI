# AGENTS.md

Guía completa y autocontenida de InventoryAI para trabajar con cualquier LLM/agente de código (Claude, ChatGPT/Codex, Cursor, etc.). Si vienes de otra herramienta y no tienes contexto previo de este proyecto, lee esto antes de tocar código.

## Qué es InventoryAI

SaaS multi-tenant de gestión de inventario con chat de IA. Cada empresa (tenant) tiene: inventario propio, catálogo público opcional, chat de IA para clientes, reservas, y un panel de administración. Soporta varios "sectores" de negocio (general, alimentos, farmacia, ferretería, ropa, electrónica, restaurante) mediante feature flags — cada sector activa/desactiva funcionalidades distintas (fechas de vencimiento, lotes, números de serie, variantes, menú de restaurante, mesas, etc.).

**Stack:**
- Backend: **FastAPI** (Python) + **Supabase/Postgres** (con `pgvector` para embeddings) + **DeepInfra** (LLM de chat + embeddings, vía API compatible con OpenAI) + **LangChain** (tool calling del agente)
- Frontend: **React + Vite** + **Tailwind/DaisyUI**
- Infra: **Railway** (backend, Dockerfile) + **Vercel** (frontend)
- Observabilidad: **Sentry** (backend y frontend, opcional — se activa solo si hay DSN configurado)

**Deploy en vivo:**
- Backend: `https://inventoryai-production.up.railway.app` (Root Directory = `backend`, builder = Dockerfile)
- Frontend: `https://inventory-ai-ruddy.vercel.app` (Root Directory = `frontend`, framework = Vite)

---

## Comandos de desarrollo

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload          # http://localhost:8000
# Swagger UI: http://localhost:8000/docs

# Tests backend (in-memory, sin tocar Supabase real)
cd backend
python -m pytest                        # requiere requirements-dev.txt (pytest)

# Frontend
cd frontend
npm install
npm run dev                            # http://localhost:5173
npm run build
```

Copiar `backend/.env.example` → `backend/.env` y llenar variables antes de correr. El repo es **público** en GitHub — nunca commitear `.env`, DSNs de Sentry como secretos reales, ni connection strings.

**Variables de entorno clave (backend):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (debe ser `service_role`, NO `anon`), `DEEPINFRA_API_KEY`, `APP_SECRET_KEY`, `ENVIRONMENT`, `FRONTEND_URL` (debe coincidir exacto con la URL de Vercel por CORS), `LANGCHAIN_TRACING_V2`, `RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`, `SUPPORT_EMAIL`, `SENTRY_DSN` (opcional), `SUPABASE_JWT_SECRET` (opcional, evita round-trip de red en cada auth).

**Variables de entorno (frontend):** `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN` (opcional).

---

## Arquitectura backend (`backend/app/`)

| Path | Propósito |
|------|-----------|
| `main.py` | App FastAPI, CORS, registro de routers, `/health` (chequea conexión real a Supabase), init de Sentry, warm-up de modelos |
| `core/config.py` | Settings vía pydantic-settings (`Settings`, `get_settings()`) |
| `core/auth.py` | Verificación de JWT + cache en memoria (TTL 5 min) |
| `core/supabase_client.py` | Cliente Supabase (service_role, singleton) + `run_with_retry`/`run_with_retry_sync` (reintento ante cortes HTTP/2 transitorios) |
| `core/net.py` | `client_ip(request)` — resuelve la IP real del cliente tras el proxy de Railway (toma el **último** valor de `X-Forwarded-For`, no el primero — el primero lo controla el cliente y se puede falsear) |
| `core/company_features.py` | `get_active_company(slug)` (404 si no existe/inactiva) + `require_public_catalog(company)` (404 si el sector desactivó el catálogo público) |
| `models/schemas.py` | Todos los schemas Pydantic (input/output), `DEFAULT_FEATURES`, `BUSINESS_PRESETS` |
| `routers/` | Un archivo por dominio (ver tabla abajo) |
| `agents/chat_agent.py` | Agente LangChain — chat de texto (`chat`, `chat_stream`) y visión (`chat_with_image`) |
| `agents/tools.py` | Tools del agente: búsqueda de productos, stock, reservas, bookings, lotes, series, info institucional |
| `embeddings/embedding_service.py` | Embeddings vía DeepInfra (`Qwen3-Embedding-0.6B`, 1024d) |
| `services/notifications.py` | Emails vía Resend |

**Routers (`app/routers/`):** `auth`, `products`, `categories`, `warehouses`, `stock`, `batches`, `serials`, `reservations`, `picking`, `putaway`, `reorder`, `reports`, `chat`, `notifications`, `companies`, `dashboard`, `knowledge`, `integrations`, `recipes`, `tables`, `bookings`. Todos bajo prefijo `/api/v1`.

### Multi-tenancy — LA REGLA MÁS IMPORTANTE DEL PROYECTO

**Supabase RLS está habilitado pero el backend usa la `service_role` key, que IGNORA RLS por completo.** La única defensa real contra fuga/corrupción de datos entre empresas es que **cada query en Python filtre manualmente por `company_id`**. No hay red de seguridad automática — si un endpoint de mutación olvida validar que el recurso (producto, almacén, insumo de receta, etc.) pertenece a la empresa del usuario autenticado, cualquier usuario de OTRA empresa puede leerlo/mutarlo pasando su UUID directamente.

**Patrón obligatorio antes de cualquier mutación sobre un recurso por ID:**
```python
def _assert_product_in_company(product_id: str, company_id: str):
    q = supabase.table("products").select("id").eq("id", product_id).eq("company_id", company_id).maybe_single()
    res = _retry(q.execute)
    if not (res and res.data):
        raise HTTPException(404, "Producto no encontrado")
```
Ver `routers/stock.py` (`_assert_product_in_company`/`_assert_warehouse_in_company`) como referencia. Aplica lo mismo a cualquier tabla con `company_id` antes de un `insert`/`update`/`delete` sobre un ID que llega del cliente.

Hay un test suite dedicado a esto: `backend/tests/test_tenant_isolation.py` — corre con `FakeSupabase` en memoria (ver `tests/conftest.py`), siembra 2 empresas falsas y confirma que ningún endpoint sensible mezcla datos ni permite mutar recursos ajenos. **Si agregas un endpoint de mutación nuevo por ID, agrégale un test aquí.**

**Auth guards** (`app.core.auth`):
- `require_super_admin` — dueño de la plataforma, `company_id = None`
- `require_admin` — admin + super_admin
- `require_staff` — admin + employee + super_admin

⚠️ Cualquier endpoint con `require_staff` que filtre por `company_id` debe manejar el caso `super_admin` (company_id None):
```python
company_id = user.get("company_id")
if not company_id:
    raise HTTPException(status_code=401, detail="No se encontró la empresa asociada")
```

### Estado en memoria — NO escala a 2+ réplicas todavía

Rate limits (`routers/chat.py`, `reservations.py`, `bookings.py`), cache de auth (`core/auth.py`), historial de chat y cache de datos de empresa (`agents/chat_agent.py`) viven en diccionarios en memoria del proceso Python. **El deploy debe quedarse en 1 sola réplica de Railway** hasta migrar esto a Redis (ver `SECURITY_ROADMAP.md` Fase 3). Con 2+ réplicas los límites se multiplican por réplica y el historial/cache puede "perderse" según a qué réplica cae cada request.

### Patrones de Supabase a seguir

- Usar `.maybe_single()` (no `.single()`) cuando una fila puede no existir — evita `PGRST116`.
- Envolver accesos a Supabase con `run_with_retry()`/`run_with_retry_sync()` (retry ante `httpx.RemoteProtocolError`/`ReadError`/`ConnectError` — cortes HTTP/2 transitorios de Supabase).
- En `agents/tools.py` y `agents/chat_agent.py`, TODO acceso a Supabase debe ir envuelto (helper `_exec()` en `tools.py`) — estas funciones son `async def` pero las tools se llaman desde el loop principal del chat; una llamada síncrona ahí bloquea el servidor ENTERO mientras espera red. Usar `asyncio.gather()` para paralelizar consultas independientes cuando aplique.
- Endpoints "de solo lectura y sin await real dentro" son `def` normales (FastAPI los corre en threadpool automáticamente); los que sí hacen trabajo async real (`asyncio.gather`, awaits genuinos) son `async def`.

### Chat / Agente de IA

- Modelo de chat: `Qwen/Qwen3.6-35B-A3B` (streaming, tool calling) vía DeepInfra. Ocasionalmente DeepInfra tiene picos de lentitud/sobrecarga específicos de este modelo (se ha visto 15-90s para el primer token) — es infraestructura externa, no bug nuestro; suele normalizarse solo. Si se vuelve frecuente, alternativa evaluada y viable: `meta-llama/Llama-3.3-70B-Instruct` (confirmado que soporta tool calling igual de bien vía DeepInfra).
- Modelo de embeddings: `Qwen/Qwen3-Embedding-0.6B` (1024d) — se migró desde `Qwen3-Embedding-8B` (1536d) por picos de cold-start; mismo precio en DeepInfra, validado con datos reales antes de migrar (ver `supabase/migrations/014_switch_qwen3_0_6b.sql`). Si se vuelve a migrar de modelo de embeddings: hay que actualizar `EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` en `embedding_service.py`, la columna `vector(N)` en Postgres, las funciones `search_products_semantic`/`search_company_knowledge`, y re-generar TODOS los embeddings existentes (productos + chunks de conocimiento).
- `search_products` (tool) hace búsqueda semántica (pgvector) + fallback por keyword (solo si la semántica trae <5 resultados, para no gastar queries de más) + búsqueda por código de barras.
- Streaming: el modelo transmite las URLs de imagen **carácter por carácter** — `_split_flushable()` en `chat_agent.py` retiene una imagen markdown incompleta entera hasta que llegue completa, para que el dedupe de imágenes repetidas (`_dedupe_images()`) pueda verla de una sola vez.
- El chat usa la moneda/timezone/reglas de IA configuradas por empresa (`companies.settings`).
- **Warm-up:** tanto el modelo de chat como el de embeddings se "calientan" cada 10 min (`start_warmup_loop`, `start_chat_warmup_loop` en `main.py`) para evitar cold starts tras inactividad.

### Costos de IA

`ai_usage_log` guarda el costo REAL de DeepInfra por mensaje. El dashboard de cada empresa muestra ese costo multiplicado por `settings.ai_cost_multiplier` (margen, default 20×) — el super admin ve el costo real sin margen.

---

## Arquitectura frontend (`frontend/src/`)

| Path | Propósito |
|------|-----------|
| `pages/public/` | Catálogo, estado de reserva, auth pública — sin login. Se mantienen en el bundle principal (no lazy) por ser la entrada más común. |
| `pages/admin/` | Panel completo de admin/empleado — **todas cargadas con `React.lazy`** (code-splitting: un visitante del catálogo público nunca descarga estas páginas). |
| `pages/superadmin/` | `CompaniesPage`, `MetricsPage` — solo super_admin, también lazy. |
| `context/CompanyFeaturesContext.jsx` | Feature flags + formato de moneda para páginas de admin |
| `services/api.js` | Instancia de Axios con interceptor de JWT + cache de respuestas GET (TTL por ruta) |
| `App.jsx` | Router principal — ver patrón de `Suspense`/`lazy` ya aplicado; si agregas una página nueva de admin/superadmin, agrégala como `lazy(() => import(...))` y envuélvela en `<Suspense fallback={<PageLoader />}>`, NO como import estático. |

**Feature flags:** JSONB `features` en tabla `companies`, expuesto vía `useCompanyFeatures()`. Flags por defecto: `physical_location`, `tags`, `barcodes_qr`, `public_catalog`. Sector restaurante agrega: `menu_mode`, `recipes`, `table_reservations`, `pickup_orders`.

**`public_catalog` flag:** permite usar InventoryAI como ERP interno puro, ocultando catálogo/chat/reservas públicas. Default `true` si no está seteado. Backend: `require_public_catalog()`. Frontend: `HomePage.jsx` filtra empresas con `features.public_catalog === false` del directorio público.

**Theming:** cada empresa tiene `settings.primary_color`/`bg_color`/`text_color`, aplicado como variables CSS vía `ThemeProvider`. El endpoint público de listado de empresas (`GET /companies/`) solo expone un subconjunto seguro de `settings` (`primary_color`, `bg_color`, `text_color`, `currency`, `show_stock`, `chat_welcome`) — el resto (`ai_rules`, límites, timezone) es interno y NO se filtra ahí.

**API cache** (`services/api.js`): respuestas GET cacheadas en memoria con TTL por ruta. Llamar `clearCache('/products')` tras mutaciones.

---

## Tablas clave en Supabase

- `companies` — `business_type`, `features JSONB`, `settings JSONB` (moneda, colores, `ai_rules`, límites, timezone), `brand_color`, `logo_url`
- `user_profiles` — espeja `auth.users`, agrega `company_id`, `role`, `is_active`
- `products` — `company_id`, `images JSONB`, `tags TEXT[]`, `embedding vector(1024)`, `cost_price`, `product_type` (`simple`/`dish`/`ingredient`, sector restaurante)
- `categories` — `company_id`, `max_reservation_qty`
- `product_warehouse_stock` — `quantity`, `min_stock_alert`, `aisle`/`shelf`/`bin` (interno), `store_location` (cliente), `nearest_expiry`
- `stock_movements` — auditoría de cada cambio de stock
- `product_batches` — lotes con vencimiento
- `product_serial_numbers` — tracking 1:1
- `reservations` — reservas públicas de producto, código único
- `bookings` / `booking_items` — reservas de mesa / pre-orden (sector restaurante)
- `recipes` — receta de un platillo (insumos + cantidad)
- `restaurant_tables` — mesas/zonas (sector restaurante)
- `reorder_requests` — auto-creado cuando `quantity <= min_stock_alert`
- `putaway_rules` — ubicación sugerida por categoría
- `notifications` — alertas in-app (Supabase Realtime)
- `company_documents` / `company_document_chunks` — base de conocimiento institucional (embeddings para el chat)
- `ai_usage_log` — costo real por mensaje de chat

**Migraciones SQL:** viven en `supabase/migrations/`, se corren MANUALMENTE en el SQL Editor de Supabase (no hay migration runner automático). Antes de cualquier deploy que dependa de una migración nueva, correrla primero en producción.

---

## Lógica de negocio

- **Movimientos de stock:** `entrada` (suma), `salida` (resta, decremento atómico vía RPC `decrement_stock_strict`, falla si insuficiente), `ajuste` (fija valor absoluto), `transferencia` (aparte). Toda `salida` manual exige `notes` (motivo) — trazabilidad ante robo/faltante.
- **Auto-reabastecimiento:** si `quantity <= min_stock_alert`, se crea `reorder_requests` (si no hay uno pendiente) + notificación in-app + email.
- **Lotes:** en `entrada`, si `features.batch_tracking`, se crea `product_batches` automático (`LOTE-YYYYMMDD-XXXX` si no se da código).
- **Picking:** listas generadas desde reservas, ordenadas por ubicación de almacén. Descuenta stock por variante también (vía `decrement_variant_stock_from_notes`, compartida entre `reservations.py` y `picking.py` — antes solo un camino la descontaba y se desincronizaba el stock por color/talla).
- **Sector restaurante:** platillos (`product_type='dish'`) no se gestionan por stock — su disponibilidad es el flag `is_available` ("agotado hoy"). Insumos (`product_type='ingredient'`) sí llevan stock normal y se descuentan por receta al registrar venta o completar un booking.
- **Ubicación dual:** `aisle`/`shelf`/`bin` = interno (empleados/picking); `store_location` = texto libre visible en catálogo y chat.
- **Anti-abuso:** rate limits por IP en chat, reservas ("mis reservas" por email exige código de una reserva propia como prueba de dueño), y bookings — todos en memoria (ver limitación de escalado arriba).

---

## Roles

| Rol | `company_id` | Acceso |
|---|---|---|
| `super_admin` | `None` | Todas las empresas, métricas de plataforma |
| `admin` | fijo | Gestión completa de su empresa |
| `employee` | fijo | Lectura + movimientos de stock + picking |
| Público | — | Catálogo + reserva por código + chat |

---

## Lo que la app NO hace

- No procesa pagos (Stripe no integrado)
- No exporta PDF (sí CSV/Excel en Reportes)
- No tiene automatización externa tipo N8n (webhooks solo si se agregan aparte)
- No hay stock en tiempo real entre pestañas — Supabase Realtime solo está cableado para notificaciones in-app

## Lo que SÍ hace (no obvio)

- Escáner de código de barras/QR (`BarcodeScannerModal.jsx`, `html5-qrcode`, lazy-loaded)
- RLS habilitado en Supabase pero NO es la defensa real (ver sección multi-tenancy arriba)
- Búsqueda semántica instruction-aware (prefijo de instrucción distinto para queries vs. documentos)
- Re-generar embeddings de todos los productos: `POST /products/reembed-all`
- Sentry opcional en backend y frontend — se activa solo si `SENTRY_DSN`/`VITE_SENTRY_DSN` están seteados; sin ellos, no hace nada (no rompe local/CI)
- `/health` chequea conexión real a Supabase (no es un mock que siempre dice "ok")

---

## Convenciones al modificar código

- **NUNCA hacer commits** salvo que el usuario lo pida explícitamente — el usuario comitea el 100% de las veces él mismo.
- Responder/documentar en español si el usuario escribe en español.
- No sobre-diseñar: parche puntual + test de regresión > refactor grande, salvo que se pida explícitamente.
- Antes de dar por terminado un cambio de backend: `python -m py_compile <archivo>` + `python -m pytest` en verde.
- Antes de dar por terminado un cambio de frontend: `npm run build` sin errores, y si es un cambio visual/de UX, verificar en un navegador real (no asumir que "debería verse bien").
- Repo público en GitHub — nunca commitear secretos reales (`.env`, connection strings, API keys) ni pegarlos en código fuente aunque el usuario los comparta en el chat.
