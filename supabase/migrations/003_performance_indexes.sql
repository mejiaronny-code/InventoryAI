-- ============================================================
-- Migración 003 — Índices de rendimiento
-- Ejecutar UNA VEZ en Supabase SQL Editor
-- ============================================================

-- ── products ──────────────────────────────────────────────
-- Tiene: company_id, is_active
CREATE INDEX IF NOT EXISTS idx_products_company_id
  ON public.products (company_id);

CREATE INDEX IF NOT EXISTS idx_products_company_active
  ON public.products (company_id, is_active);

-- ── product_warehouse_stock ───────────────────────────────
-- No tiene company_id — solo product_id y warehouse_id
CREATE INDEX IF NOT EXISTS idx_pws_product_id
  ON public.product_warehouse_stock (product_id);

CREATE INDEX IF NOT EXISTS idx_pws_warehouse_id
  ON public.product_warehouse_stock (warehouse_id);

-- ── stock_movements ───────────────────────────────────────
-- No tiene company_id — se llega via product_id/warehouse_id
CREATE INDEX IF NOT EXISTS idx_movements_product_id
  ON public.stock_movements (product_id);

CREATE INDEX IF NOT EXISTS idx_movements_created_at
  ON public.stock_movements (created_at DESC);

-- ── reservations ─────────────────────────────────────────
-- Tiene: company_id, status, reservation_code, client_email
CREATE INDEX IF NOT EXISTS idx_reservations_company_status
  ON public.reservations (company_id, status);

CREATE INDEX IF NOT EXISTS idx_reservations_code
  ON public.reservations (reservation_code);

CREATE INDEX IF NOT EXISTS idx_reservations_email
  ON public.reservations (client_email);

-- ── notifications ─────────────────────────────────────────
-- Tiene: company_id, created_at
CREATE INDEX IF NOT EXISTS idx_notifications_company_created
  ON public.notifications (company_id, created_at DESC);

-- ── user_profiles ─────────────────────────────────────────
-- Tiene: company_id
CREATE INDEX IF NOT EXISTS idx_user_profiles_company_id
  ON public.user_profiles (company_id);
