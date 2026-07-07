# Plan: Velocidad + Robustez (costo $0)

Plan de ejecución por fases para InventoryAI. Autocontenido: está pensado para que
un agente (Claude) lo ejecute sin contexto previo de la sesión donde se diseñó.

## REGLAS ABSOLUTAS (no negociables)

1. **NUNCA hagas commits ni push.** El usuario hace TODOS los commits. Deja los cambios en el working tree.
2. **Trabaja SOLO en este repo** (`inventoryai`). No toques ningún otro proyecto (existe una app RAG aparte llamada Papyrus — no la toques).
3. **Responde al usuario en español.**
4. **Costo $0:** no agregues Redis, ni servicios de pago, ni cambies de plan de Supabase (está en Free) ni de Railway.
5. Lee `CLAUDE.md` en la raíz antes de empezar — tiene la arquitectura, los patrones de Supabase y las trampas conocidas (ej. `super_admin` tiene `company_id = None`).
6. Después de CADA fase, corre la verificación de esa fase antes de continuar. Si algo rompe los tests, arréglalo antes de seguir.

## Verificación global (correr al final de cada fase)

```bash
cd backend
python -m compileall -q app          # sin errores de sintaxis
python -m pytest                     # la suite completa debe pasar (hoy: 26+ tests)
python -c "import app.main"          # el import no debe fallar

cd ../frontend
npm run build                        # solo si la fase tocó frontend
```

## Contexto técnico mínimo

- Backend: FastAPI + supabase-py **síncrono** (cliente `service_role`, en `app/core/supabase_client.py`).
- Ya existe `run_with_retry` en `app/core/supabase_client.py`:
  ```python
  async def run_with_retry(fn, retries: int = 2):
      # ejecuta fn (ej. lambda: query.execute()) en asyncio.to_thread,
      # reintenta ante httpx.RemoteProtocolError / ReadError / ConnectError
  ```
- Ya usan `run_with_retry` (NO rehacer): `core/company_features.py` (`get_active_company`,
  que ya es `async`), los endpoints públicos de `companies.py`, `products.py`,
  `categories.py`, `tables.py`, `warehouses.py`, y todo `reorder.py`.
- Tests: `backend/tests/` con un mock `FakeSupabase` en `conftest.py`. Varios tests
  llaman a las funciones de router directamente con `asyncio.run(...)` — si cambias
  una función de `async def` a `def`, ACTUALIZA los tests que la llamen.
- Multi-tenancy: se aplica manualmente con `.eq("company_id", ...)` en cada query.
  El cliente usa `service_role`, que hace **bypass de RLS** — la capa Python es la única defensa real.

---

# FASE 1 — Desbloquear el event loop

## Problema

Casi todos los endpoints son `async def` pero llaman a `supabase.table(...).execute()`
**síncrono**. En FastAPI, un endpoint `async` corre en el event loop: mientras una
llamada a Supabase espera red (50–300ms), ninguna otra request avanza. Es el cuello
de botella #1 de velocidad y concurrencia.

## 1.1 — Regla de conversión, router por router

Recorre TODOS los routers en `backend/app/routers/` (~21 archivos) y aplica esta
regla a cada endpoint:

- **Si el cuerpo NO usa `await` en absoluto** → cambia `async def` por `def`.
  FastAPI corre los endpoints `def` en un threadpool automáticamente. Cero cambio de lógica.
  (Los `Depends(...)` siguen funcionando igual en endpoints síncronos.)
- **Si el cuerpo SÍ usa `await`** (emails con `asyncio.create_task`, chat, embeddings,
  `await get_active_company`, etc.) → debe seguir siendo `async def`, y entonces envuelve
  cada `.execute()` síncrono así:
  ```python
  # ANTES
  result = supabase.table("x").select("*").eq("company_id", cid).execute()
  # DESPUÉS
  query = supabase.table("x").select("*").eq("company_id", cid)
  result = await run_with_retry(lambda: query.execute())
  ```
  ⚠️ Construye la query en una variable ANTES del lambda. Si el lambda está dentro de un
  loop, cuidado con late-binding: usa `lambda q=query: q.execute()`.

Importa en cada router que lo necesite:
```python
from app.core.supabase_client import supabase, run_with_retry
```

Notas por archivo:
- `reports.py` tiene una **copia local duplicada** `_run_with_retry` (~línea 20).
  Elimínala e importa la central. Revisa que las llamadas existentes sigan funcionando
  (la firma es la misma).
