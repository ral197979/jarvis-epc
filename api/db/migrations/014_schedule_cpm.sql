-- ============================================================
-- JARVIS EPC — Migration 014: Schedule + Critical Path (CPM-lite)
-- v4.31.0 | Minimal CPM primitive — tasks + FS dependencies
--
-- Scope is deliberately narrow: Finish-to-Start dependencies only
-- (with optional lag_days), no resource leveling, no multi-calendar,
-- no hammocks. This covers ~90% of small/mid-project scheduling needs
-- and gives consumers a working earliest/latest/float calculation.
--
-- Primavera P6 it is not. But it's a real CPM engine, versioned and
-- testable, and new dependency types (SS/FF/SF) can be added here as
-- an enum extension plus branches in api/services/cpm.ts.
-- ============================================================

CREATE TABLE schedule_tasks (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id     UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  name           VARCHAR(255) NOT NULL,
  wbs_code       VARCHAR(64),                  -- optional hierarchical code, e.g. '1.2.3'
  description    TEXT,

  -- Duration in working days. Milestones have duration 0 by convention.
  duration_days  INTEGER      NOT NULL DEFAULT 0 CHECK (duration_days >= 0),
  is_milestone   BOOLEAN      NOT NULL DEFAULT FALSE,

  -- Actual execution data. Not used by the CPM pass; surfaced for reporting
  -- and for comparing planned-vs-actual elsewhere.
  actual_start   DATE,
  actual_finish  DATE,
  status         VARCHAR(20)  NOT NULL DEFAULT 'not_started',
                              -- 'not_started' | 'in_progress' | 'complete'

  created_by     UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedule_tasks_project ON schedule_tasks(project_id);
CREATE INDEX idx_schedule_tasks_tenant  ON schedule_tasks(tenant_id, created_at DESC);

ALTER TABLE schedule_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_schedule_tasks ON schedule_tasks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_schedule_tasks_updated_at BEFORE UPDATE ON schedule_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- Dependencies. Finish-to-Start only for v1. lag_days can be
-- negative to express lead (parallelism) — e.g. lag_days = -2
-- means the successor may start 2 days before predecessor finishes.
-- ──────────────────────────────────────────────────────────────

CREATE TABLE schedule_dependencies (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  predecessor_id    UUID        NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  successor_id      UUID        NOT NULL REFERENCES schedule_tasks(id) ON DELETE CASCADE,
  lag_days          INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT schedule_deps_distinct  CHECK (predecessor_id <> successor_id),
  CONSTRAINT schedule_deps_unique    UNIQUE (predecessor_id, successor_id)
);

CREATE INDEX idx_schedule_deps_succ ON schedule_dependencies(successor_id);
CREATE INDEX idx_schedule_deps_pred ON schedule_dependencies(predecessor_id);

ALTER TABLE schedule_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_schedule_deps ON schedule_dependencies
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
