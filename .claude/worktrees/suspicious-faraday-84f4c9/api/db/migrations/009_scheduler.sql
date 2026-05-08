-- ============================================================
-- JARVIS EPC — Migration 009: Generic Scheduler + Job Queue
-- v4.31.0 | Cron-style recurring jobs + generic background queue
--
-- Why a second queue instead of extending generation_jobs?
--   - generation_jobs.type is a PG enum (pack_job_type) — every new
--     job type would require an ALTER TYPE migration.
--   - background_jobs.job_type is TEXT so new features (webhook
--     dispatch, integration sync, KPI snapshot, compliance watcher,
--     etc.) can register at runtime without schema churn.
--
-- New tables:
--   scheduled_jobs   — recurring definitions (cron/interval)
--   background_jobs  — generic one-off job queue
--
-- Locking model mirrors generation_jobs: optimistic row-level lock
-- via locked_by / locked_at + FOR UPDATE SKIP LOCKED — no Redis.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- SCHEDULED JOBS
-- Recurring definitions. The scheduler tick promotes due rows
-- into background_jobs, then advances next_run_at.
--
-- Pick ONE of:
--   interval_seconds  — simple "every N seconds" cadence
--   cron_expression   — reserved for future cron-parser integration
--                       (column exists now so callers can persist
--                        intent; parsing is a no-op in v1)
--
-- If both are NULL, the row is treated as a one-shot at next_run_at
-- and is auto-disabled after it fires.
-- ──────────────────────────────────────────────────────────────

CREATE TABLE scheduled_jobs (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by        UUID          REFERENCES users(id) ON DELETE SET NULL,

  name              VARCHAR(128)  NOT NULL,       -- human label, e.g. 'nightly-kpi-snapshot'
  job_type          VARCHAR(64)   NOT NULL,       -- handler key, e.g. 'snapshot_kpis'
  payload_json      JSONB         NOT NULL DEFAULT '{}',

  -- Cadence (exactly one meaningful; see header)
  interval_seconds  INTEGER,                      -- e.g. 86400 for daily
  cron_expression   VARCHAR(64),                  -- reserved for future

  -- Lifecycle
  enabled           BOOLEAN       NOT NULL DEFAULT TRUE,
  max_attempts      INTEGER       NOT NULL DEFAULT 3,

  -- Schedule state
  next_run_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_run_at       TIMESTAMPTZ,
  last_job_id       UUID,                         -- last background_jobs row produced

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT scheduled_jobs_tenant_name_unique UNIQUE (tenant_id, name)
);

-- Primary scheduler poll index: find enabled jobs due to fire
CREATE INDEX idx_scheduled_jobs_due
  ON scheduled_jobs(next_run_at)
  WHERE enabled = TRUE;

CREATE INDEX idx_scheduled_jobs_tenant
  ON scheduled_jobs(tenant_id, created_at DESC);

ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_scheduled_jobs ON scheduled_jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_scheduled_jobs_updated_at BEFORE UPDATE ON scheduled_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- BACKGROUND JOBS
-- Generic async work queue. Each row is one execution attempt.
-- Claimed by scheduler tick with FOR UPDATE SKIP LOCKED; retried
-- with exponential backoff on failure until max_attempts reached.
--
-- scheduled_job_id links back to the recurring definition when
-- the row was promoted from scheduled_jobs (NULL for ad-hoc).
-- ──────────────────────────────────────────────────────────────

CREATE TABLE background_jobs (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scheduled_job_id  UUID          REFERENCES scheduled_jobs(id) ON DELETE SET NULL,
  created_by        UUID          REFERENCES users(id) ON DELETE SET NULL,

  job_type          VARCHAR(64)   NOT NULL,       -- handler key
  payload_json      JSONB         NOT NULL DEFAULT '{}',
  result_json       JSONB,
  error_text        TEXT,

  -- 'queued' | 'running' | 'complete' | 'failed'
  -- TEXT (not enum) so handlers can add states if needed later
  status            VARCHAR(16)   NOT NULL DEFAULT 'queued',

  -- Retry / locking
  attempts          INTEGER       NOT NULL DEFAULT 0,
  max_attempts      INTEGER       NOT NULL DEFAULT 3,
  locked_at         TIMESTAMPTZ,
  locked_by         VARCHAR(128),                 -- worker instance id
  run_after         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Primary polling index: runner selects queued jobs eligible to run
CREATE INDEX idx_background_jobs_queue
  ON background_jobs(status, run_after)
  WHERE status IN ('queued', 'running');

CREATE INDEX idx_background_jobs_tenant
  ON background_jobs(tenant_id, created_at DESC);

CREATE INDEX idx_background_jobs_type
  ON background_jobs(tenant_id, job_type, status);

ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_background_jobs ON background_jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_background_jobs_updated_at BEFORE UPDATE ON background_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
