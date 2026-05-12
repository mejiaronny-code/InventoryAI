# TAREAS SUPERADMIN — InventoryAI

## Stack
- Backend: FastAPI + Python en /backend
- Frontend: React + Tailwind en /frontend  
- DB: Supabase (PostgreSQL + pgvector)
- Colores: Naranja (#f97316), blanco, negro
- Rutas superadmin: /superadmin/companies y /superadmin/metrics

---

## TAREA 1 — Eliminar empresas con cascade

### Backend
En `backend/app/routers/companies.py` agregar endpoint DELETE:
- Al eliminar una empresa borrar en cascada: products, warehouses, 
  categories, reservations, notifications, stock_movements, 
  product_warehouse_stock, ai_usage_log, user_profiles de esa empresa
- Usar la service_role_key que ya tenemos (bypasea RLS)
- Endpoint: DELETE /api/v1/companies/{company_id}

### SQL — ejecutar en Supabase para garantizar cascade
```sql
alter table public.warehouses 
  drop constraint warehouses_company_id_fkey,
  add constraint warehouses_company_id_fkey 
    foreign key (company_id) references public.companies(id) 
    on delete cascade;

alter table public.categories 
  drop constraint categories_company_id_fkey,
  add constraint categories_company_id_fkey 
    foreign key (company_id) references public.companies(id) 
    on delete cascade;

alter table public.products 
  drop constraint products_company_id_fkey,
  add constraint products_company_id_fkey 
    foreign key (company_id) references public.companies(id) 
    on delete cascade;

alter table public.reservations 
  drop constraint reservations_company_id_fkey,
  add constraint reservations_company_id_fkey 
    foreign key (company_id) references public.companies(id) 
    on delete cascade;

alter table public.notifications 
  drop constraint notifications_company_id_fkey,
  add constraint notifications_company_id_fkey 
    foreign key (company_id) references public.companies(id) 
    on delete cascade;

alter table public.ai_usage_log 
  drop constraint ai_usage_log_company_id_fkey,
  add constraint ai_usage_log_company_id_fkey 
    foreign key (company_id) references public.companies(id) 
    on delete cascade;
```

### Frontend
En `frontend/src/pages/superadmin/CompaniesPage.jsx`:
- Agregar botón "Eliminar" con modal de confirmación que diga 
  "¿Eliminar empresa X? Se borrará toda su información permanentemente"
- Después de eliminar refrescar la lista

---

## TAREA 2 — Botón cerrar sesión superadmin

En `frontend/src/components/admin/SuperAdminLayout.jsx`:
- Ya existe el botón de logout pero verificar que funcione correctamente
- Debe limpiar localStorage y redirigir a /admin/login
- El botón ya usa useAuth logout() — verificar que esté importado

---

## TAREA 3 — Fix suscripción 404 + comportamiento por estado

### Bug fix backend
En `backend/app/routers/companies.py` el endpoint PATCH subscription 
retorna 404. Revisar la ruta, actualmente es:
`PATCH /api/v1/companies/{company_id}/subscription?plan=trial&status=suspended`

El problema es que busca subscription_id dentro de companies pero 
puede no encontrarlo. Reescribir así:

```python
@router.patch("/{company_id}/subscription")
async def update_subscription(
    company_id: str,
    plan: str,
    status: str,
    user: dict = Depends(require_super_admin)
):
    # Buscar directamente la empresa
    company = supabase.table("companies")\
        .select("id, subscription_id")\
        .eq("id", company_id)\
        .single()\
        .execute()
    
    if not company.data:
        raise HTTPException(404, "Empresa no encontrada")
    
    sub_id = company.data.get("subscription_id")
    
    if sub_id:
        supabase.table("subscriptions")\
            .update({"plan": plan, "status": status})\
            .eq("id", sub_id)\
            .execute()
    else:
        # Crear suscripción si no existe
        new_sub = supabase.table("subscriptions")\
            .insert({"plan": plan, "status": status})\
            .execute()
        supabase.table("companies")\
            .update({"subscription_id": new_sub.data[0]["id"]})\
            .eq("id", company_id)\
            .execute()
    
    return {"message": "Suscripción actualizada"}
```

### Comportamiento por estado en frontend

En `frontend/src/pages/public/HomePage.jsx`:
- Filtrar empresas — NO mostrar las que tienen subscription 
  status = "cancelled"
- Para esto el endpoint GET /api/v1/companies/ debe hacer join 
  con subscriptions y excluir cancelled

En `frontend/src/pages/admin/DashboardPage.jsx` y AdminLayout:
- Al cargar verificar el estado de la suscripción de la empresa
- Si status = "suspended" mostrar banner full-screen naranja/negro que diga:
  "Tu cuenta ha sido pausada. Contacta al administrador de la plataforma."
- El banner bloquea todo el dashboard excepto el botón de cerrar sesión

En `backend/app/routers/companies.py` endpoint GET /companies/ público:
- Hacer join con subscriptions
- Excluir empresas cuya suscripción sea cancelled

---

## TAREA 4 — Admin panel responsive para móvil

En `frontend/src/components/admin/AdminLayout.jsx`:
- El sidebar en móvil ya tiene hamburger menu pero revisar que funcione
- Las tablas en móvil deben ser scrolleables horizontalmente — 
  ya tienen table-container pero verificar en pantallas pequeñas
- Los stat cards del dashboard deben ser 1 columna en móvil 
  (actualmente grid-cols-2)
- En móvil el padding debe ser p-4 en vez de p-6
- Los modales deben ocupar 95vw en móvil
- Breakpoint principal: sm = 640px

Archivos a revisar:
- `frontend/src/index.css` — ajustar clases responsive
- `frontend/src/pages/admin/DashboardPage.jsx` — grid responsive
- `frontend/src/components/admin/AdminLayout.jsx` — sidebar móvil

---

## TAREA 5 y 6 — Ver y asignar admin de cada empresa

### Backend
En `backend/app/routers/companies.py` agregar:
GET /api/v1/companies/{company_id}/users
→ lista todos los user_profiles de esa empresa con email de auth.users
POST /api/v1/companies/{company_id}/assign-admin
body: { user_id, role }
→ actualiza user_profiles.role y company_id

Para obtener el email necesitas consultar auth.users via service role:
```python
# Obtener emails de auth.users (requiere service role)
users = supabase.auth.admin.list_users()
```

### Frontend
En `frontend/src/pages/superadmin/CompaniesPage.jsx`:
- En cada fila de empresa agregar botón "👥 Gestionar usuarios"
- Abre modal con lista de usuarios de esa empresa mostrando:
  nombre, email, rol (badge), botones para cambiar rol o quitar
- Botón "Agregar usuario existente" — busca por email en auth.users 
  y lo asigna a esa empresa con el rol seleccionado
- Botón "Crear nuevo admin" — formulario con email + password + nombre,
  crea usuario en Supabase Auth y lo asigna como admin de esa empresa

---

## TAREA 7 — Métricas globales con gráficos y tráfico

### Backend
En `backend/app/routers/dashboard.py` endpoint GET /dashboard/superadmin:
Agregar al response:
```python
# Reservas por empresa (tráfico)
reservations_by_company = supabase.table("reservations")\
    .select("company_id, created_at")\
    .gte("created_at", month_start)\
    .execute()

# Agrupar por empresa y por día para el gráfico
# Retornar: { company_id: { total: N, by_day: [{date, count}] } }

# AI usage con detalle
ai_by_company = supabase.table("ai_usage_log")\
    .select("company_id, cost_usd, tokens_input, tokens_output, created_at")\
    .gte("created_at", month_start)\
    .execute()
```

### Frontend
En `frontend/src/pages/superadmin/MetricsPage.jsx`:
- Instalar y usar recharts (ya está en package.json)
- Gráfico de barras: reservas por empresa este mes
- Gráfico de línea: costo IA por día este mes
- Cards con: total empresas activas, total reservas mes, 
  costo IA total mes, empresa más activa
- Selector de mes para filtrar

Imports necesarios:
```jsx
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, 
         CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
```

---

## NOTAS PARA CLAUDE CODE

- Mantener colores: naranja #f97316, negro #171717, blanco
- Clases CSS ya definidas en index.css: btn-primary, btn-secondary, 
  btn-danger, card, badge, badge-orange, badge-green, badge-red, 
  badge-gray, input, table, sidebar-link
- El backend usa supabase client con service_role_key 
  (variable: supabase de supabase_client.py)
- Todos los endpoints protegidos usan Depends(require_super_admin)
- Para el SQL del cascade ejecutarlo en Supabase SQL Editor 
  ANTES de implementar el delete en el backend