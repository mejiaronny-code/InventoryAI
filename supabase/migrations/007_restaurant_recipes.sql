-- ============================================================
-- 007_restaurant_recipes.sql  (Sector Restaurantes — Fase R2)
-- Recetas: vinculan un platillo (dish) con los insumos (ingredient)
-- que consume. Al registrar la venta de un platillo, se descuentan
-- automáticamente los insumos de su receta del inventario.
--
-- quantity = cuántas unidades de stock del insumo consume 1 platillo.
--   (el insumo se trackea en su unidad más pequeña: gramos, ml, piezas)
-- unit = etiqueta informativa para el admin (ej. "g", "ml", "pza").
-- ============================================================

create table if not exists recipes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  dish_id       uuid not null references products(id) on delete cascade,
  ingredient_id uuid not null references products(id) on delete cascade,
  quantity      numeric not null default 0,
  unit          text,
  created_at    timestamptz not null default now()
);

-- Un insumo aparece una sola vez por platillo
create unique index if not exists uq_recipes_dish_ingredient
  on recipes (dish_id, ingredient_id);

create index if not exists idx_recipes_dish on recipes (dish_id);
create index if not exists idx_recipes_company on recipes (company_id);
