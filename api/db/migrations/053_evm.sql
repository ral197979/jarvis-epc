-- ============================================================
-- Denver Engineering — Migration 053: Earned Value Management (EVM)
-- v10.3.0
--
-- Implements ANSI/EIA-748 EVM:
--   BCWS (Planned Value)   = baseline cost × planned % at status date
--   BCWP (Earned Value)    = baseline cost × actual % complete
--   ACWP (Actual Cost)     = actual expenditure to date
--   CPI  = BCWP / ACWP          SPI  = BCWP / BCWS
--   EAC  = BAC / CPI            ETC  = EAC - ACWP
--   VAC  = BAC - EAC            TCPI = (BAC - BCWP) / (BAC - ACWP)
--
-- Integration: extends schedule_tasks with planned dates + cost,
-- then layers EVM baselines, actuals, progress, and period snapshots.
-- ============================================================

-- ─── 1. Extend schedule_tasks with EVM fields ─────────────────────────────────
ALTER TABLE schedule_tasks
  ADD COLUMN IF NOT EXISTS planned_start    DATE,
  ADD COLUMN IF NOT EXISTS planned_finish   DATE,
  ADD COLUMN IF NOT EXISTS planned_cost     NUMERIC(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS percent_complete NUMERIC(5,2)  NOT NULL DEFAULT 0
    CHECK (percent_complete >= 0 AND percent_complete <= 100);

-- ─── 2. EVM baselines ─────────────────────────────────────────────────────────
-- One active baseline per project (the Performance Measurement Baseline).
-- Additional baselines can exist for what-if comparisons.

CREATE TABLE IF NOT EXISTS evm_baselines (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL,
  project_id  UUID        NOT NULL,
  name        TEXT        NOT NULL DEFAULT 'Performance Measurement Baseline',
  bac         NUMERIC(18,2) NOT NULL DEFAULT 0,  -- Budget at Completion (sum of all WBS BAC)
  start_date  DATE        NOT NULL,
  finish_date DATE        NOT NULL,
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, name)
);
ALTER TABLE evm_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY evm_baselines_tenant ON evm_baselines
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS evm_baselines_project_idx ON evm_baselines(tenant_id, project_id);

-- ─── 3. WBS entries ───────────────────────────────────────────────────────────
-- Hierarchical WBS breakdown. Each entry carries its own BAC slice.
-- Optionally references a schedule_task for planned date inheritance.

CREATE TABLE IF NOT EXISTS evm_wbs_entries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL,
  baseline_id      UUID        NOT NULL REFERENCES evm_baselines(id) ON DELETE CASCADE,
  project_id       UUID        NOT NULL,
  wbs_code         TEXT        NOT NULL,   -- e.g. '1.2.3'
  name             TEXT        NOT NULL,
  bac              NUMERIC(18,2) NOT NULL DEFAULT 0,
  schedule_task_id UUID,                   -- optional: inherits planned_start/finish
  planned_start    DATE,
  planned_finish   DATE,
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE evm_wbs_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY evm_wbs_entries_tenant ON evm_wbs_entries
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS evm_wbs_entries_baseline_idx ON evm_wbs_entries(baseline_id);
CREATE INDEX IF NOT EXISTS evm_wbs_entries_task_idx     ON evm_wbs_entries(schedule_task_id);

-- ─── 4. Actual cost entries (ACWP) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evm_actuals (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL,
  project_id    UUID        NOT NULL,
  wbs_entry_id  UUID        REFERENCES evm_wbs_entries(id) ON DELETE SET NULL,
  period_date   DATE        NOT NULL,
  amount        NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  description   TEXT,
  reference     TEXT,        -- PO / invoice number
  recorded_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE evm_actuals ENABLE ROW LEVEL SECURITY;
CREATE POLICY evm_actuals_tenant ON evm_actuals
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS evm_actuals_project_date_idx ON evm_actuals(tenant_id, project_id, period_date);
CREATE INDEX IF NOT EXISTS evm_actuals_wbs_idx          ON evm_actuals(wbs_entry_id);

-- ─── 5. Progress entries (% complete → BCWP) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS evm_progress (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL,
  project_id    UUID        NOT NULL,
  wbs_entry_id  UUID        NOT NULL REFERENCES evm_wbs_entries(id) ON DELETE CASCADE,
  period_date   DATE        NOT NULL,
  percent_complete NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (percent_complete >= 0 AND percent_complete <= 100),
  notes         TEXT,
  recorded_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, wbs_entry_id, period_date)
);
ALTER TABLE evm_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY evm_progress_tenant ON evm_progress
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS evm_progress_project_date_idx ON evm_progress(tenant_id, project_id, period_date);

-- ─── 6. Period snapshots (S-curve data) ───────────────────────────────────────
-- Written by the snapshot job (or on-demand). One row per project per date.
-- All monetary values are cumulative to that date.

CREATE TABLE IF NOT EXISTS evm_snapshots (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL,
  project_id    UUID        NOT NULL,
  snapshot_date DATE        NOT NULL,

  -- Core EVM values (cumulative $)
  bac   NUMERIC(18,2) NOT NULL DEFAULT 0,
  bcws  NUMERIC(18,2) NOT NULL DEFAULT 0,  -- Planned Value
  bcwp  NUMERIC(18,2) NOT NULL DEFAULT 0,  -- Earned Value
  acwp  NUMERIC(18,2) NOT NULL DEFAULT 0,  -- Actual Cost

  -- Derived indices (NULL when denominator is 0)
  cpi   NUMERIC(8,4),
  spi   NUMERIC(8,4),
  cv    NUMERIC(18,2),
  sv    NUMERIC(18,2),
  eac   NUMERIC(18,2),
  etc   NUMERIC(18,2),
  vac   NUMERIC(18,2),
  tcpi  NUMERIC(8,4),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, snapshot_date)
);
ALTER TABLE evm_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY evm_snapshots_tenant ON evm_snapshots
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS evm_snapshots_project_date_idx ON evm_snapshots(tenant_id, project_id, snapshot_date);
