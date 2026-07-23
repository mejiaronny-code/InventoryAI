-- ============================================================
-- 016_rls_hardening.sql
-- Cierra el acceso anónimo directo a Supabase (PostgREST) que hoy permiten
-- varias policies `USING (true)` / `WITH CHECK (true)`. El frontend embarca
-- la anon key en el bundle (VITE_SUPABASE_ANON_KEY) — cualquiera puede
-- extraerla y consultar/mutar estas tablas saltándose el backend (que sí
-- filtra por company_id en Python, pero eso no protege contra acceso
-- directo). El backend usa la service_role key y bypasea RLS por completo,
-- así que ESTA migración NO afecta ningún endpoint del backend — solo
-- cierra la puerta trasera anónima.
--
-- IMPORTANTE: el hook `useRealtimeInserts.js` ahora autentica el canal
-- Realtime con el JWT del usuario logueado (supabase.realtime.setAuth),
-- por eso las policies de SELECT para staff quedan abiertas a rol
-- autenticado + company propia, no completamente cerradas.
--
-- Re-ejecutable: DROP IF EXISTS antes de cada CREATE.
-- ============================================================

-- -----------------------------------------------
-- product_warehouse_stock (no tiene company_id propio -> join a products)
-- -----------------------------------------------
drop policy if exists "Public reads stock" on public.product_warehouse_stock;
-- Sin reemplazo público: el catálogo lee stock vía backend (service_role), no directo.

drop policy if exists "Staff manages stock" on public.product_warehouse_stock;
create policy "Staff manages stock"
  on public.product_warehouse_stock for all
  using (
    get_user_role() = 'super_admin' or
    (get_user_role() in ('admin', 'employee') and exists (
      select 1 from public.products p
      where p.id = product_warehouse_stock.product_id
        and p.company_id = get_user_company_id()
    ))
  );

-- -----------------------------------------------
-- reservations
-- -----------------------------------------------
drop policy if exists "Public reads own reservation by code" on public.reservations;
drop policy if exists "Public inserts reservations" on public.reservations;
-- Las reservas públicas se crean/leen vía backend (service_role). Solo
-- staff de la propia empresa puede leer directo (necesario para Realtime
-- autenticado en ReservationsPage.jsx).
drop policy if exists "Staff reads reservations" on public.reservations;
create policy "Staff reads reservations"
  on public.reservations for select
  using (
    company_id = get_user_company_id()
    and get_user_role() in ('admin', 'employee', 'super_admin')
  );

-- "Staff manages reservations" (schema.sql) ya cubre INSERT/UPDATE/DELETE
-- para admin/employee/super_admin scoped por company — se deja intacta.

-- -----------------------------------------------
-- restaurant_tables
-- -----------------------------------------------
drop policy if exists "Public reads tables" on public.restaurant_tables;
-- El flujo público de reserva de mesa consulta mesas vía backend, no directo.

-- -----------------------------------------------
-- bookings
-- -----------------------------------------------
drop policy if exists "Public inserts bookings" on public.bookings;
drop policy if exists "Public reads bookings" on public.bookings;
-- Las reservas de mesa públicas se crean/consultan por código vía backend
-- (service_role). "Staff manages bookings" (009) ya cubre lectura/escritura
-- de staff scoped por company y no necesita reemplazo adicional aquí.

-- -----------------------------------------------
-- booking_items (sin company_id propio -> join a bookings)
-- -----------------------------------------------
drop policy if exists "Public inserts booking_items" on public.booking_items;
drop policy if exists "Public reads booking_items" on public.booking_items;
drop policy if exists "Staff manages booking_items" on public.booking_items;
create policy "Staff manages booking_items"
  on public.booking_items for all
  using (
    get_user_role() = 'super_admin' or
    (get_user_role() in ('admin', 'employee') and exists (
      select 1 from public.bookings b
      where b.id = booking_items.booking_id
        and b.company_id = get_user_company_id()
    ))
  );

-- -----------------------------------------------
-- company_documents / company_document_chunks (base de conocimiento IA)
-- -----------------------------------------------
drop policy if exists "company_documents_isolation" on public.company_documents;
drop policy if exists "Staff manages documents" on public.company_documents;
create policy "Staff manages documents"
  on public.company_documents for all
  using (
    company_id = get_user_company_id() and get_user_role() in ('admin', 'employee') or
    get_user_role() = 'super_admin'
  );

drop policy if exists "company_document_chunks_isolation" on public.company_document_chunks;
drop policy if exists "Staff manages document chunks" on public.company_document_chunks;
create policy "Staff manages document chunks"
  on public.company_document_chunks for all
  using (
    company_id = get_user_company_id() and get_user_role() in ('admin', 'employee') or
    get_user_role() = 'super_admin'
  );

-- -----------------------------------------------
-- ai_usage_log
-- -----------------------------------------------
drop policy if exists "Public inserts usage" on public.ai_usage_log;
-- El log de uso IA lo escribe el backend (service_role); no necesita INSERT público.

-- -----------------------------------------------
-- El catálogo público usa FastAPI, no PostgREST directo.
-- Cerrar también estas policies evita filtrar cost_price, settings internos,
-- productos/categorías de tenants que deshabilitaron su catálogo y ubicaciones
-- de almacén al reutilizar accidentalmente la anon key.
-- -----------------------------------------------
drop policy if exists "Public can read companies" on public.companies;
drop policy if exists "Public reads warehouses" on public.warehouses;
drop policy if exists "Public reads categories" on public.categories;
drop policy if exists "Public reads active products" on public.products;

-- -----------------------------------------------
-- Privilegios de tabla: defensa estructural.
--
-- RLS decide QUÉ filas puede leer un rol, pero no evita que una policy de
-- UPDATE demasiado amplia permita cambiar columnas sensibles (por ejemplo
-- role/company_id/settings). El frontend solo necesita SELECT directo para
-- tres canales Realtime; todo lo demás pasa por FastAPI/service_role.
-- -----------------------------------------------
do $$
declare
  table_row record;
begin
  for table_row in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format(
      'revoke all privileges on table public.%I from anon, authenticated',
      table_row.tablename
    );
  end loop;
end
$$;

alter default privileges in schema public
  revoke all privileges on tables from anon, authenticated;

grant all privileges on all tables in schema public to service_role;
grant select on public.notifications, public.reservations, public.bookings
  to authenticated;

-- Los RPC de mutación son implementación interna del backend. Aunque RLS
-- también los limita, no deben formar parte de la superficie pública.
revoke execute on function public.decrement_stock_strict(uuid, uuid, numeric)
  from public, anon, authenticated;
revoke execute on function public.decrement_stock_clamped(uuid, uuid, numeric)
  from public, anon, authenticated;

-- expire_reservations existe con firmas distintas según si 015 ya se corrió
-- (uuid) o no (sin argumentos) — se revoca/otorga la que exista en cada caso.
do $$
begin
  if to_regprocedure('public.expire_reservations(uuid)') is not null then
    revoke execute on function public.expire_reservations(uuid) from public, anon, authenticated;
    grant execute on function public.expire_reservations(uuid) to service_role;
  end if;
  if to_regprocedure('public.expire_reservations()') is not null then
    revoke execute on function public.expire_reservations() from public, anon, authenticated;
    grant execute on function public.expire_reservations() to service_role;
  end if;
end
$$;

grant execute on function public.decrement_stock_strict(uuid, uuid, numeric)
  to service_role;
grant execute on function public.decrement_stock_clamped(uuid, uuid, numeric)
  to service_role;
