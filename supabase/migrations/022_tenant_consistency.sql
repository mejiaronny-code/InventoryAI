-- ============================================================
-- 022_tenant_consistency.sql
-- Defensa en profundidad multi-tenant para relaciones sin company_id
-- o con varios recursos que deben pertenecer a la misma empresa.
--
-- Ejecutar MANUALMENTE después de 021_operational_integrity.sql.
-- ============================================================

create or replace function public.enforce_tenant_consistency()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_company uuid;
  v_other_company uuid;
begin
  if tg_table_name = 'product_warehouse_stock' then
    select company_id into v_company from public.products where id = new.product_id;
    select company_id into v_other_company from public.warehouses where id = new.warehouse_id;
    if v_company is null or v_other_company is null or v_company <> v_other_company then
      raise exception 'TENANT_MISMATCH:product_warehouse_stock';
    end if;

  elsif tg_table_name = 'stock_movements' then
    select company_id into v_company from public.products where id = new.product_id;
    select company_id into v_other_company from public.warehouses where id = new.warehouse_id;
    if v_company is null or v_other_company is null or v_company <> v_other_company then
      raise exception 'TENANT_MISMATCH:stock_movements';
    end if;
    if new.to_warehouse_id is not null and not exists (
      select 1 from public.warehouses
       where id = new.to_warehouse_id and company_id = v_company
    ) then
      raise exception 'TENANT_MISMATCH:stock_movements_destination';
    end if;

  elsif tg_table_name = 'product_variants_stock' then
    select company_id into v_company from public.products where id = new.product_id;
    select company_id into v_other_company from public.warehouses where id = new.warehouse_id;
    if v_company is null or v_other_company is null or v_company <> v_other_company then
      raise exception 'TENANT_MISMATCH:product_variants_stock';
    end if;

  elsif tg_table_name = 'product_batches' then
    if not exists (
      select 1 from public.products
       where id = new.product_id and company_id = new.company_id
    ) or not exists (
      select 1 from public.warehouses
       where id = new.warehouse_id and company_id = new.company_id
    ) then
      raise exception 'TENANT_MISMATCH:product_batches';
    end if;

  elsif tg_table_name = 'recipes' then
    if not exists (
      select 1 from public.products
       where id = new.dish_id and company_id = new.company_id
    ) or not exists (
      select 1 from public.products
       where id = new.ingredient_id and company_id = new.company_id
    ) then
      raise exception 'TENANT_MISMATCH:recipes';
    end if;

  elsif tg_table_name = 'reservations' then
    if not exists (
      select 1 from public.products
       where id = new.product_id and company_id = new.company_id
    ) or not exists (
      select 1 from public.warehouses
       where id = new.warehouse_id and company_id = new.company_id
    ) then
      raise exception 'TENANT_MISMATCH:reservations';
    end if;

  elsif tg_table_name = 'booking_items' then
    select company_id into v_company from public.bookings where id = new.booking_id;
    select company_id into v_other_company from public.products where id = new.dish_id;
    if v_company is null or v_other_company is null or v_company <> v_other_company then
      raise exception 'TENANT_MISMATCH:booking_items';
    end if;

  elsif tg_table_name = 'reorder_requests' then
    if not exists (
      select 1 from public.products
       where id = new.product_id and company_id = new.company_id
    ) or not exists (
      select 1 from public.warehouses
       where id = new.warehouse_id and company_id = new.company_id
    ) then
      raise exception 'TENANT_MISMATCH:reorder_requests';
    end if;

  elsif tg_table_name = 'putaway_rules' then
    if not exists (
      select 1 from public.warehouses
       where id = new.warehouse_id and company_id = new.company_id
    ) or (
      new.product_id is not null and not exists (
        select 1 from public.products
         where id = new.product_id and company_id = new.company_id
      )
    ) or (
      new.category_id is not null and not exists (
        select 1 from public.categories
         where id = new.category_id and company_id = new.company_id
      )
    ) then
      raise exception 'TENANT_MISMATCH:putaway_rules';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_consistency_pws on public.product_warehouse_stock;
create trigger tenant_consistency_pws
before insert or update on public.product_warehouse_stock
for each row execute function public.enforce_tenant_consistency();

drop trigger if exists tenant_consistency_movements on public.stock_movements;
create trigger tenant_consistency_movements
before insert or update on public.stock_movements
for each row execute function public.enforce_tenant_consistency();

drop trigger if exists tenant_consistency_variants on public.product_variants_stock;
create trigger tenant_consistency_variants
before insert or update on public.product_variants_stock
for each row execute function public.enforce_tenant_consistency();

drop trigger if exists tenant_consistency_batches on public.product_batches;
create trigger tenant_consistency_batches
before insert or update on public.product_batches
for each row execute function public.enforce_tenant_consistency();

drop trigger if exists tenant_consistency_recipes on public.recipes;
create trigger tenant_consistency_recipes
before insert or update on public.recipes
for each row execute function public.enforce_tenant_consistency();

drop trigger if exists tenant_consistency_reservations on public.reservations;
create trigger tenant_consistency_reservations
before insert or update on public.reservations
for each row execute function public.enforce_tenant_consistency();

drop trigger if exists tenant_consistency_booking_items on public.booking_items;
create trigger tenant_consistency_booking_items
before insert or update on public.booking_items
for each row execute function public.enforce_tenant_consistency();

drop trigger if exists tenant_consistency_reorders on public.reorder_requests;
create trigger tenant_consistency_reorders
before insert or update on public.reorder_requests
for each row execute function public.enforce_tenant_consistency();

drop trigger if exists tenant_consistency_putaway on public.putaway_rules;
create trigger tenant_consistency_putaway
before insert or update on public.putaway_rules
for each row execute function public.enforce_tenant_consistency();

revoke execute on function public.enforce_tenant_consistency()
  from public, anon, authenticated;
grant execute on function public.enforce_tenant_consistency() to service_role;
