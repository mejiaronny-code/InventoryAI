-- 014_switch_qwen3_0_6b.sql
-- Migración de Qwen3-Embedding-8B (1536d, vía DeepInfra) a Qwen3-Embedding-0.6B
-- (1024d) — mismo proveedor y precio, modelo mucho más liviano para reducir
-- los cold starts que veíamos (30-40s de espera en el chat).
--
-- Validado antes con datos reales: mismo top-1 en 6/6 preguntas de productos
-- y 5/5 preguntas de la base de conocimiento (columnas embedding_test creadas
-- en las migraciones 012 y 013 para esta prueba).
--
-- Reemplaza la columna vieja (1536d) por la de prueba ya poblada para la
-- empresa validada; las demás empresas quedan con embedding = NULL y se
-- regeneran con el script de backfill después de correr esto.

-- ── products ──────────────────────────────────────────────────────────
ALTER TABLE products DROP COLUMN embedding;
ALTER TABLE products RENAME COLUMN embedding_test TO embedding;

CREATE INDEX IF NOT EXISTS products_embedding_idx
  ON public.products
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE OR REPLACE FUNCTION search_products_semantic(
  query_embedding vector(1024),
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

-- ── company_document_chunks ──────────────────────────────────────────
ALTER TABLE company_document_chunks DROP COLUMN embedding;
ALTER TABLE company_document_chunks RENAME COLUMN embedding_test TO embedding;

CREATE INDEX IF NOT EXISTS idx_company_doc_chunks_embedding
  ON company_document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION search_company_knowledge(
  query_embedding vector(1024),
  company_id_filter uuid,
  match_threshold float default 0.35,
  match_count int default 5
)
RETURNS TABLE (
  chunk_id    uuid,
  document_id uuid,
  content     text,
  similarity  float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id as chunk_id,
    c.document_id,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  FROM company_document_chunks c
  WHERE c.company_id = company_id_filter
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ============================================================
-- DESPUÉS de ejecutar este SQL:
--   1. Reiniciar el backend (ya trae el cambio de modelo en el código)
--   2. Correr el script de backfill para regenerar los embeddings de las
--      empresas que quedaron en NULL (todas menos la que se usó para probar)
-- ============================================================