- `reservations.py` `create_public_reservation` usa `asyncio.create_task(send_reservation_email(...))`
  → debe seguir `async`; envuelve sus ~6 queries en `run_with_retry`.
- `chat.py`: `_get_daily_limit` hace una query síncrona dentro de funciones sync llamadas
  desde endpoints async — envuélvela o conviértela con el mismo criterio.
- `bookings.py` ya usa `await get_active_company(...)` → sus endpoints públicos siguen async;
  envuelve el resto de sus queries.
- NO toques la lógica de negocio, solo el mecanismo de ejecución.

⚠️ **Tests:** `tests/test_booking_anti_abuse.py` llama `asyncio.run(bookings.create_public_booking(...))`,
y otros tests hacen lo mismo con otras funciones. Si una función pasa a ser síncrona,
cambia `asyncio.run(f(...))` por `f(...)` en el test. Corre pytest después de cada
router grande, no al final de todo.

## 1.2 — Verificación local de JWT en `auth.py`

Hoy `get_current_user` en `app/core/auth.py` hace `supabase.auth.get_user(token)` —
un roundtrip de red a Supabase en cada cache-miss (además síncrono/bloqueante).

Cambio:
1. Agrega a `Settings` en `app/core/config.py`:
   ```python
   supabase_jwt_secret: str = ""   # Settings → API → JWT Secret en el dashboard de Supabase
   ```
2. Agrega `PyJWT` a `backend/requirements.txt` (y por tanto a requirements-dev).
3. En `get_current_user`, si `settings.supabase_jwt_secret` no está vacío:
   ```python
   import jwt as pyjwt
   payload = pyjwt.decode(
       token,
       settings.supabase_jwt_secret,
       algorithms=["HS256"],
       audience="authenticated",   # los JWT de Supabase usan aud=authenticated
   )
   user_id = payload["sub"]
   email = payload.get("email")
   ```
   - `pyjwt.decode` ya valida firma y expiración; captura `pyjwt.InvalidTokenError` → 401.
   - Después sigue haciendo la query a `user_profiles` (esa sí es necesaria para
     role/company_id) — envuélvela en `run_with_retry`.
4. Si `supabase_jwt_secret` está vacío → fallback al flujo actual con
   `supabase.auth.get_user(token)` (para que nada se rompa hasta que el usuario
   configure la env var en Railway y en su `.env` local).
5. **Fix de fuga de información:** en el `except Exception` final (~línea 110), NO
   devuelvas `str(e)` al cliente. Loguea el detalle con `logger.error(...)` y responde
   `HTTPException(401, "Error de autenticación")` genérico.
6. El cache en memoria existente (`_auth_cache`, TTL 5 min) se mantiene tal cual.

Avísale al usuario al terminar: debe agregar `SUPABASE_JWT_SECRET` en Railway y en
`backend/.env` (él lo hace, no le pidas el valor por chat).

## Verificación Fase 1

- `python -m pytest` completo en verde.
- `python -c "import app.main"` OK.
- Prueba manual: levantar `uvicorn app.main:app --reload` y golpear 2–3 endpoints
  (público + autenticado si hay token de prueba).
- Grep de control: no debe quedar ningún endpoint `async def` cuyo cuerpo tenga
  `.execute()` sin envolver (busca `\.execute\(\)` en routers y revisa el contexto).

---

# FASE 2 — Streaming SSE del chat

## Problema

`POST /api/v1/chat/message` espera a que el loop agéntico completo termine (LLM →
tools → LLM final, hasta 1536 tokens) y devuelve todo de golpe. El usuario mira un
spinner 8–15s. Streamear el turno final baja el tiempo-hasta-primer-token a ~1–2s.

## 2.1 — Backend: `chat_stream()` en `app/agents/chat_agent.py`

La función `chat()` actual hace un loop agéntico con el cliente `AsyncOpenAI` de
DeepInfra (`stream=False`). Crea una función NUEVA `chat_stream()` (no modifiques
`chat()` — se usa en `/chat/audio` y en integraciones) que sea un **async generator**:

