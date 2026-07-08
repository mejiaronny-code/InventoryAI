-- 012_embedding_test_column.sql
-- Columna temporal para probar Qwen3-Embedding-0.6B (1024 dims) en paralelo
-- a la columna real `embedding` (Qwen3-Embedding-8B, 1536 dims), sin tocar
-- la búsqueda en producción. Se compara calidad con productos reales antes
-- de decidir si migrar de verdad. Si no convence, se borra con:
--   ALTER TABLE products DROP COLUMN embedding_test;
-- y no queda ningún rastro ni efecto sobre nada más.

ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding_test vector(1024);
