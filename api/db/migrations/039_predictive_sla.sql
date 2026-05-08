-- Migration 039: Predictive SLA Analytics
-- LUNA Phase 3 — Breach prediction models, staffing risk, bottleneck detection

BEGIN;

-- ─── Resolution time samples (for baseline model training) ───────────────────

CREATE TABLE IF NOT EXISTS action_resolution_samples (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_id       UUID NOT NULL,
  action_type     VARCHAR(60) NOT NULL,
  priority        VARCHAR(20) NOT NULL,
  system_type     VARCHAR(60),
  project_id      UUID,
  assigned_user_id UUID,
  -- timings
  created_at_utc  TIMESTAMPTZ NOT NULL,
  resolved_at_utc TIMESTAMPTZ NOT NULL,
  resolution_hours NUMERIC(10,2) NOT NULL,
  was_escalated   BOOLEAN NOT NULL DEFAULT FALSE,
  escalation_count INTEGER NOT NULL DEFAULT 0,
  was_reopened    BOOLEAN NOT NULL DEFAULT FALSE,
  reopen_count    INTEGER NOT NULL DEFAULT 0,
  sla_breached    BOOLEAN NOT NULL DEFAULT FALSE,
  blocker_count   INTEGER NOT NULL DEFAULT 0,
  -- context at resolution
  final_assignee_workload INTEGER,  -- open actions assigned to resolver at time of resolution
  sampled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS action_resolution_samples_type_priority_idx
  ON action_resolution_samples (tenant_id, action_type, priority);
CREATE INDEX IF NOT EXISTS action_resolution_samples_project_idx
  ON action_resolution_samples (tenant_id, project_id) WHERE project_id IS NOT NULL;

-- ─── Breach predictions (point-in-time estimates per action) ─────────────────

CREATE TABLE IF NOT EXISTS sla_breach_predictions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_id             UUID NOT NULL,
  breach_probability    NUMERIC(5,4) NOT NULL CHECK (breach_probability BETWEEN 0 AND 1),
  predicted_delay_hours NUMERIC(10,2),  -- NULL if predicted to resolve on time
  staffing_risk_score   NUMERIC(5,2),   -- 0-100
  bottleneck_factors    JSONB NOT NULL DEFAULT '[]',
  model_version         VARCHAR(30) NOT NULL DEFAULT 'deterministic-v1',
  feature_vector        JSONB,          -- for future ML audit trail
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL,  -- prediction validity window
  UNIQUE (tenant_id, action_id)
);

CREATE INDEX IF NOT EXISTS sla_breach_predictions_high_risk_idx
  ON sla_breach_predictions (tenant_id, breach_probability DESC)
  WHERE breach_probability > 0.6;

CREATE INDEX IF NOT EXISTS sla_breach_predictions_expires_idx
  ON sla_breach_predictions (expires_at);

-- ─── Staffing risk snapshots ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staffing_risk_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL,
  user_id         UUID NOT NULL,
  open_count      INTEGER NOT NULL DEFAULT 0,
  overdue_count   INTEGER NOT NULL DEFAULT 0,
  critical_count  INTEGER NOT NULL DEFAULT 0,
  avg_age_hours   NUMERIC(10,2) NOT NULL DEFAULT 0,
  risk_score      NUMERIC(5,2) NOT NULL DEFAULT 0,
  risk_level      VARCHAR(20) NOT NULL DEFAULT 'low',  -- low | medium | high | critical
  predicted_breach_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, snapshot_date, user_id)
);

CREATE INDEX IF NOT EXISTS staffing_risk_snapshots_date_idx
  ON staffing_risk_snapshots (tenant_id, snapshot_date DESC, risk_score DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE action_resolution_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_breach_predictions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffing_risk_snapshots   ENABLE ROW LEVEL SECURITY;

CREATE POLICY action_resolution_samples_tenant ON action_resolution_samples
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY sla_breach_predictions_tenant ON sla_breach_predictions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY staffing_risk_snapshots_tenant ON staffing_risk_snapshots
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

COMMIT;
