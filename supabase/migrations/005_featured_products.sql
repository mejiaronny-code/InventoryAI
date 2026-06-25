-- ============================================================
-- 005_featured_products.sql
-- Productos destacados: el admin marca manualmente qué productos
-- quiere resaltar. El modo "explorar catálogo" del chat IA
-- (search_products con query="") los muestra primero.
-- ============================================================

alter table products
  add column if not exists is_featured boolean not null default false;

create index if not exists idx_products_featured
  on products (company_id, is_featured)
  where is_featured = true;
