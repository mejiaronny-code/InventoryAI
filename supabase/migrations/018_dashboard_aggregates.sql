-- ============================================================
-- 018_dashboard_aggregates.sql
-- Mueve las métricas del dashboard (stock total/bajo/por vencer, costo de
-- IA mensual, agregados de superadmin) de "descargar todas las filas y
-- sumarlas en Python" a agregación SQL. PostgREST tiene un límite de fila
-- por respuesta (configurable, por defecto suele ser 1000) — con suficiente
-- volumen (muchos SKUs×almacenes, muchos registros de uso de IA en el mes),
-- las queries antiguas se truncaban EN SILENCIO y las métricas salían mal
-- sin ningún error visible. SUM/COUNT en Postgres no tienen ese límite.
-- ============================================================

-- Stock total, productos con stock bajo, y próximos a vencer — para el
-- dashboard de una sola empresa (dashboard.py::get_dashboard_metrics).
create or replace function company_stock_metrics(
  p_company_id uuid,
  p_expiry_cutoff timestamptz
) returns table (
  total_stock bigint,
  low_stock_count bigint,
  expiring_soon_count bigint
)
language sql stable
as $$
  select
    coalesce(sum(pws.quantity), 0) as total_stock,
    count(*) filter (where pws.quantity <= coalesce(pws.min_stock_alert, 5)) as low_stock_count,
    count(*) filter (
      where pws.nearest_expiry is not null and pws.nearest_expiry <= p_expiry_cutoff
    ) as expiring_soon_count
  from product_warehouse_stock pws
  join products p on p.id = pws.product_id
  where p.company_id = p_company_id
    and p.is_active = true;
$$;

-- Costo de IA (crudo, sin margen) de una empresa en un rango de fechas.
create or replace function company_ai_cost_sum(
  p_company_id uuid,
  p_since timestamptz
) returns numeric
language sql stable
as $$
  select coalesce(sum(cost_usd), 0)
  from ai_usage_log
  where company_id = p_company_id
    and created_at >= p_since;
$$;

-- Superadmin: costo de IA agrupado por empresa, para un rango de fechas.
create or replace function ai_cost_by_company(
  p_since timestamptz
) returns table (company_id uuid, total_cost numeric)
language sql stable
as $$
  select company_id, coalesce(sum(cost_usd), 0) as total_cost
  from ai_usage_log
  where created_at >= p_since
  group by company_id;
$$;

-- Superadmin: costo de IA agrupado por día, para un rango de fechas.
create or replace function ai_cost_by_day(
  p_since timestamptz
) returns table (day date, total_cost numeric)
language sql stable
as $$
  select created_at::date as day, coalesce(sum(cost_usd), 0) as total_cost
  from ai_usage_log
  where created_at >= p_since
  group by created_at::date
  order by day;
$$;

-- Superadmin: cantidad de reservas por empresa, para un rango de fechas.
create or replace function reservations_count_by_company(
  p_since timestamptz
) returns table (company_id uuid, total_count bigint)
language sql stable
as $$
  select company_id, count(*) as total_count
  from reservations
  where created_at >= p_since
  group by company_id;
$$;

-- Son métricas internas de empresa/plataforma. La anon key no debe poder
-- consultar agregados saltándose las reglas del backend.
revoke execute on function public.company_stock_metrics(uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.company_ai_cost_sum(uuid, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.ai_cost_by_company(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.ai_cost_by_day(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.reservations_count_by_company(timestamptz)
  from public, anon, authenticated;

grant execute on function public.company_stock_metrics(uuid, timestamptz)
  to service_role;
grant execute on function public.company_ai_cost_sum(uuid, timestamptz)
  to service_role;
grant execute on function public.ai_cost_by_company(timestamptz)
  to service_role;
grant execute on function public.ai_cost_by_day(timestamptz)
  to service_role;
grant execute on function public.reservations_count_by_company(timestamptz)
  to service_role;
