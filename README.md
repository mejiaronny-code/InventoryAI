# 🚀 InventoryAI — Guía de Instalación Completa

Stack: FastAPI + Supabase + React + Groq + OpenAI Embeddings + LangSmith

---

## 📋 PASO 1 — REQUISITOS PREVIOS

Instala lo siguiente antes de continuar:

- **Node.js** v18+ → https://nodejs.org
- **Python** 3.11+ → https://python.org
- **Cuenta Supabase** → https://supabase.com (gratis)
- **API Key Groq** → https://console.groq.com (gratis)
- **API Key OpenAI** → https://platform.openai.com (solo embeddings, costo mínimo)
- **API Key LangSmith** → https://smith.langchain.com (gratis tier)

---

## 📦 PASO 2 — CONFIGURAR SUPABASE

### 2.1 Crear proyecto
1. Ve a https://supabase.com → "New project"
2. Nombre: `inventoryai` | Elige región más cercana
3. Anota: **Project URL** y **Service Role Key** (Settings → API)
4. También anota la **Anon/Public Key** para el frontend

### 2.2 Ejecutar el schema SQL
1. En tu proyecto Supabase → **SQL Editor** → "New query"
2. Copia TODO el contenido de `supabase/schema.sql`
3. Haz clic en **Run** (▶)
4. Deberías ver: "Success. No rows returned"

### 2.3 Verificar la extensión pgvector
En SQL Editor ejecuta:
```sql
select * from pg_extension where extname = 'vector';
```
Debe retornar una fila. Si no, ejecuta:
```sql
create extension if not exists vector;
```

### 2.4 Crear el Super Admin
1. En Supabase → **Authentication** → **Users** → "Invite user"
2. Ingresa el email del super admin (ej: superadmin@inventoryai.com)
3. El usuario recibirá un email para establecer contraseña
4. Una vez creado, copia su **UUID** de la lista de usuarios
5. En SQL Editor ejecuta (reemplaza el UUID):
```sql
INSERT INTO public.user_profiles (id, role, full_name)
VALUES ('PEGA-AQUI-EL-UUID', 'super_admin', 'Super Admin');
```

### 2.5 Crear empresa demo y primer admin
En SQL Editor:
```sql
-- 1. Crear suscripción
INSERT INTO public.subscriptions (plan, status)
VALUES ('pro', 'active')
RETURNING id;
-- Copia el ID retornado ↑

-- 2. Crear empresa (reemplaza el subscription_id)
INSERT INTO public.companies (name, slug, subscription_id, settings)
VALUES (
  'Mi Empresa',
  'mi-empresa',
  'SUBSCRIPTION-ID-AQUI',
  '{"chat_welcome": "¡Hola! Soy tu asistente. ¿En qué puedo ayudarte?"}'
)
RETURNING id;
-- Copia el company_id ↑
```

6. Crear admin de empresa en Authentication → Invite user (ej: admin@miempresa.com)
7. Una vez creado, insertar perfil:
```sql
INSERT INTO public.user_profiles (id, company_id, role, full_name)
VALUES ('UUID-DEL-ADMIN', 'COMPANY-ID-AQUI', 'admin', 'Admin Principal');
```

### 2.6 Habilitar Realtime (notificaciones en tiempo real)
1. Supabase → **Database** → **Replication**
2. Activar `notifications` y `reservations` en la lista de tablas

### 2.7 Configurar Storage (opcional, para imágenes de productos)
1. Supabase → **Storage** → "New bucket"
2. Nombre: `product-images` | Public: ✅
3. En **Policies** → agregar policy "Allow public read"

---

## ⚙️ PASO 3 — CONFIGURAR BACKEND

### 3.1 Crear entorno virtual e instalar dependencias
```bash
cd inventoryai/backend

# Crear entorno virtual
python -m venv venv

# Activar (Linux/Mac)
source venv/bin/activate

# Activar (Windows)
venv\Scripts\activate

# Instalar dependencias
pip install -r requirements.txt
```

### 3.2 Configurar variables de entorno
```bash
# Copiar el archivo de ejemplo
cp .env.example .env

# Editar con tus valores reales
nano .env   # o usa tu editor favorito
```

Contenido del `.env`:
```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

GROQ_API_KEY=gsk_...
OPENAI_API_KEY=sk-...

LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=ls__...
LANGCHAIN_PROJECT=inventoryai-prod

APP_SECRET_KEY=genera-un-string-aleatorio-largo-aqui
FRONTEND_URL=http://localhost:5173
ENVIRONMENT=development
```

### 3.3 Iniciar el servidor
```bash
# Desde la carpeta backend/
uvicorn app.main:app --reload --port 8000
```

Verifica en: http://localhost:8000/health  
Documentación interactiva: http://localhost:8000/docs

---

## 🎨 PASO 4 — CONFIGURAR FRONTEND

### 4.1 Instalar dependencias
```bash
cd inventoryai/frontend

npm install
```

### 4.2 Configurar variables de entorno
```bash
cp .env.example .env
```

