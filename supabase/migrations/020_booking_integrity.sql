-- ============================================================
-- 020_booking_integrity.sql
-- Reserva de mesa/preorden y transición de estado transaccionales.
--
-- Ejecutar MANUALMENTE después de 019_inventory_integrity.sql.
-- ============================================================

alter table public.restaurant_tables
  drop constraint if exists restaurant_tables_capacity_positive,
  add constraint restaurant_tables_capacity_positive check (capacity > 0);

alter table public.bookings
  drop constraint if exists bookings_service_type_valid,
  add constraint bookings_service_type_valid check (service_type in ('dine_in', 'pickup')),
  drop constraint if exists bookings_party_size_positive,
  add constraint bookings_party_size_positive check (party_size is null or party_size > 0);

alter table public.booking_items
  drop constraint if exists booking_items_quantity_positive,
  add constraint booking_items_quantity_positive check (quantity > 0);

create index if not exists idx_bookings_table_active_time
  on public.bookings (company_id, table_id, reserved_at)
  where status in ('pending', 'confirmed', 'preparing', 'ready', 'seated');


create or replace function public.create_booking_with_items(
  p_company_id uuid,
  p_code text,
  p_service_type text,
  p_party_size integer,
  p_reserved_at timestamptz,
  p_zone text,
  p_table_id uuid,
  p_client_name text,
  p_client_email text,
  p_client_phone text,
  p_notes text,
  p_items jsonb
) returns table (booking_id uuid, code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_capacity integer;
  v_duration integer;
  v_item jsonb;
  v_dish_id uuid;
  v_quantity integer;
  v_price numeric;
begin
  if p_service_type not in ('dine_in', 'pickup') then
    raise exception 'INVALID_SERVICE_TYPE';
  end if;
  if p_service_type = 'dine_in' and coalesce(p_party_size, 0) <= 0 then
    raise exception 'INVALID_PARTY_SIZE';
  end if;

  if p_table_id is not null then
    select capacity into v_capacity
      from public.restaurant_tables
     where id = p_table_id
       and company_id = p_company_id
       and is_active = true
     for update;
    if v_capacity is null then
      raise exception 'TABLE_NOT_FOUND';
    end if;
    if p_party_size is not null and p_party_size > v_capacity then
      raise exception 'TABLE_CAPACITY:%', v_capacity;
    end if;

    select coalesce((settings->>'booking_duration_minutes')::integer, 90)
      into v_duration
      from public.companies
     where id = p_company_id;
    v_duration := greatest(coalesce(v_duration, 90), 15);

    if exists (
      select 1 from public.bookings
       where company_id = p_company_id
         and table_id = p_table_id
         and status in ('pending', 'confirmed', 'preparing', 'ready', 'seated')
         and reserved_at > p_reserved_at - make_interval(mins => v_duration)
         and reserved_at < p_reserved_at + make_interval(mins => v_duration)
    ) then
      raise exception 'TABLE_TIME_CONFLICT';
    end if;
  end if;

  -- Validar toda la preorden ANTES de insertar la cabecera.
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_dish_id := (v_item->>'dish_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity <= 0 then
      raise exception 'INVALID_ITEM_QUANTITY';
    end if;
    select price into v_price
      from public.products
     where id = v_dish_id
       and company_id = p_company_id
       and product_type = 'dish'
       and is_active = true
       and is_available = true;
    if not found then
      raise exception 'DISH_NOT_AVAILABLE:%', v_dish_id;
    end if;
  end loop;

  insert into public.bookings (
    company_id, code, service_type, party_size, reserved_at, zone, table_id,
    client_name, client_email, client_phone, status, notes
  ) values (
    p_company_id, p_code, p_service_type,
    case when p_service_type = 'dine_in' then p_party_size else null end,
    p_reserved_at, p_zone, p_table_id, p_client_name, p_client_email,
    p_client_phone, 'pending', p_notes
  )
  returning id into v_booking_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_dish_id := (v_item->>'dish_id')::uuid;
    v_quantity := (v_item->>'quantity')::integer;
    select price into v_price
      from public.products
     where id = v_dish_id and company_id = p_company_id;

    insert into public.booking_items (
      booking_id, dish_id, quantity, modifiers, unit_price
    ) values (
      v_booking_id, v_dish_id, v_quantity,
      coalesce(v_item->'modifiers', '{}'::jsonb), v_price
    );
  end loop;

  return query select v_booking_id, p_code;
end;
$$;


create or replace function public.transition_booking(
  p_company_id uuid,
  p_booking_id uuid,
  p_new_status text,
  p_table_id uuid,
  p_notes text,
  p_created_by uuid
) returns setof public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings%rowtype;
  v_target_status text;
  v_target_table uuid;
  v_capacity integer;
  v_duration integer;
  v_item record;
  v_recipe record;
  v_stock record;
  v_needed integer;
  v_deducted integer;
begin
  select * into v_booking
    from public.bookings
   where id = p_booking_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  v_target_status := coalesce(p_new_status, v_booking.status);
  v_target_table := coalesce(p_table_id, v_booking.table_id);
  if v_target_status <> v_booking.status and not (
    (v_booking.status = 'pending' and v_target_status in ('confirmed', 'cancelled', 'no_show'))
    or
    (v_booking.status = 'confirmed' and v_target_status in ('preparing', 'seated', 'cancelled', 'no_show'))
    or
    (v_booking.status = 'preparing' and v_target_status in ('ready', 'cancelled'))
    or
    (v_booking.status in ('ready', 'seated') and v_target_status in ('completed', 'cancelled', 'no_show'))
  ) then
    raise exception 'INVALID_BOOKING_TRANSITION:%->%', v_booking.status, v_target_status;
  end if;

  if v_target_table is not null then
    select capacity into v_capacity
      from public.restaurant_tables
     where id = v_target_table
       and company_id = p_company_id
       and is_active = true
     for update;
    if v_capacity is null then
      raise exception 'TABLE_NOT_FOUND';
    end if;
    if v_booking.party_size is not null and v_booking.party_size > v_capacity then
      raise exception 'TABLE_CAPACITY:%', v_capacity;
    end if;

    select coalesce((settings->>'booking_duration_minutes')::integer, 90)
      into v_duration
      from public.companies
     where id = p_company_id;
    v_duration := greatest(coalesce(v_duration, 90), 15);

    if exists (
      select 1 from public.bookings
       where company_id = p_company_id
         and table_id = v_target_table
         and id <> p_booking_id
         and status in ('pending', 'confirmed', 'preparing', 'ready', 'seated')
         and reserved_at > v_booking.reserved_at - make_interval(mins => v_duration)
         and reserved_at < v_booking.reserved_at + make_interval(mins => v_duration)
    ) then
      raise exception 'TABLE_TIME_CONFLICT';
    end if;
  end if;

  if v_target_status = 'completed' and v_booking.status <> 'completed' then
    for v_item in
      select bi.dish_id, bi.quantity, p.name
        from public.booking_items bi
        join public.products p on p.id = bi.dish_id and p.company_id = p_company_id
       where bi.booking_id = p_booking_id
    loop
      for v_recipe in
        select ingredient_id, quantity
          from public.recipes
         where company_id = p_company_id and dish_id = v_item.dish_id
      loop
        v_needed := round(v_recipe.quantity * v_item.quantity);
        if v_needed <= 0 then
          continue;
        end if;

        select pws.product_id, pws.warehouse_id, pws.quantity, pws.min_stock_alert
          into v_stock
          from public.product_warehouse_stock pws
          join public.products ingredient
            on ingredient.id = pws.product_id
           and ingredient.company_id = p_company_id
         where pws.product_id = v_recipe.ingredient_id
         order by pws.quantity desc
         limit 1
         for update of pws;

        if found then
          v_deducted := least(v_stock.quantity, v_needed);
          if v_deducted > 0 then
            update public.product_warehouse_stock
               set quantity = quantity - v_deducted, updated_at = now()
             where product_id = v_stock.product_id
               and warehouse_id = v_stock.warehouse_id;
            insert into public.stock_movements (
              product_id, warehouse_id, type, quantity, notes, created_by
            ) values (
              v_stock.product_id, v_stock.warehouse_id, 'salida', v_deducted,
              'Reserva completada: ' || v_item.quantity || '× ' || v_item.name,
              p_created_by
            );
          end if;
        end if;
      end loop;
    end loop;
  end if;

  update public.bookings
     set status = v_target_status,
         table_id = coalesce(p_table_id, table_id),
         notes = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_booking_id;

  return query select * from public.bookings where id = p_booking_id;
end;
$$;

revoke execute on function public.create_booking_with_items(
  uuid, text, text, integer, timestamptz, text, uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
revoke execute on function public.transition_booking(uuid, uuid, text, uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.create_booking_with_items(
  uuid, text, text, integer, timestamptz, text, uuid, text, text, text, text, jsonb
) to service_role;
grant execute on function public.transition_booking(uuid, uuid, text, uuid, text, uuid)
  to service_role;
