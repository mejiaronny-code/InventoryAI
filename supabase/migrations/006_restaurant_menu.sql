-- ============================================================
-- 006_restaurant_menu.sql  (Sector Restaurantes — Fase R1)
-- Convierte el catálogo en "menú": los productos pueden ser platillos
-- (dish) o insumos crudos (ingredient). Agrega campos propios de menú:
-- alérgenos, info dietética, "agotado hoy" y tiempo de preparación.
--
-- product_type:
--   'simple'     → producto normal (todos los sectores actuales)
--   'dish'       → platillo del menú (lleva precio/foto/receta)
--   'ingredient' → insumo crudo (lleva stock; se consume vía recetas)
-- ============================================================

alter table products
  add column if not exists product_type      text    not null default 'simple',
  add column if not exists allergens          text[]  not null default '{}',
  add column if not exists dietary            text[]  not null default '{}',
  add column if not exists is_available       boolean not null default true,
  add column if not exists prep_time_minutes  int;

-- Búsqueda/listado por tipo dentro de cada empresa (platillos vs insumos)
create index if not exists idx_products_company_type
  on products (company_id, product_type);