Edita `.env`:
```env
VITE_API_URL=http://localhost:8000/api/v1
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> ⚠️ Usa la **Anon Key** (pública), NO la Service Role Key en el frontend.

### 4.3 Iniciar servidor de desarrollo
```bash
npm run dev
```

App disponible en: http://localhost:5173

---

## 🧪 PASO 5 — VERIFICAR QUE TODO FUNCIONA

### 5.1 Checklist básico
- [ ] http://localhost:8000/health → `{"status":"ok"}`
- [ ] http://localhost:5173 → Lista de empresas
- [ ] http://localhost:5173/mi-empresa → Catálogo con chat
- [ ] http://localhost:5173/admin/login → Login admin
- [ ] Login con admin@miempresa.com → Dashboard

### 5.2 Probar el chat
1. Ve a http://localhost:5173/mi-empresa
2. Haz clic en el botón naranja flotante (esquina inferior derecha)
3. Escribe: "¿Qué productos tienen disponibles?"
4. El agente debe responder usando los tools

### 5.3 Probar búsqueda por imagen
1. En el chat, haz clic en el ícono de imagen 📷
2. Sube una foto de un producto
3. El sistema usará **llama-4-scout** para analizar la imagen
4. Luego buscará productos similares con pgvector

### 5.4 Verificar LangSmith
- Ve a https://smith.langchain.com
- Proyecto `inventoryai-prod`
- Deberías ver trazas de las conversaciones con tokens y costos

---

## 🗂️ ESTRUCTURA DEL PROYECTO

```
inventoryai/
├── supabase/
│   └── schema.sql              ← Ejecutar primero en Supabase
│
├── backend/
│   ├── app/
│   │   ├── main.py             ← Punto de entrada FastAPI
│   │   ├── core/
│   │   │   ├── config.py       ← Variables de entorno
│   │   │   ├── auth.py         ← JWT + roles
│   │   │   └── supabase_client.py
│   │   ├── models/
│   │   │   └── schemas.py      ← Modelos Pydantic
│   │   ├── routers/            ← Un archivo por módulo
│   │   │   ├── auth.py
│   │   │   ├── products.py     ← CRUD + embeddings automáticos
│   │   │   ├── chat.py         ← /chat/message y /chat/image
│   │   │   └── ...
│   │   ├── agents/
│   │   │   ├── chat_agent.py   ← Agente LangChain + Groq
│   │   │   └── tools.py        ← 6 tools del inventario
│   │   └── embeddings/
│   │       └── embedding_service.py ← OpenAI text-embedding-3-small
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/
    ├── src/
    │   ├── App.jsx             ← Rutas principales
    │   ├── context/
    │   │   └── AuthContext.jsx
    │   ├── services/
    │   │   └── api.js          ← Todas las llamadas al backend
    │   ├── components/
    │   │   ├── admin/          ← Layouts con sidebar
    │   │   └── chat/
    │   │       └── ChatWidget.jsx ← Chat flotante + imagen
    │   └── pages/
    │       ├── public/         ← HomePage, Catálogo, Reserva
    │       ├── admin/          ← Dashboard, Productos, etc.
    │       └── superadmin/     ← Empresas, Métricas
    ├── package.json
    └── .env.example
```

---

## 🤖 MODELOS DE IA USADOS

| Modelo | Proveedor | Uso |
|--------|-----------|-----|
| `llama-3.3-70b-versatile` | Groq | Chat principal (texto) |
| `meta-llama/llama-4-scout-17b-16e-instruct` | Groq | Búsqueda por imagen |
| `text-embedding-3-small` | OpenAI | Embeddings pgvector |

> **llama-4-scout** se activa **SOLO** cuando el usuario sube una imagen.
> El chat de texto **SIEMPRE** usa llama-3.3-70b.

---

## 🌐 DEPLOY EN PRODUCCIÓN

### Backend (Railway o Render)
```bash
# En Railway: conectar repositorio GitHub
# Variables de entorno: las mismas del .env

# Comando de inicio:
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

### Frontend (Vercel)
```bash
# Instalar Vercel CLI
npm i -g vercel

cd frontend
vercel

# En Vercel dashboard, agregar variables:
# VITE_API_URL=https://tu-backend.railway.app/api/v1
# VITE_SUPABASE_URL=...
# VITE_SUPABASE_ANON_KEY=...
```

---

## 🔔 CONFIGURAR CRON JOB (expiración de reservas)

En Supabase → **Database** → **Extensions** → activar `pg_cron`:

```sql
-- Ejecutar en SQL Editor
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Expirar reservas cada 15 minutos
SELECT cron.schedule(
  'expire-reservations',
  '*/15 * * * *',
  $$SELECT expire_reservations()$$
);
```

---

## ❓ SOLUCIÓN DE PROBLEMAS COMUNES

### "CORS error" en el frontend
→ Verifica que `FRONTEND_URL` en `.env` del backend sea exactamente la URL del frontend

### "pgvector not found"
→ Ejecuta `CREATE EXTENSION IF NOT EXISTS vector;` en Supabase SQL Editor

### "Error al crear embedding"
→ Verifica que `OPENAI_API_KEY` sea válida y tenga créditos

### Chat no responde
→ Verifica `GROQ_API_KEY` en https://console.groq.com/keys

### "Token inválido" al hacer login
→ Asegúrate de que el usuario tenga un registro en `user_profiles`

---

## 💰 COSTOS ESTIMADOS (mensual, empresa mediana)

| Servicio | Costo estimado |
|----------|---------------|
| Groq (llama-3.3-70b) | $0–5 (muy barato) |
| OpenAI embeddings | $0.01–0.50 |
| Supabase Free tier | $0 |
| Railway/Render | $5–10 |
| Vercel Free tier | $0 |
| **Total** | **~$5–15/mes** |

---

¡Listo! 🎉 Si tienes problemas, revisa los logs con:
```bash
# Backend
uvicorn app.main:app --reload --log-level debug

# Frontend
npm run dev
```
