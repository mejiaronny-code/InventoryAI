-- ============================================================
-- 009_restaurant_rls_policies.sql  (Sector Restaurantes — fix RLS)
-- Las tablas nuevas (recipes, restaurant_tables, bookings, booking_items)
-- quedaron con RLS habilitado pero SIN políticas, lo que bloquea todo.
-- Aquí se replica el mismo patrón de políticas que las tablas existentes
-- (ver schema.sql): staff gestiona lo de su empresa, super_admin todo, y
-- los endpoints públicos (reservas/pedidos) pueden insertar/leer.
--
-- Re-ejecutable: hace DROP IF EXISTS antes de cada CREATE.
-- ============================================================

-- Asegurar RLS habilitado (idempotente)
alter table public.recipes            enable row level security;
alter table public.restaurant_tables  enable row level security;
alter table public.bookings           enable row level security;
alter table public.booking_items      enable row level security;

-- ---------------------------------------------------------
-- recipes  (solo staff — los insumos/recetas no son públicos)
-- ---------------------------------------------------------
drop policy if exists "Staff manages recipes" on public.recipes;
create policy "Staff manages recipes"
  on public.recipes for all
  using (
    company_id = get_user_company_id() and get_user_role() in ('admin', 'employee') or
    get_user_role() = 'super_admin'
  );

-- ---------------------------------------------------------
-- restaurant_tables  (lectura pública para el flujo de reserva)
-- ---------------------------------------------------------
drop policy if exists "Public reads tables" on public.restaurant_tables;
create policy "Public reads tables"
  on public.restaurant_tables for select
  using (true);

drop policy if exists "Staff manages tables" on public.restaurant_tables;
create policy "Staff manages tables"
  on public.restaurant_tables for all
  using (
    company_id = get_user_company_id() and get_user_role() in ('admin', 'employee') or
    get_user_role() = 'super_admin'
  );

-- ---------------------------------------------------------
-- bookings  (el cliente público crea y consulta por código)
-- ---------------------------------------------------------
drop policy if exists "Public inserts bookings" on public.bookings;
create policy "Public inserts bookings"
  on public.bookings for insert
  with check (true);

drop policy if exists "Public reads bookings" on public.bookings;
create policy "Public reads bookings"
  on public.bookings for select
  using (true);

drop policy if exists "Staff manages bookings" on public.bookings;
create policy "Staff manages bookings"
  on public.bookings for all
  using (
    company_id = get_user_company_id() and get_user_role() in ('admin', 'employee') or
    get_user_role() = 'super_admin'
  );

-- ---------------------------------------------------------
-- booking_items  (pre-orden; sin company_id propio → por rol)
-- ---------------------------------------------------------
drop policy if exists "Public inserts booking_items" on public.booking_items;
create policy "Public inserts booking_items"
  on public.booking_items for insert
  with check (true);

drop policy if exists "Public reads booking_items" on public.booking_items;
create policy "Public reads booking_items"
  on public.booking_items for select
  using (true);

drop policy if exists "Staff manages booking_items" on public.booking_items;
create policy "Staff manages booking_items"
  on public.booking_items for all
  using (
    get_user_role() in ('admin', 'employee', 'super_admin')
  );
