-- ============================================================
-- 017_transfer_stock.sql
-- Hace que el tipo de movimiento "transferencia" mueva stock de verdad.
-- Antes: stock.py dejaba new_qty = current_qty (no-op) y solo insertaba un
-- movimiento — el historial quedaba formalmente válido pero materialmente
-- falso (el usuario creía haber movido mercancía y ningún almacén cambiaba).
--
-- transfer_stock_strict: decremento en origen + incremento en destino en
-- UNA sola transacción de Postgres. Falla con INSUFFICIENT_STOCK si el
-- origen no tiene suficiente (mismo criterio que decrement_stock_strict de
-- 011_atomic_stock.sql). Usa ON CONFLICT sobre el unique(product_id,
-- warehouse_id) de product_warehouse_stock para crear o incrementar la fila
-- destino sin condición de carrera.
-- ============================================================

create or replace function transfer_stock_strict(
  p_product_id uuid,
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_qty numeric
) returns table (from_qty numeric, to_qty numeric)
language plpgsql
as $$
declare
  v_from_qty numeric;
  v_to_qty numeric;
begin
  if p_from_warehouse_id = p_to_warehouse_id then
    raise exception 'SAME_WAREHOUSE';
  end if;

  update product_warehouse_stock
     set quantity = quantity - p_qty
   where product_id = p_product_id
     and warehouse_id = p_from_warehouse_id
     and quantity >= p_qty
  returning quantity into v_from_qty;

  if v_from_qty is null then
    raise exception 'INSUFFICIENT_STOCK';
  end if;

  insert into product_warehouse_stock (product_id, warehouse_id, quantity)
  values (p_product_id, p_to_warehouse_id, p_qty)
  on conflict (product_id, warehouse_id)
  do update set quantity = product_warehouse_stock.quantity + excluded.quantity
  returning quantity into v_to_qty;

  return query select v_from_qty, v_to_qty;
end;
$$;

-- Columna para registrar el almacén destino en movimientos de transferencia
-- (warehouse_id sigue siendo el ORIGEN, igual que en entrada/salida/ajuste).
alter table public.stock_movements
  add column if not exists to_warehouse_id uuid references public.warehouses(id);

revoke execute on function public.transfer_stock_strict(uuid, uuid, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.transfer_stock_strict(uuid, uuid, uuid, numeric)
  to service_role;
