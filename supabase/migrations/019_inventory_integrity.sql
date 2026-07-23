-- ============================================================
-- 019_inventory_integrity.sql
-- Integridad transaccional para inventario y reservas.
--
-- Ejecutar MANUALMENTE después de 016, 017 y 018.
-- El backend usa service_role; las funciones se revocan de anon/authenticated
-- para que nadie pueda invocarlas directamente con la anon key del frontend.
-- ============================================================

-- Columnas que el backend ya usa y que no estaban documentadas en schema.sql.
alter table public.stock_movements
  add column if not exists to_warehouse_id uuid references public.warehouses(id),
  add column if not exists expires_at timestamptz;

-- Estas tablas existen en producción pero faltaban en el historial SQL del
-- repositorio. CREATE IF NOT EXISTS hace la migración reproducible desde cero
-- sin alterar las instalaciones donde ya están creadas.
create table if not exists public.product_batches (
  id uuid default uuid_generate_v4() primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  batch_code text not null,
  quantity integer not null default 0,
  initial_quantity integer not null default 0,
  expires_at timestamptz,
  received_at timestamptz default now(),
  notes text,
  created_at timestamptz default now()
);

create unique index if not exists uq_product_batches_company_code
  on public.product_batches (company_id, batch_code);

create table if not exists public.product_variants_stock (
  id uuid default uuid_generate_v4() primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  combination jsonb not null default '{}'::jsonb,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz default now()
);

create unique index if not exists uq_product_variants_stock_combination
  on public.product_variants_stock (product_id, warehouse_id, combination);

alter table public.product_batches enable row level security;
alter table public.product_variants_stock enable row level security;
revoke all privileges on public.product_batches, public.product_variants_stock
  from anon, authenticated;
grant all privileges on public.product_batches, public.product_variants_stock
  to service_role;

-- Rechazar estados imposibles incluso si una futura ruta olvida validarlos.
alter table public.product_warehouse_stock
  drop constraint if exists product_warehouse_stock_quantity_nonnegative,
  add constraint product_warehouse_stock_quantity_nonnegative check (quantity >= 0);

alter table public.stock_movements
  drop constraint if exists stock_movements_quantity_nonnegative,
  add constraint stock_movements_quantity_nonnegative check (quantity >= 0);

alter table public.reservations
  drop constraint if exists reservations_quantity_positive,
  add constraint reservations_quantity_positive check (quantity > 0);

-- Índices para las dos consultas calientes de disponibilidad y operación.
create index if not exists idx_reservations_active_stock
  on public.reservations (company_id, product_id, warehouse_id, expires_at)
  where status in ('pending', 'confirmed');

create index if not exists idx_reservations_company_created
  on public.reservations (company_id, created_at desc);

create index if not exists idx_stock_movements_product_created
  on public.stock_movements (product_id, created_at desc);


