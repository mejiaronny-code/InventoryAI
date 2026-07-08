-- ============================================================
-- 011_atomic_stock.sql
-- Decremento atómico de stock. Hasta ahora el patrón era leer la
-- cantidad en Python, calcular el nuevo valor, y escribirlo de vuelta
-- (read-modify-write) — bajo dos requests concurrentes sobre el mismo
-- producto/almacén (ej. dos reservas casi simultáneas), una de las
-- actualizaciones se puede perder o se puede vender stock que ya no
-- existe. Estas funciones hacen el UPDATE en un solo paso atómico en
-- Postgres, eliminando la carrera.
--
-- decrement_stock_strict: falla si no hay stock suficiente (salidas,
-- ventas, registro de recetas) — mismo comportamiento que hoy, pero
-- sin la ventana de carrera del read-modify-write en Python.
--
-- decrement_stock_clamped: nunca baja de 0 (completar reservas/bookings,
-- que hoy usan max(0, ...) en Python) — mismo comportamiento, atómico.
-- ============================================================

create or replace function decrement_stock_strict(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_qty numeric
) returns numeric
language plpgsql
as $$
declare
  new_qty numeric;
begin
  update product_warehouse_stock
     set quantity = quantity - p_qty
   where product_id = p_product_id
     and warehouse_id = p_warehouse_id
     and quantity >= p_qty
  returning quantity into new_qty;

  if new_qty is null then
    raise exception 'INSUFFICIENT_STOCK';
  end if;

  return new_qty;
end;
$$;

create or replace function decrement_stock_clamped(
  p_product_id uuid,
  p_warehouse_id uuid,
  p_qty numeric
) returns numeric
language plpgsql
as $$
declare
  new_qty numeric;
begin
  update product_warehouse_stock
     set quantity = greatest(quantity - p_qty, 0)
   where product_id = p_product_id
     and warehouse_id = p_warehouse_id
  returning quantity into new_qty;

  return new_qty;  -- null si no existe la fila producto+almacén
end;
$$;
