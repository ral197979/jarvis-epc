-- Denver Engineering — Migration 040: Autonomous Runbook Engine (v4.40.0)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates tables for operational runbooks, versioned step definitions,
-- execution tracking, step results, and approval checkpoints.

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE runbook_status AS ENUM (
  'draft', 'active', 'archived', 'deprecated'
);

CREATE TYPE runbook_execution_status AS ENUM (
  'pending', 'running', 'completed', 'failed',
  'rolled_back', 'waiting_approval', 'cancelled', 'dry_run_complete'
);

CREATE TYPE runbook_step_type AS ENUM (
  'create_action', 'assign_action', 'escalate_action', 'freeze_workflow',
  'request_approval', 'notify_users', 'generate_report', 'trigger_integration',
  'create_deficiency', 'create_inspection', 'update_readiness', 'wait', 'condition'
);

CREATE TYPE runbook_step_status AS ENUM (
  'pending', 'running', 'completed', 'failed',
  'skipped', 'rolled_back', 'waiting_approval'
);

-- ─── Runbook registry ────────────────────────────────────────────────────────

CREATE TABLE operational_runbooks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  name                text NOT NULL,
  description         text,
  trigger_type        text NOT NULL DEFAULT 'manual'
                        CHECK (trigger_type IN ('manual', 'scheduled', 'event', 'policy')),
  trigger_config      jsonb NOT NULL DEFAULT '{}',
  status              runbook_status NOT NULL DEFAULT 'draft',
  tags                text[] NOT NULL DEFAULT '{}',
  current_version_id  uuid,  -- set after first version created
  created_by          uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── Versioned step definitions ───────────────────────────────────────────────

CREATE TABLE runbook_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  runbook_id     uuid NOT NULL REFERENCES operational_runbooks(id) ON DELETE CASCADE,
  version        int NOT NULL DEFAULT 1,
  steps          jsonb NOT NULL DEFAULT '[]',    -- array of step definitions
  rollback_steps jsonb NOT NULL DEFAULT '[]',    -- reverse-ordered rollback steps
  change_notes   text,
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, runbook_id, version)
);

-- Back-reference: runbook.current_version_id → runbook_versions.id
ALTER TABLE operational_runbooks
  ADD CONSTRAINT fk_runbook_current_version
  FOREIGN KEY (current_version_id) REFERENCES runbook_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

-- ─── Execution records ───────────────────────────────────────────────────────

CREATE TABLE runbook_executions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  runbook_id       uuid NOT NULL REFERENCES operational_runbooks(id),
  version_id       uuid NOT NULL REFERENCES runbook_versions(id),
  status           runbook_execution_status NOT NULL DEFAULT 'pending',
  mode             text NOT NULL DEFAULT 'live'
                     CHECK (mode IN ('live', 'dry_run', 'simulation')),
  triggered_by     uuid NOT NULL,
  approved_by      uuid,
  correlation_id   text,
  context          jsonb NOT NULL DEFAULT '{}',   -- runtime variables
  current_step     int NOT NULL DEFAULT 0,
  total_steps      int NOT NULL DEFAULT 0,
  result_summary   jsonb,
  rollback_of      uuid REFERENCES runbook_executions(id),  -- set when this is a rollback
  error            text,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── Per-execution step instances ────────────────────────────────────────────

CREATE TABLE runbook_steps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  execution_id      uuid NOT NULL REFERENCES runbook_executions(id) ON DELETE CASCADE,
  step_index        int NOT NULL,
  step_type         runbook_step_type NOT NULL,
  step_config       jsonb NOT NULL DEFAULT '{}',
  status            runbook_step_status NOT NULL DEFAULT 'pending',
  requires_approval boolean NOT NULL DEFAULT false,
  approved_by       uuid,
  approved_at       timestamptz,
  idempotency_key   text,   -- prevents duplicate step execution on retry
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, execution_id, step_index)
);

-- ─── Immutable step result records ───────────────────────────────────────────

CREATE TABLE runbook_step_results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  step_id       uuid NOT NULL REFERENCES runbook_steps(id) ON DELETE CASCADE,
  outcome       text NOT NULL CHECK (outcome IN ('success', 'failure', 'skipped', 'dry_run')),
  output        jsonb NOT NULL DEFAULT '{}',   -- created entity IDs, etc.
  error         text,
  rollback_data jsonb,                         -- data needed to reverse this step
  duration_ms   int,
  executed_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_runbooks_tenant        ON operational_runbooks(tenant_id);
CREATE INDEX idx_runbook_versions_rb    ON runbook_versions(runbook_id);
CREATE INDEX idx_rb_executions_tenant   ON runbook_executions(tenant_id, status);
CREATE INDEX idx_rb_executions_runbook  ON runbook_executions(runbook_id);
CREATE INDEX idx_rb_steps_execution     ON runbook_steps(execution_id);
CREATE INDEX idx_rb_step_results_step   ON runbook_step_results(step_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE operational_runbooks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE runbook_versions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE runbook_executions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE runbook_steps             ENABLE ROW LEVEL SECURITY;
ALTER TABLE runbook_step_results      ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON operational_runbooks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON runbook_versions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON runbook_executions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON runbook_steps
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON runbook_step_results
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