-- ------------------------------------------------------------
-- Movimiento + cambio de stock + lote: una sola transacción.
-- ------------------------------------------------------------
create or replace function public.record_stock_movement(
  p_company_id uuid,
  p_product_id uuid,
  p_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_type text,
  p_quantity integer,
  p_notes text,
  p_created_by uuid,
  p_expires_at timestamptz default null,
  p_batch_code text default null
) returns table (
  movement_id uuid,
  new_quantity integer,
  destination_quantity integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new integer;
  v_destination integer;
  v_movement_id uuid;
begin
  if p_type not in ('entrada', 'salida', 'transferencia', 'ajuste') then
    raise exception 'INVALID_MOVEMENT_TYPE';
  end if;
  if p_quantity < 0 or (p_type <> 'ajuste' and p_quantity = 0) then
    raise exception 'INVALID_QUANTITY';
  end if;
  if p_type = 'salida' and nullif(btrim(coalesce(p_notes, '')), '') is null then
    raise exception 'NOTES_REQUIRED';
  end if;

  if not exists (
    select 1 from public.products
    where id = p_product_id and company_id = p_company_id
  ) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.warehouses
    where id = p_warehouse_id and company_id = p_company_id
  ) then
    raise exception 'WAREHOUSE_NOT_FOUND';
  end if;

  if p_type = 'entrada' then
    insert into public.product_warehouse_stock (product_id, warehouse_id, quantity)
    values (p_product_id, p_warehouse_id, p_quantity)
    on conflict (product_id, warehouse_id)
    do update set
      quantity = public.product_warehouse_stock.quantity + excluded.quantity,
      updated_at = now()
    returning quantity into v_new;

  elsif p_type = 'salida' then
    update public.product_warehouse_stock
       set quantity = quantity - p_quantity, updated_at = now()
     where product_id = p_product_id
       and warehouse_id = p_warehouse_id
       and quantity >= p_quantity
    returning quantity into v_new;
    if v_new is null then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

  elsif p_type = 'ajuste' then
    insert into public.product_warehouse_stock (product_id, warehouse_id, quantity)
    values (p_product_id, p_warehouse_id, p_quantity)
    on conflict (product_id, warehouse_id)
    do update set quantity = excluded.quantity, updated_at = now()
    returning quantity into v_new;

  else
    if p_to_warehouse_id is null or p_to_warehouse_id = p_warehouse_id then
      raise exception 'INVALID_DESTINATION';
    end if;
    if not exists (
      select 1 from public.warehouses
      where id = p_to_warehouse_id and company_id = p_company_id
    ) then
      raise exception 'DESTINATION_NOT_FOUND';
    end if;

    update public.product_warehouse_stock
       set quantity = quantity - p_quantity, updated_at = now()
     where product_id = p_product_id
       and warehouse_id = p_warehouse_id
       and quantity >= p_quantity
    returning quantity into v_new;
    if v_new is null then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

    insert into public.product_warehouse_stock (product_id, warehouse_id, quantity)
    values (p_product_id, p_to_warehouse_id, p_quantity)
    on conflict (product_id, warehouse_id)
    do update set
      quantity = public.product_warehouse_stock.quantity + excluded.quantity,
      updated_at = now()
    returning quantity into v_destination;
  end if;

  insert into public.stock_movements (
    product_id, warehouse_id, to_warehouse_id, type, quantity,
    notes, created_by, expires_at
  ) values (
    p_product_id, p_warehouse_id, p_to_warehouse_id, p_type, p_quantity,
    p_notes, p_created_by, p_expires_at
  )
  returning id into v_movement_id;

  if p_type = 'entrada' and p_batch_code is not null then
    insert into public.product_batches (
      company_id, product_id, warehouse_id, batch_code, quantity,
      initial_quantity, expires_at, notes
    ) values (
      p_company_id, p_product_id, p_warehouse_id, p_batch_code, p_quantity,
      p_quantity, p_expires_at, p_notes
    );
  end if;

  if p_type = 'entrada' and p_expires_at is not null then
    update public.product_warehouse_stock
       set nearest_expiry = least(coalesce(nearest_expiry, p_expires_at), p_expires_at)
     where product_id = p_product_id and warehouse_id = p_warehouse_id;
  end if;

  return query select v_movement_id, v_new, v_destination;
end;
$$;


-- ------------------------------------------------------------
-- Ajuste directo + umbral + auditoría: una sola transacción.
-- ------------------------------------------------------------
create or replace function public.set_stock_with_audit(
  p_company_id uuid,
  p_product_id uuid,
  p_warehouse_id uuid,
  p_quantity integer,
  p_min_stock_alert integer,
  p_notes text,
  p_created_by uuid
) returns table (new_quantity integer, movement_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old integer;
  v_movement_id uuid;
begin
  if p_quantity < 0 or p_min_stock_alert < 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if not exists (
    select 1 from public.products
    where id = p_product_id and company_id = p_company_id
  ) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.warehouses
    where id = p_warehouse_id and company_id = p_company_id
  ) then
    raise exception 'WAREHOUSE_NOT_FOUND';
  end if;

  select quantity into v_old
    from public.product_warehouse_stock
   where product_id = p_product_id and warehouse_id = p_warehouse_id
   for update;

  insert into public.product_warehouse_stock (
    product_id, warehouse_id, quantity, min_stock_alert
  ) values (
    p_product_id, p_warehouse_id, p_quantity, p_min_stock_alert
  )
  on conflict (product_id, warehouse_id)
  do update set
    quantity = excluded.quantity,
    min_stock_alert = excluded.min_stock_alert,
    updated_at = now();

  if v_old is distinct from p_quantity then
    insert into public.stock_movements (
      product_id, warehouse_id, type, quantity, notes, created_by
    ) values (
      p_product_id, p_warehouse_id, 'ajuste', p_quantity,
      coalesce(nullif(btrim(p_notes), ''), 'Ajuste manual de stock'),
      p_created_by
    )
    returning id into v_movement_id;
  end if;

  return query select p_quantity, v_movement_id;
end;
$$;


