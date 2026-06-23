-- ════════════════════════════════════════════════════════════════════════════
-- 076_pay_applications.sql — Phase 6: AIA G702/G703 progress billing
-- ════════════════════════════════════════════════════════════════════════════
-- Adds Schedule of Values + Pay Applications so the platform can produce
-- AIA-style progress billing (G702 summary + G703 continuation sheet) with
-- retention, completed-to-date, and current-payment-due — the core financial
-- parity gap vs Procore Financials. All tables are tenant-isolated via RLS.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Schedule of Values (the contract billing breakdown, per project) ─────────
CREATE TABLE IF NOT EXISTS sov_items (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id      UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_no         VARCHAR(40)   NOT NULL,
  description     TEXT          NOT NULL,
  scheduled_value NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (scheduled_value >= 0),
  cost_code       VARCHAR(64),
  sort_order      INTEGER       NOT NULL DEFAULT 0,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, item_no)
);

-- ─── Pay application status enum (idempotent) ────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pay_app_status') THEN
    CREATE TYPE pay_app_status AS ENUM ('draft','submitted','approved','paid','rejected');
  END IF;
END $$;

-- ─── Pay Applications (G702 header, one per billing period) ───────────────────
CREATE TABLE IF NOT EXISTS pay_applications (
  id                 UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID           NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id         UUID           NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  application_number INTEGER        NOT NULL,
  period_start       DATE,
  period_end         DATE,
  invoice_date       DATE,
  status             pay_app_status NOT NULL DEFAULT 'draft',
  retention_pct      NUMERIC(5,2)   NOT NULL DEFAULT 10 CHECK (retention_pct >= 0 AND retention_pct <= 100),
  notes              TEXT,
  submitted_at       TIMESTAMPTZ,
  approved_at        TIMESTAMPTZ,
  paid_at            TIMESTAMPTZ,
  created_by         UUID           REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, application_number)
);

-- ─── Pay Application Lines (G703 continuation, this-period amounts per SOV) ────
CREATE TABLE IF NOT EXISTS pay_application_lines (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id)           ON DELETE CASCADE,
  pay_application_id UUID          NOT NULL REFERENCES pay_applications(id)  ON DELETE CASCADE,
  sov_item_id        UUID          NOT NULL REFERENCES sov_items(id)         ON DELETE CASCADE,
  work_completed     NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (work_completed   >= 0),  -- this period
  materials_stored   NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (materials_stored >= 0),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (pay_application_id, sov_item_id)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sov_items_project    ON sov_items(tenant_id, project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pay_apps_project     ON pay_applications(tenant_id, project_id, application_number);
CREATE INDEX IF NOT EXISTS idx_pay_app_lines_app    ON pay_application_lines(tenant_id, pay_application_id);
CREATE INDEX IF NOT EXISTS idx_pay_app_lines_sov    ON pay_application_lines(tenant_id, sov_item_id);

-- ─── Row-Level Security (mirrors the platform tenant_isolation pattern) ───────
ALTER TABLE sov_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sov_items             FORCE  ROW LEVEL SECURITY;
ALTER TABLE pay_applications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_applications      FORCE  ROW LEVEL SECURITY;
ALTER TABLE pay_application_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_application_lines FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sov_items
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);
CREATE POLICY tenant_isolation ON pay_applications
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);
CREATE POLICY tenant_isolation ON pay_application_lines
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

-- ─── Grants to the non-owner app role (075 default privileges also cover this) ─
GRANT SELECT, INSERT, UPDATE, DELETE ON sov_items, pay_applications, pay_application_lines TO jarvis_app;
