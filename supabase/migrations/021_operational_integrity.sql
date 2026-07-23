-- ============================================================
-- 021_operational_integrity.sql
-- Recetas, ventas por receta y stock por variante transaccionales.
--
-- Ejecutar MANUALMENTE después de 020_booking_integrity.sql.
-- ============================================================

alter table public.recipes
  drop constraint if exists recipes_quantity_positive,
  add constraint recipes_quantity_positive check (quantity > 0);


create or replace function public.replace_recipe(
  p_company_id uuid,
  p_dish_id uuid,
  p_items jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_ingredient_id uuid;
  v_quantity numeric;
  v_count integer := 0;
begin
  if not exists (
    select 1 from public.products
     where id = p_dish_id
       and company_id = p_company_id
       and product_type = 'dish'
  ) then
    raise exception 'DISH_NOT_FOUND';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_ingredient_id := (v_item->>'ingredient_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity <= 0 then
      raise exception 'INVALID_RECIPE_QUANTITY';
    end if;
    if not exists (
      select 1 from public.products
       where id = v_ingredient_id
         and company_id = p_company_id
         and product_type = 'ingredient'
    ) then
      raise exception 'INGREDIENT_NOT_FOUND:%', v_ingredient_id;
    end if;
  end loop;

  delete from public.recipes
   where company_id = p_company_id and dish_id = p_dish_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    insert into public.recipes (
      company_id, dish_id, ingredient_id, quantity, unit
    ) values (
      p_company_id,
      p_dish_id,
      (v_item->>'ingredient_id')::uuid,
      (v_item->>'quantity')::numeric,
      nullif(v_item->>'unit', '')
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


create or replace function public.register_recipe_sale(
  p_company_id uuid,
  p_items jsonb,
  p_warehouse_id uuid,
  p_created_by uuid
) returns table (
  dish_name text,
  ingredient_name text,
  needed integer,
  deducted integer,
  short integer,
  warehouse_id uuid,
  new_quantity integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale jsonb;
  v_dish_id uuid;
  v_sale_qty integer;
  v_dish_name text;
  v_recipe record;
  v_stock record;
  v_needed integer;
  v_deducted integer;
  v_new_quantity integer;
begin
  if p_warehouse_id is not null and not exists (
    select 1 from public.warehouses
     where id = p_warehouse_id and company_id = p_company_id
  ) then
    raise exception 'WAREHOUSE_NOT_FOUND';
  end if;

  -- Primero se valida todo el lote para evitar consumos parciales por un ID ajeno.
  for v_sale in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_dish_id := (v_sale->>'dish_id')::uuid;
    v_sale_qty := (v_sale->>'quantity')::integer;
    if v_sale_qty <= 0 then
      raise exception 'INVALID_SALE_QUANTITY';
    end if;
    if not exists (
      select 1 from public.products
       where id = v_dish_id
         and company_id = p_company_id
         and product_type = 'dish'
    ) then
      raise exception 'DISH_NOT_FOUND:%', v_dish_id;
    end if;
  end loop;

  for v_sale in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_dish_id := (v_sale->>'dish_id')::uuid;
    v_sale_qty := (v_sale->>'quantity')::integer;
    select name into v_dish_name
      from public.products where id = v_dish_id;

    for v_recipe in
      select r.ingredient_id, r.quantity, p.name
        from public.recipes r
        join public.products p
          on p.id = r.ingredient_id and p.company_id = p_company_id
       where r.company_id = p_company_id and r.dish_id = v_dish_id
    loop
      v_needed := round(v_recipe.quantity * v_sale_qty);
      if v_needed <= 0 then
        continue;
      end if;

      select pws.product_id, pws.warehouse_id, pws.quantity
        into v_stock
        from public.product_warehouse_stock pws
        join public.warehouses w
          on w.id = pws.warehouse_id and w.company_id = p_company_id
       where pws.product_id = v_recipe.ingredient_id
         and (p_warehouse_id is null or pws.warehouse_id = p_warehouse_id)
       order by pws.quantity desc
       limit 1
       for update of pws;

      if found then
        v_deducted := least(v_stock.quantity, v_needed);
        v_new_quantity := v_stock.quantity - v_deducted;
        if v_deducted > 0 then
          update public.product_warehouse_stock
             set quantity = v_new_quantity, updated_at = now()
           where product_id = v_stock.product_id
             and warehouse_id = v_stock.warehouse_id;
          insert into public.stock_movements (
            product_id, warehouse_id, type, quantity, notes, created_by
          ) values (
            v_stock.product_id, v_stock.warehouse_id, 'salida', v_deducted,
            'Venta: ' || v_sale_qty || '× ' || v_dish_name, p_created_by
          );
        end if;
      else
        v_deducted := 0;
        v_new_quantity := 0;
        v_stock.warehouse_id := null;
      end if;

      dish_name := v_dish_name;
      ingredient_name := v_recipe.name;
      needed := v_needed;
      deducted := v_deducted;
      short := v_needed - v_deducted;
      warehouse_id := v_stock.warehouse_id;
      new_quantity := v_new_quantity;
      return next;
    end loop;
  end loop;
end;
$$;


create or replace function public.replace_variant_stock(
  p_company_id uuid,
  p_product_id uuid,
  p_items jsonb,
  p_notes text,
  p_created_by uuid
) returns table (saved integer, affected_warehouses integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_existing record;
  v_warehouse_id uuid;
  v_combination jsonb;
  v_quantity integer;
  v_old integer;
  v_delta integer;
  v_saved integer := 0;
  v_affected uuid[] := '{}';
  v_decrease boolean := false;
  v_product_name text;
begin
  select name into v_product_name
    from public.products
   where id = p_product_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_warehouse_id := (v_item->>'warehouse_id')::uuid;
    v_combination := coalesce(v_item->'combination', '{}'::jsonb);
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity < 0 then
      raise exception 'INVALID_QUANTITY';
    end if;
    if not exists (
      select 1 from public.warehouses
       where id = v_warehouse_id and company_id = p_company_id
    ) then
      raise exception 'WAREHOUSE_NOT_FOUND:%', v_warehouse_id;
    end if;
    if not (v_warehouse_id = any(v_affected)) then
      v_affected := array_append(v_affected, v_warehouse_id);
    end if;
  end loop;

  for v_existing in
    select * from public.product_variants_stock
     where product_id = p_product_id
       and warehouse_id = any(v_affected)
     for update
  loop
    if exists (
      select 1
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) supplied
       where (supplied->>'warehouse_id')::uuid = v_existing.warehouse_id
         and coalesce(supplied->'combination', '{}'::jsonb) = v_existing.combination
         and (supplied->>'quantity')::integer < v_existing.quantity
    ) then
      v_decrease := true;
    end if;
  end loop;

  if v_decrease and nullif(btrim(coalesce(p_notes, '')), '') is null then
    raise exception 'NOTES_REQUIRED';
  end if;

  for v_existing in
    select * from public.product_variants_stock
     where product_id = p_product_id
       and warehouse_id = any(v_affected)
       and exists (
         select 1
           from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) supplied
          where (supplied->>'warehouse_id')::uuid = product_variants_stock.warehouse_id
            and coalesce(supplied->'combination', '{}'::jsonb) =
                product_variants_stock.combination
       )
     for update
  loop
    select (supplied->>'quantity')::integer into v_quantity
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) supplied
     where (supplied->>'warehouse_id')::uuid = v_existing.warehouse_id
       and coalesce(supplied->'combination', '{}'::jsonb) = v_existing.combination
     limit 1;
    v_quantity := coalesce(v_quantity, 0);
    v_delta := v_quantity - v_existing.quantity;
    if v_delta <> 0 then
      insert into public.stock_movements (
        product_id, warehouse_id, type, quantity, notes, created_by
      ) values (
        p_product_id, v_existing.warehouse_id,
        case when v_delta > 0 then 'entrada' else 'salida' end,
        abs(v_delta),
        'Variante de ' || v_product_name || ': ' || v_existing.combination::text ||
          ' ' || v_existing.quantity || ' → ' || v_quantity ||
          case when nullif(btrim(coalesce(p_notes, '')), '') is not null
               then ' — Motivo: ' || btrim(p_notes) else '' end,
        p_created_by
      );
    end if;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_warehouse_id := (v_item->>'warehouse_id')::uuid;
    v_combination := coalesce(v_item->'combination', '{}'::jsonb);
    v_quantity := (v_item->>'quantity')::integer;
    select quantity into v_old
      from public.product_variants_stock
     where product_id = p_product_id
       and warehouse_id = v_warehouse_id
       and combination = v_combination;
    if not found then
      v_old := 0;
      if v_quantity > 0 then
        insert into public.stock_movements (
          product_id, warehouse_id, type, quantity, notes, created_by
        ) values (
          p_product_id, v_warehouse_id, 'entrada', v_quantity,
          'Nueva variante de ' || v_product_name || ': ' || v_combination::text,
          p_created_by
        );
      end if;
    end if;
    insert into public.product_variants_stock (
      product_id, warehouse_id, combination, quantity, updated_at
    ) values (
      p_product_id, v_warehouse_id, v_combination, v_quantity, now()
    )
    on conflict (product_id, warehouse_id, combination)
    do update set quantity = excluded.quantity, updated_at = now();
    v_saved := v_saved + 1;
  end loop;

  for v_warehouse_id in select unnest(v_affected)
  loop
    insert into public.product_warehouse_stock (
      product_id, warehouse_id, quantity, min_stock_alert
    )
    select p_product_id, v_warehouse_id, coalesce(sum(quantity), 0), 5
      from public.product_variants_stock
     where product_id = p_product_id and warehouse_id = v_warehouse_id
    on conflict (product_id, warehouse_id)
    do update set quantity = excluded.quantity, updated_at = now();
  end loop;

  return query select v_saved, coalesce(cardinality(v_affected), 0);
end;
$$;


create or replace function public.finalize_company_document(
  p_company_id uuid,
  p_document_id uuid,
  p_chunks jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chunk jsonb;
  v_count integer := 0;
begin
  perform 1 from public.company_documents
   where id = p_document_id and company_id = p_company_id
   for update;
  if not found then
    raise exception 'DOCUMENT_NOT_FOUND';
  end if;

  delete from public.company_document_chunks
   where document_id = p_document_id and company_id = p_company_id;

  for v_chunk in select * from jsonb_array_elements(coalesce(p_chunks, '[]'::jsonb))
  loop
    insert into public.company_document_chunks (
      document_id, company_id, chunk_index, content, embedding
    ) values (
      p_document_id,
      p_company_id,
      (v_chunk->>'chunk_index')::integer,
      v_chunk->>'content',
      (v_chunk->>'embedding')::vector(1024)
    );
    v_count := v_count + 1;
  end loop;

  update public.company_documents
     set status = 'ready', chunk_count = v_count, error_message = null
   where id = p_document_id and company_id = p_company_id;
  return v_count;
end;
$$;


revoke execute on function public.replace_recipe(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.register_recipe_sale(uuid, jsonb, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.replace_variant_stock(uuid, uuid, jsonb, text, uuid)
  from public, anon, authenticated;
revoke execute on function public.finalize_company_document(uuid, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.replace_recipe(uuid, uuid, jsonb) to service_role;
grant execute on function public.register_recipe_sale(uuid, jsonb, uuid, uuid) to service_role;
grant execute on function public.replace_variant_stock(uuid, uuid, jsonb, text, uuid) to service_role;
grant execute on function public.finalize_company_document(uuid, uuid, jsonb) to service_role;
