# Guía de Escalabilidad — InventoryAI

Referencia práctica: qué hacer cuando la app empiece a tener carga real.
Está ordenada por urgencia — no toques nada hasta que realmente lo necesites.

---

## Señales de que necesitas actuar

| Síntoma visible | Causa probable | Sección a leer |
|---|---|---|
| El chat IA responde lento para todos a la vez | Saturación de workers | §1 |
| Páginas del admin cargan lento bajo carga | 1 solo worker de Render | §1 |
| Supabase devuelve errores `connection timeout` | Pool de conexiones agotado | §2 |
| El chat pierde el historial al reiniciar el server | Sesiones en RAM | §3 |
| Costo de DeepInfra se dispara sin explicación | Abuso / bot | §4 |
| Notificaciones Realtime dejan de llegar | Límite de conexiones Supabase | §5 |

---

## §1 — Render: pasar de 1 a múltiples workers

**Cuándo:** Tienes >50 usuarios simultáneos y ves latencia alta en endpoints normales.

**Por qué pasa:**
Por defecto Render corre 1 proceso. Aunque FastAPI es async, la librería
`supabase-py` hace algunas llamadas bloqueantes internamente. Con carga alta
esto satura el event loop.

**Fix — cambiar el start command en Render:**

```bash
# Antes (1 worker — default actual)
uvicorn app.main:app --host 0.0.0.0 --port $PORT

# Después (4 workers — recomendado para producción)
uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 4
```

Dónde configurarlo: **Render Dashboard → tu servicio → Settings → Start Command**

**Regla práctica para elegir el número de workers:**
```
workers = (núcleos de CPU × 2) + 1
```
- Plan Starter de Render (0.5 CPU) → 2 workers
- Plan Standard (1 CPU) → 3 workers
- Plan Pro (2 CPU) → 5 workers

**Costo:** Más RAM por worker (~80–120 MB cada uno). En Render Standard (~512 MB RAM)
con 4 workers puedes quedarte sin memoria. Empieza con 2.

**Importante:** con múltiples workers, las sesiones de chat en memoria se pierden
si el request de un usuario va a un worker diferente al que tiene su historial.
Ver §3 para solucionar esto cuando llegues a ese punto.

---

## §2 — Supabase: connection pooling bajo carga

**Cuándo:** Ves errores `PGRST` o `connection timeout` en logs del backend, 
especialmente con muchos workers o muchas peticiones simultáneas.

**Por qué pasa:**
PostgreSQL tiene un límite de conexiones simultáneas. Cada worker de Python
puede abrir varias conexiones. Con 4 workers + muchas peticiones = pool agotado.

**Fix — activar PgBouncer en Supabase:**
1. Ir a Supabase Dashboard → Settings → Database
2. Activar **Connection Pooler** (modo Transaction)
3. Usar la connection string del pooler en lugar de la directa

En tu `.env` del backend:
```env
# Cambiar de conexión directa:
SUPABASE_DB_URL=postgresql://postgres:[password]@db.xxxx.supabase.co:5432/postgres

# A conexión pooled:
SUPABASE_DB_URL=postgresql://postgres.[project]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

**Nota:** el cliente actual (`supabase-py`) ya usa la REST API (PostgREST), no
conexión directa. Esto lo necesitarás solo si en el futuro cambias a
`asyncpg` o `SQLAlchemy` para queries más complejas.

---

## §3 — Chat IA: historial de sesiones en memoria

**Problema actual:**
```python
# chat_agent.py — el historial vive en RAM del proceso
conversation_histories: dict[str, list] = {}
```

Si Render reinicia el server (deploy, crash, escala), **todos los historiales
de conversación activos se pierden**. Con múltiples workers, cada worker tiene
su propio diccionario — el usuario puede "perder" contexto si su siguiente
request va a otro worker.

**Cuándo actuar:** Cuando tengas múltiples workers (§1) o cuando los usuarios
se quejen de que el chat "olvida" cosas.

**Fix — mover historial a Redis:**

1. Crear un Redis en Render (o usar Upstash, que tiene free tier):
   - Render: New → Redis
   - Upstash: https://upstash.com (más barato, pago por request)

2. Instalar dependencia:
```bash
pip install redis
```

3. Reemplazar el dict en memoria:
```python
# chat_agent.py — ANTES
conversation_histories: dict[str, list] = {}

def get_history(session_id: str) -> list:
    return conversation_histories.get(session_id, [])

def save_history(session_id: str, history: list):
    conversation_histories[session_id] = history[-20:]  # últimos 20 mensajes
```

```python
# chat_agent.py — DESPUÉS
import redis, json, os

_redis = redis.from_url(os.environ["REDIS_URL"])
HISTORY_TTL = 60 * 60 * 4  # 4 horas de inactividad

def get_history(session_id: str) -> list:
    raw = _redis.get(f"chat:{session_id}")
    return json.loads(raw) if raw else []

def save_history(session_id: str, history: list):
    _redis.setex(
        f"chat:{session_id}",
        HISTORY_TTL,
        json.dumps(history[-20:])
    )