- Mismo armado de system prompt, historial (`_history_store`, `_safe_window`) y tools.
- Loop agéntico: llama al modelo con `stream=True`. Acumula los deltas:
  - Si el stream trae `tool_calls` (llegan como deltas con `index`, hay que
    ensamblarlos: concatenar `function.arguments` por index) → al terminar el stream,
    ejecuta los tools igual que `chat()`, agrega los mensajes al historial y repite el loop.
  - Si el stream trae `content` (respuesta final) → **yield** cada delta de texto
    conforme llega, y acumúlalo para guardarlo al final en `_history_store`.
- Protección: máximo de iteraciones del loop igual al de `chat()`.
- Al terminar: guarda el mensaje completo del asistente en el historial de la sesión
  (idéntico a `chat()`) para que el contexto multi-turno no se rompa.
- Registra el uso/costo en `ai_usage_log` igual que lo haga `chat()` (revisa cómo lo
  hace y replica; con streaming el usage viene en el último chunk si pides
  `stream_options={"include_usage": True}` — DeepInfra es OpenAI-compatible).

## 2.2 — Backend: endpoint `POST /chat/message/stream` en `app/routers/chat.py`

- `StreamingResponse` ya está importado (línea 8, hoy sin usar).
- Mismas validaciones que `/chat/message`, en el mismo orden:
  `_check_ip_rate_limit(request)` → `await _check_public_catalog(data.company_slug)`
  → `_check_rate_limit(data.company_slug)` → mensaje no vacío.
- Formato SSE:
  ```
  data: {"delta": "texto parcial"}\n\n
  ...
  data: {"done": true, "used_tools": [...]}\n\n
  ```
- Respuesta: `StreamingResponse(gen, media_type="text/event-stream",
  headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})`.
- Si el generador lanza excepción a mitad de stream, emite
  `data: {"error": "mensaje amigable"}\n\n` y termina (ya no se puede cambiar el status code).
- **Mantén `/chat/message` intacto** — lo usan `/chat/audio` y la integración con Papyrus/n8n.

## 2.3 — Frontend: `ChatWidget.jsx` consume el stream

`frontend/src/components/chat/ChatWidget.jsx` (lo comparten el chat del catálogo y el
widget embebible — un solo cambio cubre ambos):

- Axios NO soporta streaming en navegador → usa `fetch()` nativo con
  `response.body.getReader()` + `TextDecoder`, parseando líneas `data: `.
- Al primer delta: crea el mensaje del asistente vacío y ve agregando texto
  (el `parseMarkdown` existente se aplica sobre el texto acumulado en cada update —
  cuidado: tiene un regex que borra imágenes markdown incompletas, lo cual es
  PERFECTO para streaming porque oculta imágenes a medio llegar).
- En `{"done": true}` → marca el mensaje como completo.
- **Fallback:** si el fetch de streaming falla (error de red, 4xx/5xx antes del primer
  delta), reintenta una vez contra el endpoint clásico `/chat/message` para no dejar
  al usuario sin respuesta.
- La URL base de la API está en `frontend/src/services/api.js` — reutilízala, no
  hardcodees la URL.
- El estado "escribiendo..." (typing indicator) se apaga al llegar el primer delta.

## Verificación Fase 2

- Backend: pytest en verde + probar el endpoint con `curl -N` viendo llegar los chunks.
- Frontend: `npm run dev` + abrir el catálogo público, mandar "¿qué me ofreces?" y
  ver el texto aparecer progresivamente. Probar también una pregunta que use tools
  (la parte de tools no streamea — es normal; solo streamea la respuesta final).
- Probar el widget embebido (ruta `/embed/:companySlug`) — mismo componente, debe funcionar igual.
- Verificar que el historial multi-turno sigue funcionando (preguntar algo, luego "¿y en azul?").

---

# FASE 3 — Cierres de seguridad

## 3.1 — Proteger `GET /reservations/public/by-email`

`app/routers/reservations.py` (~línea 132): hoy CUALQUIERA con un email ajeno obtiene
el historial completo de reservas de esa persona (nombre, teléfono, productos). Es
enumeración de PII.

Cambio:
1. Agrega un parámetro requerido `code: str` (query param). Antes de devolver el
   historial, verifica que exista una reserva con `company_id` + `client_email` (el
   email, normalizado `.lower().strip()`) + `reservation_code == code.upper()`. Si no
   hay match → `HTTPException(404, "No se encontró ninguna reserva con ese código y email")`.
   (El código actúa como prueba de propiedad: solo quien recibió al menos un email de
   reserva conoce un código suyo.)
