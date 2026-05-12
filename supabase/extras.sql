-- ============================================================
-- supabase/extras.sql
-- Ejecutar DESPUÉS de schema.sql
-- Contiene: cron jobs, vistas útiles, índices adicionales
-- ============================================================

-- ── 1. EXTENSIÓN PG_CRON (expiración automática de reservas) ──
-- Nota: pg_cron requiere activarse en Supabase Dashboard:
-- Database → Extensions → pg_cron → Enable

-- Una vez activado, ejecutar:
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'expire-reservations-every-15min',
  '*/15 * * * *',
  $$
    UPDATE public.reservations
    SET status = 'expired', updated_at = now()
    WHERE status IN ('pending', 'confirmed')
      AND expires_at < now();
  $$
);

-- ── 2. VISTA: stock_summary (stock disponible por producto) ──
CREATE OR REPLACE VIEW public.stock_summary AS
SELECT
  p.id              AS product_id,
  p.name            AS product_name,
  p.company_id,
  p.price,
  p.unit,
  COALESCE(SUM(pws.quantity), 0) AS total_stock,
  COALESCE(SUM(pws.quantity), 0) - COALESCE(
    (
      SELECT SUM(r.quantity)
      FROM public.reservations r
      WHERE r.product_id = p.id
        AND r.status IN ('pending', 'confirmed')
    ), 0
  ) AS available_stock,
  COALESCE(
    (
      SELECT SUM(r.quantity)
      FROM public.reservations r
      WHERE r.product_id = p.id
        AND r.status IN ('pending', 'confirmed')
    ), 0
  ) AS reserved_stock
FROM public.products p
LEFT JOIN public.product_warehouse_stock pws ON pws.product_id = p.id
WHERE p.is_active = TRUE
GROUP BY p.id;

-- ── 3. VISTA: reservation_detail (reservas con todo el contexto) ──
CREATE OR REPLACE VIEW public.reservation_detail AS
SELECT
  r.*,
  p.name        AS product_name,
  p.price       AS product_price,
  p.unit        AS product_unit,
  w.name        AS warehouse_name,
  w.location    AS warehouse_location,
  c.name        AS company_name,
  c.slug        AS company_slug
FROM public.reservations r
JOIN public.products  p ON p.id = r.product_id
JOIN public.warehouses w ON w.id = r.warehouse_id
JOIN public.companies c ON c.id = r.company_id;

-- ── 4. ÍNDICES ADICIONALES de rendimiento ──

-- Búsquedas por código de reserva (frecuente en consultas públicas)
CREATE INDEX IF NOT EXISTS idx_reservations_code
  ON public.reservations (reservation_code);

-- Reservas activas por empresa (para stock disponible)
CREATE INDEX IF NOT EXISTS idx_reservations_active
  ON public.reservations (product_id, warehouse_id, status)
  WHERE status IN ('pending', 'confirmed');

-- Productos por empresa activos
CREATE INDEX IF NOT EXISTS idx_products_company_active
  ON public.products (company_id, is_active);

-- Notificaciones no leídas
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (company_id, read)
  WHERE read = FALSE;

-- Movimientos de stock recientes
CREATE INDEX IF NOT EXISTS idx_stock_movements_recent
  ON public.stock_movements (created_at DESC);

-- AI usage por empresa y mes
CREATE INDEX IF NOT EXISTS idx_ai_usage_company_date
  ON public.ai_usage_log (company_id, created_at DESC);

-- ── 5. FUNCIÓN: batch embed missing products ──
-- Útil para regenerar embeddings de todos los productos
-- que todavía no tienen embedding (en caso de migración)
CREATE OR REPLACE FUNCTION get_products_without_embedding(
  p_company_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, name text, description text, use_cases text)
LANGUAGE sql STABLE AS $$
  SELECT id, name, description, use_cases
  FROM products
  WHERE embedding IS NULL
    AND is_active = TRUE
    AND (p_company_id IS NULL OR company_id = p_company_id)
  ORDER BY created_at DESC
  LIMIT 100;
$$;

-- ── 6. FUNCIÓN RPC PÚBLICA: búsqueda por slug (sin auth) ──
-- Permite que el frontend público busque productos sin JWT
CREATE OR REPLACE FUNCTION search_products_by_slug(
  slug_filter    text,
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.4,
  match_count     int   DEFAULT 8
)
RETURNS TABLE (
  id uuid, name text, description text,
  use_cases text, price numeric, unit text,
  category_id uuid, images text[], similarity float
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    p.id, p.name, p.description, p.use_cases,
    p.price, p.unit, p.category_id, p.images,
    1 - (p.embedding <=> query_embedding) AS similarity
  FROM products p
  JOIN companies c ON c.id = p.company_id
  WHERE c.slug = slug_filter
    AND c.is_active = TRUE
    AND p.is_active = TRUE
    AND p.embedding IS NOT NULL
    AND 1 - (p.embedding <=> query_embedding) > match_threshold
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;
