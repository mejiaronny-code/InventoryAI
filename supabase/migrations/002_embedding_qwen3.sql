-- ============================================================
-- MIGRACIÓN 002: Cambio de modelo de embeddings
-- OpenAI text-embedding-3-small → DeepInfra Qwen3-Embedding-8B
--
-- La columna embedding sigue siendo vector(1536) — no hay cambio de esquema.
-- Qwen3-Embedding-8B con MRL genera 1536 dimensiones, igual que antes.
-- Solo se limpian los embeddings viejos para forzar la regeneración.
-- ============================================================

-- 1. Limpiar embeddings existentes (incompatibles entre modelos)
UPDATE public.products SET embedding = NULL;

-- 2. La función search_products_semantic NO necesita cambios (sigue usando vector(1536))
-- 3. El índice ivfflat tampoco necesita cambios

-- ============================================================
-- DESPUÉS de ejecutar este SQL:
--   1. Reinicia el backend
--   2. Llama POST /api/v1/products/reembed-all con token de admin
--      Los nuevos embeddings se generarán con Qwen3-Embedding-8B
-- ============================================================