2. Rate limit por IP: reutiliza el patrón de `bookings.py` (`_ip_bookings` — dict en
   memoria con ventana horaria). Máximo ~10 consultas/hora por IP → 429.
3. **Frontend:** busca dónde se llama a `by-email` (grep `by-email` en `frontend/src`)
   — hay una vista "Mis reservas" en el catálogo público. Agrega el campo "código de
   reserva" al formulario con un texto de ayuda ("lo encuentras en el email de
   confirmación de cualquiera de tus reservas").

## 3.2 — Decremento atómico de stock (RPC)

Hoy el patrón es: leer `quantity` → calcular en Python → `update` con valor absoluto.
Dos requests concurrentes sobre el mismo producto pierden actualizaciones (sobreventa).

1. Crea `supabase/migrations/009_atomic_stock.sql` con DOS funciones:
   ```sql
   -- Estricta: falla si no hay stock suficiente (para salidas/ventas)
   create or replace function decrement_stock_strict(
     p_product_id uuid, p_warehouse_id uuid, p_qty numeric
   ) returns numeric language plpgsql as $$
   declare new_qty numeric;
   begin
     update product_warehouse_stock
        set quantity = quantity - p_qty
      where product_id = p_product_id
        and warehouse_id = p_warehouse_id
        and quantity >= p_qty
     returning quantity into new_qty;
     if new_qty is null then
       raise exception 'INSUFFICIENT_STOCK';
     end if;
     return new_qty;
   end $$;

   -- Con clamp a 0: para completar reservas/bookings (conserva el comportamiento
   -- actual de max(0, ...) pero de forma atómica)
   create or replace function decrement_stock_clamped(
     p_product_id uuid, p_warehouse_id uuid, p_qty numeric
   ) returns numeric language plpgsql as $$
   declare new_qty numeric;
   begin
     update product_warehouse_stock
        set quantity = greatest(quantity - p_qty, 0)
      where product_id = p_product_id
        and warehouse_id = p_warehouse_id
     returning quantity into new_qty;
     return new_qty;  -- null si no existe la fila
   end $$;
   ```
2. Úsalas (vía `supabase.rpc("decrement_stock_strict", {...})`) en los puntos donde hoy
   hay read-modify-write de stock. Localízalos con grep de `quantity` en routers:
   - `reservations.py` `update_reservation` rama `completed` → `decrement_stock_clamped`
     (hoy hace `max(0, ...)`).
   - `stock.py` movimientos tipo `salida` → `decrement_stock_strict` (hoy falla si no
     alcanza — conserva ese comportamiento; captura la excepción del RPC y devuelve el
     mismo error 400 que hoy).
   - `recipes.py` registrar venta (descuento de insumos por receta) → `strict` o
     `clamped` según el comportamiento actual — LÉELO primero y conserva la semántica.
   - `bookings.py` completar booking (descuento por receta de cada item) → ídem.
   - ⚠️ El chequeo de `min_stock_alert`/auto-reorden que hoy ocurre tras el update debe
     seguir ocurriendo: el RPC devuelve la cantidad nueva — úsala para esa lógica en
     vez de recalcular.
3. **Tests:** el `FakeSupabase` de `conftest.py` probablemente no soporta `.rpc()` para
   estas funciones. Agrégale un handler simple de rpc que simule ambas funciones sobre
   su dict en memoria, y ajusta los tests existentes que dependan del patrón viejo
   (`test_recipe_depletion.py`, `test_register_sale.py` son los más probables).
4. **Entregable al usuario:** dile explícitamente que debe correr la migración 009 en
   el SQL Editor de Supabase (producción) ANTES de hacer push del código, o el backend
   fallará llamando funciones inexistentes.

## 3.3 — Test de aislamiento multi-tenant

Nuevo `backend/tests/test_tenant_isolation.py`:
- Con `FakeSupabase`, crea empresa A y empresa B con productos/reservas propias.
- Llama a los endpoints de lectura staff/admin más importantes (productos, stock,
  reservas, dashboard) autenticado como admin de A (mockea el `user` dict con
  `{"id": ..., "company_id": "A", "role": "admin"}` — no hace falta JWT real, llama
  las funciones de router directo como hacen los demás tests).
- Verifica que NINGÚN resultado contenga filas de la empresa B.
- Verifica también el caso documentado en CLAUDE.md: `super_admin` con
  `company_id=None` contra endpoints `require_staff` → debe dar 401, no datos de nadie.