```

4. Añadir `REDIS_URL` a las env vars de Render.

**Costo estimado Upstash:** $0 en free tier (10k requests/día), ~$0.2/100k requests después.

---

## §4 — DeepInfra: protección contra abuso

**Modelo de costo:**
DeepInfra cobra **por token**, no por suscripción. No hay rate limit de plan
como tal — el límite real es tu tarjeta de crédito.

**Estimación de costo normal:**
```
Qwen3: ~$0.10–0.30 por millón de tokens de input

Conversación típica de inventario: ~500–2000 tokens
10 empresas activas, 20 conversaciones/día, 1000 tokens promedio:
= 10 × 20 × 1000 = 200,000 tokens/día = ~$0.02–0.06/día = <$2/mes
```

**Riesgos:**
- Un bot haciendo miles de preguntas automáticas
- Un usuario dejando el chat en bucle
- Un embedding masivo (`/reembed-all`) disparado muchas veces

**Protecciones que ya tienes:**
- `ai_rules_limit` en settings (límite de reglas IA, no de mensajes)

**Protecciones recomendadas — agregar al endpoint del chat:**

```python
# routers/chat.py — rate limit simple por empresa
from collections import defaultdict
from datetime import datetime, date

# En memoria (suficiente para empezar, mover a Redis en §3 cuando escales)
_daily_counts: dict[str, dict] = defaultdict(dict)

def check_rate_limit(company_id: str, max_per_day: int = 500):
    today = date.today().isoformat()
    count = _daily_counts[company_id].get(today, 0)
    if count >= max_per_day:
        raise HTTPException(429, "Límite de mensajes diarios alcanzado")
    _daily_counts[company_id][today] = count + 1
```

**Configurar alertas en DeepInfra:**
- Dashboard → Billing → Usage Alerts
- Poner alerta en $10/día (si tu gasto normal es <$1/día, cualquier spike es obvio)

---

## §5 — Supabase Realtime: límite de conexiones

**Plan Free de Supabase:** 200 conexiones Realtime simultáneas.
**Plan Pro:** 500 conexiones.

Cada tab abierta del admin panel abre 2 canales Realtime:
- `notifications_{company_id}`
- `rt_reservations_INSERT_{company_id}`
- `rt_reservations_UPDATE_{company_id}`

Con el hook `useRealtimeInserts` actual: ~3 conexiones por tab abierta.

**Cuándo te afecta:** >65 admins con el panel abierto al mismo tiempo (plan free).

**Fix cuando llegue ese momento:**
1. Subir a Supabase Pro ($25/mes) — 500 conexiones
2. O consolidar los 3 canales en 1 por empresa:

```js
// En lugar de 3 canales separados, 1 canal que escucha todo
const channel = supabase
  .channel(`company_${companyId}`)
  .on('postgres_changes', { event: 'INSERT', table: 'notifications', filter: ... }, onNotif)
  .on('postgres_changes', { event: 'INSERT', table: 'reservations',  filter: ... }, onNewRes)
  .on('postgres_changes', { event: 'UPDATE', table: 'reservations',  filter: ... }, onUpdRes)
  .subscribe()
```

Esto reduce de 3 conexiones a 1 por tab.

---

## §6 — Embeddings: reembed masivo

**El endpoint `/products/reembed-all` es pesado:**
- Hace N llamadas a DeepInfra (una por producto)
- En un catálogo de 500 productos = 500 peticiones en secuencia
- Bloquea el worker durante todo ese tiempo

**Ya está implementado** pero si el catálogo crece mucho:

```python
# embeddings/embedding_service.py — agregar batching
# En lugar de una por una, enviar en lotes de 10
async def reembed_all(products: list, batch_size: int = 10):
    for i in range(0, len(products), batch_size):
        batch = products[i:i+batch_size]
        await asyncio.gather(*[embed(p) for p in batch])
        await asyncio.sleep(0.1)  # respetar rate limits
```

---

## Orden de implementación recomendado

Haz esto **solo cuando veas el síntoma**, no antes:

```
1. [Render: 2 workers]          ← primera señal de lentitud bajo carga
2. [DeepInfra: alertas billing] ← hacer esto HOY, tarda 2 minutos
3. [Redis para historial chat]  ← cuando tengas múltiples workers
4. [Rate limit de mensajes]     ← cuando tengas empresas activas reales
5. [Consolidar canales Realtime]← cuando pases de 60 admins simultáneos
6. [Supabase Pro]               ← cuando el free tier no alcance
```

---

## Costos aproximados por tier de escala

| Etapa | Usuarios simultáneos | Costo mensual aprox. |
|---|---|---|
| **Ahora** (1 worker, free tiers) | ~50 | Render ~$7 + Supabase $0 + DeepInfra <$2 = **~$9/mes** |
| **Crecimiento** (4 workers, Redis) | ~200 | Render ~$25 + Upstash ~$1 + DeepInfra ~$10 = **~$36/mes** |
| **Escala media** (Pro tiers) | ~1000 | Render ~$85 + Supabase $25 + DeepInfra ~$50 = **~$160/mes** |

Los números de DeepInfra dependen completamente de cuánto usen el chat tus clientes.
Todo lo demás (stock, reservas, catálogo) tiene costo casi cero en infraestructura.
