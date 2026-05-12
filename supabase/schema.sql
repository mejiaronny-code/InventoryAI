-- ============================================================
-- INVENTORYAI - SCHEMA COMPLETO SUPABASE
-- Ejecutar en el SQL Editor de Supabase en este orden
-- ============================================================

-- 1. EXTENSIONES
create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- ============================================================
-- 2. TABLAS BASE
-- ============================================================

-- SUBSCRIPTIONS
create table public.subscriptions (
  id uuid default uuid_generate_v4() primary key,
  plan text not null default 'trial' check (plan in ('trial', 'basic', 'pro', 'enterprise')),
  status text not null default 'trial' check (status in ('active', 'trial', 'suspended', 'cancelled')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  max_products int default 100,
  max_warehouses int default 3,
  max_employees int default 5,
  created_at timestamptz default now()
);

-- COMPANIES
create table public.companies (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  slug text unique,
  logo_url text,
  subscription_id uuid references public.subscriptions(id),
  settings jsonb default '{}',
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- WAREHOUSES
create table public.warehouses (
  id uuid default uuid_generate_v4() primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  location text,
  description text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- CATEGORIES
create table public.categories (
  id uuid default uuid_generate_v4() primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  reservation_time_hours int default 24,
  created_at timestamptz default now()
);

-- PRODUCTS
create table public.products (
  id uuid default uuid_generate_v4() primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  description text,
  use_cases text,
  sku text,
  barcode text,
  price numeric(12,2) default 0,
  unit text default 'unidad',
  images text[] default '{}',
  attributes jsonb default '{}',
  reservation_time_hours int,
  embedding vector(1536),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Índice para búsqueda vectorial
create index on public.products 
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

-- PRODUCT_WAREHOUSE_STOCK
create table public.product_warehouse_stock (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  quantity int not null default 0,
  min_stock_alert int default 5,
  updated_at timestamptz default now(),
  unique(product_id, warehouse_id)
);

-- STOCK_MOVEMENTS
create table public.stock_movements (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  type text not null check (type in ('entrada', 'salida', 'transferencia', 'ajuste')),
  quantity int not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- RESERVATIONS
create table public.reservations (
  id uuid default uuid_generate_v4() primary key,
  company_id uuid not null references public.companies(id),
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  quantity int not null,
  client_name text not null,
  client_email text,
  client_phone text,
  status text not null default 'pending' 
    check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'expired')),
  reservation_code text unique not null,
  expires_at timestamptz not null,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- NOTIFICATIONS
create table public.notifications (
  id uuid default uuid_generate_v4() primary key,
  company_id uuid not null references public.companies(id),
  type text not null check (type in ('new_reservation', 'reservation_expired', 'low_stock', 'stock_out', 'system')),
  message text not null,
  read boolean default false,
  target_role text check (target_role in ('admin', 'employee', 'all')),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- AI_USAGE_LOG
create table public.ai_usage_log (
  id uuid default uuid_generate_v4() primary key,
  company_id uuid references public.companies(id),
  session_id text,
  tokens_input int default 0,
  tokens_output int default 0,
  cost_usd numeric(10,6) default 0,
  model text,
  action text,
  created_at timestamptz default now()
);

-- USER_PROFILES (extensión de auth.users)
create table public.user_profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  company_id uuid references public.companies(id),
  full_name text,
  role text not null default 'employee' check (role in ('super_admin', 'admin', 'employee')),
  is_active boolean default true,
  created_at timestamptz default now()
);

-- ============================================================
-- 3. FUNCIONES HELPER
-- ============================================================

-- Función para obtener company_id del usuario actual
create or replace function public.get_user_company_id()
returns uuid
language sql stable
as $$
  select company_id from public.user_profiles where id = auth.uid();
$$;

-- Función para obtener rol del usuario actual
create or replace function public.get_user_role()
returns text
language sql stable
as $$
  select role from public.user_profiles where id = auth.uid();
$$;

-- ============================================================
-- 4. FUNCIÓN RPC - BÚSQUEDA SEMÁNTICA
-- ============================================================

create or replace function search_products_semantic(
  query_embedding vector(1536),
  company_id_filter uuid,
  match_threshold float default 0.4,
  match_count int default 8
)
returns table (
  id uuid,
  name text,
  description text,
  use_cases text,
  price numeric,
  unit text,
  category_id uuid,
  images text[],
  attributes jsonb,
  similarity float
)
language sql stable
as $$
  select
    p.id,
    p.name,
    p.description,
    p.use_cases,
    p.price,
    p.unit,
    p.category_id,
    p.images,
    p.attributes,
    1 - (p.embedding <=> query_embedding) as similarity
  from products p
  where p.company_id = company_id_filter
    and p.is_active = true
    and p.embedding is not null
    and 1 - (p.embedding <=> query_embedding) > match_threshold
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- 5. FUNCIÓN - STOCK DISPONIBLE (descuenta reservas activas)
-- ============================================================

create or replace function get_available_stock(
  p_product_id uuid,
  p_warehouse_id uuid
)
returns int
language sql stable
as $$
  select 
    coalesce(pws.quantity, 0) - coalesce(
      (select sum(r.quantity) 
       from reservations r 
       where r.product_id = p_product_id 
         and r.warehouse_id = p_warehouse_id
         and r.status in ('pending', 'confirmed')),
      0
    )
  from product_warehouse_stock pws
  where pws.product_id = p_product_id 
    and pws.warehouse_id = p_warehouse_id;
$$;

-- ============================================================
-- 6. FUNCIÓN - GENERAR CÓDIGO DE RESERVA
-- ============================================================

create or replace function generate_reservation_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  code text := '';
  i int;
begin
  for i in 1..8 loop
    code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return 'RES-' || code;
end;
$$;

-- ============================================================
-- 7. TRIGGER - EXPIRAR RESERVAS
-- ============================================================

create or replace function expire_reservations()
returns void
language plpgsql
as $$
begin
  update reservations
  set status = 'expired', updated_at = now()
  where status in ('pending', 'confirmed')
    and expires_at < now();
end;
$$;

-- Trigger para updated_at automático
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_products_updated_at
  before update on products
  for each row execute function update_updated_at();

create trigger trg_reservations_updated_at
  before update on reservations
  for each row execute function update_updated_at();

create trigger trg_companies_updated_at
  before update on companies
  for each row execute function update_updated_at();

-- ============================================================
-- 8. ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Habilitar RLS en todas las tablas
alter table public.companies enable row level security;
alter table public.warehouses enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_warehouse_stock enable row level security;
alter table public.stock_movements enable row level security;
alter table public.reservations enable row level security;
alter table public.notifications enable row level security;
alter table public.ai_usage_log enable row level security;
alter table public.user_profiles enable row level security;
alter table public.subscriptions enable row level security;

-- -----------------------------------------------
-- POLICIES: user_profiles
-- -----------------------------------------------
create policy "Users can view own profile"
  on public.user_profiles for select
  using (id = auth.uid() or get_user_role() = 'super_admin');

create policy "Admins can manage company profiles"
  on public.user_profiles for all
  using (
    get_user_role() = 'super_admin' or
    (get_user_role() = 'admin' and company_id = get_user_company_id())
  );

-- -----------------------------------------------
-- POLICIES: companies
-- -----------------------------------------------
create policy "Public can read companies"
  on public.companies for select
  using (is_active = true);

create policy "Super admin manages companies"
  on public.companies for all
  using (get_user_role() = 'super_admin');

create policy "Admin reads own company"
  on public.companies for select
  using (id = get_user_company_id());

create policy "Admin updates own company"
  on public.companies for update
  using (id = get_user_company_id() and get_user_role() = 'admin');

-- -----------------------------------------------
-- POLICIES: warehouses
-- -----------------------------------------------
create policy "Company staff reads warehouses"
  on public.warehouses for select
  using (company_id = get_user_company_id() or get_user_role() = 'super_admin');

create policy "Public reads warehouses"
  on public.warehouses for select
  using (is_active = true);

create policy "Admin manages warehouses"
  on public.warehouses for all
  using (
    company_id = get_user_company_id() and get_user_role() in ('admin') or
    get_user_role() = 'super_admin'
  );

-- -----------------------------------------------
-- POLICIES: categories
-- -----------------------------------------------
create policy "Public reads categories"
  on public.categories for select
  using (true);

create policy "Admin manages categories"
  on public.categories for all
  using (
    company_id = get_user_company_id() and get_user_role() = 'admin' or
    get_user_role() = 'super_admin'
  );

-- -----------------------------------------------
-- POLICIES: products
-- -----------------------------------------------
create policy "Public reads active products"
  on public.products for select
  using (is_active = true);

create policy "Admin/Employee manages products"
  on public.products for all
  using (
    company_id = get_user_company_id() and get_user_role() in ('admin', 'employee') or
    get_user_role() = 'super_admin'
  );

-- -----------------------------------------------
-- POLICIES: product_warehouse_stock
-- -----------------------------------------------
create policy "Public reads stock"
  on public.product_warehouse_stock for select
  using (true);

create policy "Staff manages stock"
  on public.product_warehouse_stock for all
  using (
    get_user_role() in ('admin', 'employee', 'super_admin')
  );

-- -----------------------------------------------
-- POLICIES: stock_movements
-- -----------------------------------------------
create policy "Staff reads movements"
  on public.stock_movements for select
  using (
    get_user_role() in ('admin', 'employee', 'super_admin')
  );

create policy "Staff creates movements"
  on public.stock_movements for insert
  with check (
    get_user_role() in ('admin', 'employee', 'super_admin')
  );

-- -----------------------------------------------
-- POLICIES: reservations
-- -----------------------------------------------
create policy "Public inserts reservations"
  on public.reservations for insert
  with check (true);

create policy "Public reads own reservation by code"
  on public.reservations for select
  using (true);

create policy "Staff manages reservations"
  on public.reservations for all
  using (
    company_id = get_user_company_id() and get_user_role() in ('admin', 'employee') or
    get_user_role() = 'super_admin'
  );

-- -----------------------------------------------
-- POLICIES: notifications
-- -----------------------------------------------
create policy "Staff reads notifications"
  on public.notifications for select
  using (company_id = get_user_company_id() and get_user_role() in ('admin', 'employee'));

create policy "Admin manages notifications"
  on public.notifications for all
  using (
    company_id = get_user_company_id() and get_user_role() = 'admin' or
    get_user_role() = 'super_admin'
  );

-- -----------------------------------------------
-- POLICIES: ai_usage_log
-- -----------------------------------------------
create policy "Public inserts usage"
  on public.ai_usage_log for insert
  with check (true);

create policy "Admin reads usage"
  on public.ai_usage_log for select
  using (
    company_id = get_user_company_id() and get_user_role() = 'admin' or
    get_user_role() = 'super_admin'
  );

-- -----------------------------------------------
-- POLICIES: subscriptions
-- -----------------------------------------------
create policy "Super admin manages subscriptions"
  on public.subscriptions for all
  using (get_user_role() = 'super_admin');

create policy "Admin reads own subscription"
  on public.subscriptions for select
  using (
    id = (select subscription_id from companies where id = get_user_company_id())
  );

-- ============================================================
-- 9. DATOS INICIALES (Super Admin + empresa demo)
-- ============================================================

-- Nota: El super admin se crea via Supabase Auth Dashboard
-- Luego ejecutar esto con el UUID real del usuario creado:
-- insert into public.user_profiles (id, role, full_name)
-- values ('UUID-DEL-SUPER-ADMIN', 'super_admin', 'Super Admin');

-- Empresa demo
insert into public.subscriptions (plan, status, ends_at)
values ('pro', 'active', now() + interval '1 year')
returning id;

-- (Reemplaza el subscription_id con el retornado arriba)
insert into public.companies (name, slug, settings)
values (
  'Demo Company',
  'demo',
  '{"primary_color": "#F97316", "chat_welcome": "Hola! ¿En qué puedo ayudarte?"}'
);
