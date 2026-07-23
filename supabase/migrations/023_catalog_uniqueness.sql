-- ============================================================
-- 023_catalog_uniqueness.sql
-- SKU y código de barras únicos dentro de cada empresa.
--
-- Ejecutar MANUALMENTE después de 022_tenant_consistency.sql.
-- Si existen duplicados, los bloques DO fallan con un mensaje explícito
-- y NO crean el índice correspondiente. Consulta primero el preflight
-- incluido al final de este archivo.
-- ============================================================

do $$
begin
  if exists (
    select 1
      from public.products
     where nullif(btrim(sku), '') is not null
     group by company_id, lower(btrim(sku))
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_SKU: resuelve los SKU duplicados antes de continuar';
  end if;
end;
$$;

create unique index if not exists uq_products_company_sku_ci
  on public.products (company_id, lower(btrim(sku)))
  where nullif(btrim(sku), '') is not null;

do $$
begin
  if exists (
    select 1
      from public.products
     where nullif(btrim(barcode), '') is not null
     group by company_id, btrim(barcode)
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_BARCODE: resuelve los códigos duplicados antes de continuar';
  end if;
end;
$$;

create unique index if not exists uq_products_company_barcode
  on public.products (company_id, btrim(barcode))
  where nullif(btrim(barcode), '') is not null;

-- PREFLIGHT / diagnóstico (debe devolver 0 filas antes de ejecutar):
-- select company_id, lower(btrim(sku)) as value, count(*) as duplicates,
--        array_agg(id order by created_at) as product_ids
--   from public.products
--  where nullif(btrim(sku), '') is not null
--  group by company_id, lower(btrim(sku))
-- having count(*) > 1;
--
-- select company_id, btrim(barcode) as value, count(*) as duplicates,
--        array_agg(id order by created_at) as product_ids
--   from public.products
--  where nullif(btrim(barcode), '') is not null
--  group by company_id, btrim(barcode)
-- having count(*) > 1;