## Verificación Fase 3

- pytest completo en verde (incluidos los tests nuevos).
- Probar `by-email` con y sin código válido (Swagger `/docs`).
- Recordarle al usuario la migración 009.

---

# FASE 4 — Observabilidad y limpieza (todo gratis)

## 4.1 — Sentry (free tier, $0)

1. Backend: agrega `sentry-sdk[fastapi]` a requirements. En `app/main.py`:
   ```python
   if settings.sentry_dsn:
       import sentry_sdk
       sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.environment,
                       traces_sample_rate=0)   # solo errores, sin performance (gratis)
   ```
   Agrega `sentry_dsn: str = ""` a Settings. Si está vacío no se inicializa (local/CI
   no lo necesitan).
2. Frontend: `@sentry/react` con `import.meta.env.VITE_SENTRY_DSN` — mismo patrón: si
   no hay DSN, no se inicializa. Solo `Sentry.init` básico, sin replay ni tracing
   (mantener el bundle ligero).
3. Dile al usuario: crear cuenta gratis en sentry.io, un proyecto Python y uno React,
   y poner los DSN en Railway (`SENTRY_DSN`) y Vercel (`VITE_SENTRY_DSN`).

## 4.2 — `/health` real

En `app/main.py`, el health check debe verificar la DB:
```python
@app.get("/health")
def health():
    try:
        supabase.table("companies").select("id").limit(1).execute()
        db = "ok"
    except Exception:
        db = "down"
    return {"status": "ok" if db == "ok" else "degraded", "db": db, ...}
```
(Síncrono `def` — consistente con la Fase 1.)

## 4.3 — Barrido de `datetime.utcnow()`

Está deprecado y produce timestamps naive. Grep `utcnow` en `backend/app` y reemplaza:
```python
# ANTES
datetime.utcnow().isoformat()
# DESPUÉS
datetime.now(timezone.utc).isoformat()
```
Cuidado con los imports (`from datetime import datetime, timezone`). NO cambies la
semántica: donde se comparan strings ISO contra columnas de la DB, verifica que el
sufijo `+00:00` no rompa comparaciones (Postgres timestamptz lo maneja bien; si algún
código compara strings en Python, revisa ese caso puntual). Los tests deben seguir en verde.

## 4.4 — Backup semanal automático (crítico en Supabase Free)

Supabase Free NO tiene backups automáticos. Crea `.github/workflows/backup.yml`:
```yaml
name: DB Backup
on:
  schedule:
    - cron: "0 6 * * 0"   # domingos 06:00 UTC
  workflow_dispatch: {}    # botón manual
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Dump database
        env:
          DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          sudo apt-get update && sudo apt-get install -y postgresql-client
          pg_dump "$DB_URL" --no-owner --no-privileges -f backup.sql
      - uses: actions/upload-artifact@v4
        with:
          name: db-backup-${{ github.run_id }}
          path: backup.sql
          retention-days: 90
```
Nota para el usuario: debe crear el secret `SUPABASE_DB_URL` en GitHub (Settings →
Secrets) con la **connection string de sesión (puerto 5432 o pooler en modo session)**
del dashboard de Supabase. Los artifacts viven 90 días — suficiente como red de
seguridad semanal. Si el repo es público, verificar que los artifacts no sean
descargables por terceros (en repos públicos los artifacts son visibles para
cualquiera con acceso al repo — si es público, AVISAR al usuario y proponer
alternativa antes de activar el workflow).

## Verificación Fase 4

- pytest + compileall + `import app.main` en verde.
- `npm run build` en verde.
- `/health` responde con `db: ok` en local.
- El workflow de backup se valida con `workflow_dispatch` manual (lo dispara el
  usuario tras crear el secret — tú solo dejas el archivo listo).

---

# Resumen de acciones que quedan en manos del usuario

| Cuándo | Acción |
|---|---|
| Fase 1 | Agregar `SUPABASE_JWT_SECRET` en Railway y `backend/.env` |
| Fase 3 | Correr `supabase/migrations/009_atomic_stock.sql` en Supabase ANTES del push |
| Fase 4 | Crear cuenta Sentry + DSNs en Railway/Vercel; crear secret `SUPABASE_DB_URL` en GitHub |
| Siempre | Commits y push (el agente NUNCA commitea) |
