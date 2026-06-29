-- ============================================================
-- 008_restaurant_bookings.sql  (Sector Restaurantes — Fase R3)
-- Reservas de mesa + pre-orden de platillos.
--
-- restaurant_tables: mesas/zonas del restaurante (opcional — hay
--   restaurantes solo de para-llevar).
-- bookings: una reserva. Puede ser comer ahí (dine_in, con # personas
--   y opcionalmente mesa/zona) o para recoger (pickup).
-- booking_items: platillos pre-ordenados de una reserva.
-- ============================================================

create table if not exists restaurant_tables (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,            -- "Mesa 1", "Terraza A"
  capacity    int  not null default 2,
  zone        text,                     -- "Terraza", "Interior", "Barra"
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_tables_company on restaurant_tables (company_id);

create table if not exists bookings (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  code          text not null unique,
  service_type  text not null default 'dine_in',   -- 'dine_in' | 'pickup'
  party_size    int,                                -- null para pickup
  reserved_at   timestamptz not null,               -- fecha/hora de la reserva
  zone          text,
  table_id      uuid references restaurant_tables(id) on delete set null,
  client_name   text not null,
  client_email  text,
  client_phone  text,
  status        text not null default 'pending',    -- pending|confirmed|seated|ready|completed|cancelled|no_show
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_bookings_company_date on bookings (company_id, reserved_at);

create table if not exists booking_items (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id) on delete cascade,
  dish_id     uuid not null references products(id) on delete cascade,
  quantity    int  not null default 1,
  modifiers   jsonb default '{}'::jsonb,
  unit_price  numeric,
  created_at  timestamptz not null default now()
);
create index if not exists idx_booking_items_booking on booking_items (booking_id);