-- ------------------------------------------------------------
-- Creación pública sin sobre-reserva (lock por SKU + almacén).
-- ------------------------------------------------------------
create or replace function public.create_reservation_if_available(
  p_company_id uuid,
  p_product_id uuid,
  p_warehouse_id uuid,
  p_quantity integer,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_notes text,
  p_reservation_code text,
  p_expires_at timestamptz
) returns table (reservation_id uuid, available_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stock integer;
  v_reserved bigint;
  v_available integer;
  v_max integer;
  v_reservation_id uuid;
begin
  if p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if not exists (
    select 1 from public.products
    where id = p_product_id and company_id = p_company_id and is_active = true
  ) then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  if not exists (
    select 1 from public.warehouses
    where id = p_warehouse_id and company_id = p_company_id and is_active = true
  ) then
    raise exception 'WAREHOUSE_NOT_FOUND';
  end if;

  select pws.quantity into v_stock
    from public.product_warehouse_stock pws
   where pws.product_id = p_product_id
     and pws.warehouse_id = p_warehouse_id
   for update;
  if v_stock is null then
    raise exception 'INSUFFICIENT_AVAILABLE_STOCK:0';
  end if;

  select c.max_reservation_qty into v_max
    from public.products p
    left join public.categories c on c.id = p.category_id
   where p.id = p_product_id and p.company_id = p_company_id;
  if v_max is not null and p_quantity > v_max then
    raise exception 'MAX_RESERVATION_QTY:%', v_max;
  end if;

  select coalesce(sum(r.quantity), 0) into v_reserved
    from public.reservations r
   where r.company_id = p_company_id
     and r.product_id = p_product_id
     and r.warehouse_id = p_warehouse_id
     and r.status in ('pending', 'confirmed')
     and r.expires_at > now();

  v_available := greatest(v_stock - v_reserved, 0);
  if v_available < p_quantity then
    raise exception 'INSUFFICIENT_AVAILABLE_STOCK:%', v_available;
  end if;

  insert into public.reservations (
    company_id, product_id, warehouse_id, quantity, client_name,
    client_email, client_phone, notes, status, reservation_code, expires_at
  ) values (
    p_company_id, p_product_id, p_warehouse_id, p_quantity, p_client_name,
    p_client_email, p_client_phone, p_notes, 'pending', p_reservation_code, p_expires_at
  )
  returning id into v_reservation_id;

  return query select v_reservation_id, v_available - p_quantity;
end;
$$;


-- ------------------------------------------------------------
-- Cambio de estado + descuento + auditoría: una sola transacción.
-- ------------------------------------------------------------
create or replace function public.transition_reservation(
  p_company_id uuid,
  p_reservation_id uuid,
  p_new_status text,
  p_notes text,
  p_created_by uuid,
  p_variant_combination jsonb default null
) returns setof public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations%rowtype;
  v_new_stock integer;
begin
  select * into v_res
    from public.reservations
   where id = p_reservation_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;

  if p_new_status = v_res.status then
    return query select * from public.reservations where id = p_reservation_id;
    return;
  end if;

  if not (
    (v_res.status = 'pending' and p_new_status in ('confirmed', 'cancelled', 'expired'))
    or
    (v_res.status = 'confirmed' and p_new_status in ('completed', 'cancelled', 'expired'))
  ) then
    raise exception 'INVALID_STATUS_TRANSITION:%->%', v_res.status, p_new_status;
  end if;

  if p_new_status = 'completed' then
    update public.product_warehouse_stock
       set quantity = quantity - v_res.quantity, updated_at = now()
     where product_id = v_res.product_id
       and warehouse_id = v_res.warehouse_id
       and quantity >= v_res.quantity
    returning quantity into v_new_stock;
    if v_new_stock is null then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

    insert into public.stock_movements (
      product_id, warehouse_id, type, quantity, notes, created_by
    ) values (
      v_res.product_id, v_res.warehouse_id, 'salida', v_res.quantity,
      'Reserva completada' ||
        case when coalesce(p_notes, v_res.notes) is not null
          then ' · ' || coalesce(p_notes, v_res.notes) else '' end,
      p_created_by
    );

    if p_variant_combination is not null and p_variant_combination <> '{}'::jsonb then
      update public.product_variants_stock
         set quantity = greatest(quantity - v_res.quantity, 0)
       where id = (
         select id from public.product_variants_stock
          where product_id = v_res.product_id
            and warehouse_id = v_res.warehouse_id
            and combination = p_variant_combination
          limit 1
       );
    end if;
  end if;

  update public.reservations
     set status = p_new_status,
         notes = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_reservation_id;

  return query select * from public.reservations where id = p_reservation_id;
end;
$$;


revoke execute on function public.record_stock_movement(
  uuid, uuid, uuid, uuid, text, integer, text, uuid, timestamptz, text
) from public, anon, authenticated;
revoke execute on function public.set_stock_with_audit(
  uuid, uuid, uuid, integer, integer, text, uuid
) from public, anon, authenticated;
revoke execute on function public.create_reservation_if_available(
  uuid, uuid, uuid, integer, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke execute on function public.transition_reservation(
  uuid, uuid, text, text, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.record_stock_movement(
  uuid, uuid, uuid, uuid, text, integer, text, uuid, timestamptz, text
) to service_role;
grant execute on function public.set_stock_with_audit(
  uuid, uuid, uuid, integer, integer, text, uuid
) to service_role;
grant execute on function public.create_reservation_if_available(
  uuid, uuid, uuid, integer, text, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.transition_reservation(
  uuid, uuid, text, text, uuid, jsonb
) to service_role;
