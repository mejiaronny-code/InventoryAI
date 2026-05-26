-- ============================================================
-- MIGRACIÓN 002: Cambio de embeddings OpenAI (1536d) → Qwen3-Embedding-8B (4096d)
-- Ejecutar en Supabase SQL Editor ANTES de llamar /products/reembed-all
-- ============================================================

-- 1. Eliminar CUALQUIER índice vectorial existente primero
--    (ivfflat no soporta > 2000 dims — debe irse antes del ALTER COLUMN)
DROP INDEX IF EXISTS public.products_embedding_idx;
DROP INDEX IF EXISTS products_embedding_idx;

-- Por si el índice tiene otro nombre, eliminar todos los índices vectoriales de products
DO $$
DECLARE
  idx_name text;
BEGIN
  FOR idx_name IN
    SELECT indexname
    FROM pg_indexes
    WHERE tablename = 'products'
      AND indexdef ILIKE '%vector%'
  LOOP
    EXECUTE 'DROP INDEX IF EXISTS ' || idx_name;
  END LOOP;
END $$;

-- 2. Limpiar embeddings existentes (son incompatibles con el nuevo modelo)
UPDATE public.products SET embedding = NULL;

-- 3. Cambiar dimensión de la columna: 1536 → 4096
ALTER TABLE public.products
  ALTER COLUMN embedding TYPE vector(4096);

-- 4. Actualizar la función RPC de búsqueda semántica
CREATE OR REPLACE FUNCTION search_products_semantic(
  query_embedding vector(4096),
  company_id_filter uuid,
  match_threshold float default 0.4,
  match_count int default 8
)
RETURNS TABLE (
  id uuid,
  name text,
  description text,
  use_cases text,
  price numeric,
  unit text,
  category_id uuid,
  images text[],
  attributes jsonb,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id,
    p.name,
    p.description,
    p.use_cases,
    p.price,
    p.unit,
    p.category_id,
    p.images,
    p.attributes,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM products p
  WHERE p.company_id = company_id_filter
    AND p.is_active = true
    AND p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 5. Recrear índice usando HNSW (soporta cualquier dimensión, más rápido que ivfflat)
CREATE INDEX IF NOT EXISTS products_embedding_idx
  ON public.products
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================
-- DESPUÉS de ejecutar este SQL:
--   1. Reinicia el backend
--   2. Llama POST /api/v1/products/reembed-all con token de admin
-- ============================================================
