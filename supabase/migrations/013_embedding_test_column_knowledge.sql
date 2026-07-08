-- 013_embedding_test_column_knowledge.sql
-- Misma prueba que 012, pero para la base de conocimiento (horarios, envíos,
-- políticas, etc.) — columna temporal, no afecta la búsqueda en producción.
-- Si no convence: ALTER TABLE company_document_chunks DROP COLUMN embedding_test;

ALTER TABLE company_document_chunks ADD COLUMN IF NOT EXISTS embedding_test vector(1024);
