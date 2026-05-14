-- ============================================================
-- Denver Engineering — Migration 058: Change Order Management
-- v10.7.0
--
-- Change orders track scope/cost/time deviations from the original
-- contract. Approved COs update the project's EVM baseline BAC.
--
-- Workflow: draft → submitted → approved | rejected → (void)
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'co_status') THEN
    CREATE TYPE co_status AS ENUM ('draft','submitted','approved','rejected','void');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'co_type') THEN
    CREATE TYPE co_type AS ENUM ('scope','time','cost','scope_time_cost');
  END IF;
END $$;

-- ─── Change orders ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS change_orders (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID          NOT NULL,
  project_id           UUID          NOT NULL,
  co_number            INTEGER       NOT NULL,              -- auto-seq per project
  title                TEXT          NOT NULL,
  description          TEXT,
  type                 co_type       NOT NULL DEFAULT 'scope',
  status               co_status     NOT NULL DEFAULT 'draft',
  cost_impact          NUMERIC(18,2) NOT NULL DEFAULT 0,   -- +ve = increase, -ve = credit
  schedule_impact_days INTEGER       NOT NULL DEFAULT 0,   -- +ve = delay, -ve = acceleration
  reason               TEXT,                               -- cause / justification
  rfi_id               UUID,                               -- optional originating RFI
  submitted_by         UUID,
  submitted_at         TIMESTAMPTZ,
  reviewed_by          UUID,
  reviewed_at          TIMESTAMPTZ,
  review_notes         TEXT,
  created_by           UUID,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, co_number)
);

ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS change_orders_tenant ON change_orders;
CREATE POLICY change_orders_tenant ON change_orders
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS change_orders_project_idx ON change_orders (tenant_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS change_orders_status_idx  ON change_orders (tenant_id, project_id, status);

-- ─── CO ↔ schedule tasks (affected tasks) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS change_order_tasks (
  id               UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID  NOT NULL,
  change_order_id  UUID  NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  schedule_task_id UUID  NOT NULL,
  impact_notes     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (change_order_id, schedule_task_id)
);

ALTER TABLE change_order_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS change_order_tasks_tenant ON change_order_tasks;
CREATE POLICY change_order_tasks_tenant ON change_order_tasks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS co_tasks_co_idx ON change_order_tasks (change_order_id);
