-- ============================================================
-- Denver Engineering — Migration 083: Reconcile change_orders schema
-- AUDIT-P0-03 (INDEPENDENT_AUDIT_2026-07-02.md)
--
-- Migration 007 (pm_modules) created `change_orders` with one shape
-- (co_number VARCHAR, amount, status VARCHAR, approved_by/at, ...).
-- Migration 058 (change_orders) shipped a second, incompatible
-- `CREATE TABLE IF NOT EXISTS change_orders` targeting a different shape
-- (type/co_status enums, cost_impact, reviewed_by/at, review_notes, ...).
-- Because 007 runs first (lexicographic migration order), 058's
-- CREATE TABLE was always a silent no-op — the columns it assumed
-- (reviewed_by, cost_impact, ...) never actually existed.
--
-- api/services/myWork/myWorkService.ts, api/services/changeOrders/
-- changeOrderService.ts, api/services/notifications2/notificationService.ts,
-- api/services/copilot/coordinationService.ts, and api/services/related/
-- relatedService.ts were all written against 058's column names — this
-- migration adds the missing columns additively so those consumers work
-- against the table that actually exists, without touching the columns
-- api/routes/budgets.ts's older inline CRUD still relies on (amount,
-- co_type, reason_code, cost_code, schedule_days, executed_at).
--
-- `status` intentionally stays VARCHAR(20) rather than converting to the
-- `co_status` enum: budgets.ts sets status='executed', which is not a
-- member of co_status, and converting an already-populated column's type
-- is a higher-risk destructive-adjacent change than this reconciliation
-- migration is meant to make. changeOrderService.ts's status-filter query
-- was adjusted (see accompanying code change) to stop casting its status
-- parameter to the co_status enum for the same reason.
-- ============================================================

ALTER TABLE change_orders
  ADD COLUMN IF NOT EXISTS type                 co_type       NOT NULL DEFAULT 'scope',
  ADD COLUMN IF NOT EXISTS cost_impact          NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_impact_days INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reason               TEXT,
  ADD COLUMN IF NOT EXISTS rfi_id               UUID,
  ADD COLUMN IF NOT EXISTS reviewed_by          UUID,
  ADD COLUMN IF NOT EXISTS reviewed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_notes         TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'change_orders_reviewed_by_fkey'
  ) THEN
    ALTER TABLE change_orders
      ADD CONSTRAINT change_orders_reviewed_by_fkey
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'change_orders_rfi_id_fkey'
  ) THEN
    ALTER TABLE change_orders
      ADD CONSTRAINT change_orders_rfi_id_fkey
      FOREIGN KEY (rfi_id) REFERENCES rfis(id) ON DELETE SET NULL;
  END IF;
END $$;
