-- ============================================================
-- 004_company_knowledge_base.sql
-- Base de conocimiento de la empresa: documentos institucionales
-- (PDF/Word/Markdown/texto) que el chat IA usa para responder
-- preguntas que NO son de catálogo (horarios, políticas, sucursales, FAQs).
--
-- Mismo patrón de embeddings que `products` (pgvector, Qwen3-Embedding-8B, 1536d).
-- Multi-tenant: toda fila lleva company_id y se filtra manualmente en Python
-- (igual que el resto de la app — RLS es una segunda capa de protección).
-- ============================================================

-- 1. TABLA — documentos subidos (metadata del archivo original)
create table if not exists company_documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  title         text not null,
  filename      text not null,
  file_type     text not null,          -- 'pdf' | 'docx' | 'md' | 'txt'
  status        text not null default 'processing',  -- 'processing' | 'ready' | 'error'
  error_message text,
  chunk_count   int not null default 0,
  uploaded_by   uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create index if not exists idx_company_documents_company on company_documents(company_id);

-- 2. TABLA — chunks de texto + embedding (lo que realmente se busca)
create table if not exists company_document_chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references company_documents(id) on delete cascade,
  company_id    uuid not null references companies(id) on delete cascade,
  chunk_index   int not null,
  content       text not null,
  embedding     vector(1536),
  created_at    timestamptz not null default now()
);

create index if not exists idx_company_doc_chunks_company on company_document_chunks(company_id);
create index if not exists idx_company_doc_chunks_document on company_document_chunks(document_id);

-- Índice HNSW para búsqueda semántica rápida (igual que products.embedding)
create index if not exists idx_company_doc_chunks_embedding
  on company_document_chunks using hnsw (embedding vector_cosine_ops);

-- 3. RLS — segunda capa de protección (la app ya filtra por company_id en Python)
alter table company_documents enable row level security;
alter table company_document_chunks enable row level security;

drop policy if exists "company_documents_isolation" on company_documents;
create policy "company_documents_isolation" on company_documents
  for all using (true) with check (true);
  -- (la verificación real de company_id ocurre en la capa de Python con el
  --  service-role client, igual que en `products` — ver CLAUDE.md)

drop policy if exists "company_document_chunks_isolation" on company_document_chunks;
create policy "company_document_chunks_isolation" on company_document_chunks
  for all using (true) with check (true);

-- 4. FUNCIÓN RPC — búsqueda semántica sobre chunks de documentos
-- (mismo patrón que search_products_semantic)
create or replace function search_company_knowledge(
  query_embedding vector(1536),
  company_id_filter uuid,
  match_threshold float default 0.35,
  match_count int default 5
)
returns table (
  chunk_id    uuid,
  document_id uuid,
  content     text,
  similarity  float
)
language sql stable
as $$
  select
    c.id as chunk_id,
    c.document_id,
    c.content,
    1 - (c.embedding <=> query_embedding) as similarity
  from company_document_chunks c
  where c.company_id = company_id_filter
    and c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- NOTA: el límite de documentos por empresa (knowledge_docs_limit) NO
-- requiere columna nueva — se guarda en `companies.settings` (JSONB),
-- igual que `ai_rules_limit` y `chat_daily_limit`. Se configura desde
-- el superadmin vía PATCH /companies/{id}/knowledge-docs-limit.
-- Default si no está configurado: 5 documentos.
-- ============================================================
