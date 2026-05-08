-- Migration 047: Adaptive Intelligence + Autonomous Optimization
-- Denver Engineering — Ava Phase 7 (v7.0.0)

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE feedback_outcome AS ENUM (
  'accepted',
  'rejected',
  'partially_accepted',
  'deferred',
  'superseded',
  'unknown'
);

CREATE TYPE learning_signal AS ENUM (
  'positive',
  'negative',
  'neutral',
  'mixed'
);

CREATE TYPE optimization_status AS ENUM (
  'proposed',
  'approved',
  'applied',
  'rejected',
  'expired'
);

CREATE TYPE drift_severity AS ENUM (
  'none',
  'minor',
  'moderate',
  'significant',
  'critical'
);

-- ─── Learning Feedback ───────────────────────────────────────────────────────
-- Immutable append-only record of every recommendation outcome

CREATE TABLE learning_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  feedback_type   TEXT NOT NULL,         -- 'recommendation' | 'forecast' | 'anomaly' | 'scenario'
  source_id       UUID NOT NULL,         -- recommendation_id, forecast_id, anomaly_id, etc.
  source_type     TEXT NOT NULL,
  agent_type      TEXT,
  signal          learning_signal NOT NULL DEFAULT 'unknown',
  outcome         feedback_outcome NOT NULL DEFAULT 'unknown',
  context         JSONB NOT NULL DEFAULT '{}',
  metadata        JSONB NOT NULL DEFAULT '{}',
  recorded_by     TEXT,                  -- 'user' | 'system' | 'agent'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lf_tenant           ON learning_feedback (tenant_id);
CREATE INDEX idx_lf_source           ON learning_feedback (source_type, source_id);
CREATE INDEX idx_lf_feedback_type    ON learning_feedback (feedback_type, tenant_id);
CREATE INDEX idx_lf_created          ON learning_feedback (created_at);
CREATE INDEX idx_lf_signal           ON learning_feedback (signal, tenant_id);

ALTER TABLE learning_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON learning_feedback
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Recommendation Outcomes ─────────────────────────────────────────────────
-- Tracks effectiveness of each recommendation over time

CREATE TABLE recommendation_outcomes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  recommendation_id    UUID NOT NULL,
  recommendation_type  TEXT NOT NULL,
  agent_type           TEXT NOT NULL,
  entity_id            UUID,
  entity_type          TEXT,
  outcome              feedback_outcome NOT NULL DEFAULT 'unknown',
  effectiveness_score  NUMERIC(5,2),      -- 0–100
  before_state         JSONB,
  after_state          JSONB,
  measured_at          TIMESTAMPTZ,
  feedback_lag_ms      BIGINT,            -- time from recommendation to outcome measurement
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ro_tenant           ON recommendation_outcomes (tenant_id);
CREATE INDEX idx_ro_rec_id           ON recommendation_outcomes (recommendation_id);
CREATE INDEX idx_ro_agent_type       ON recommendation_outcomes (agent_type, tenant_id);
CREATE INDEX idx_ro_entity           ON recommendation_outcomes (entity_type, entity_id);
CREATE INDEX idx_ro_effectiveness    ON recommendation_outcomes (effectiveness_score DESC);
CREATE INDEX idx_ro_created          ON recommendation_outcomes (created_at);

ALTER TABLE recommendation_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recommendation_outcomes
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Forecast Accuracy History ───────────────────────────────────────────────
-- Tracks predicted vs actual for continuous forecast calibration

CREATE TABLE forecast_accuracy_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL,
  forecast_type    TEXT NOT NULL,         -- 'readiness' | 'risk' | 'workload' | 'sla' | 'maintenance'
  entity_id        UUID,
  entity_type      TEXT,
  forecast_horizon INT NOT NULL,          -- days
  predicted_value  NUMERIC(8,4) NOT NULL,
  actual_value     NUMERIC(8,4),
  predicted_at     TIMESTAMPTZ NOT NULL,
  measured_at      TIMESTAMPTZ,
  absolute_error   NUMERIC(8,4),          -- |predicted - actual|
  squared_error    NUMERIC(12,4),         -- (predicted - actual)^2
  confidence       NUMERIC(5,4),          -- 0–1
  drift_severity   drift_severity NOT NULL DEFAULT 'none',
  metadata         JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fah_tenant          ON forecast_accuracy_history (tenant_id);
CREATE INDEX idx_fah_type_entity     ON forecast_accuracy_history (forecast_type, entity_id);
CREATE INDEX idx_fah_predicted_at    ON forecast_accuracy_history (predicted_at);
CREATE INDEX idx_fah_measured_at     ON forecast_accuracy_history (measured_at);
CREATE INDEX idx_fah_horizon         ON forecast_accuracy_history (forecast_horizon, tenant_id);
CREATE INDEX idx_fah_drift           ON forecast_accuracy_history (drift_severity, tenant_id);

ALTER TABLE forecast_accuracy_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON forecast_accuracy_history
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Optimization Feedback ───────────────────────────────────────────────────
-- Records every optimization action proposed, approved, and applied

CREATE TABLE optimization_feedback (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  optimization_type TEXT NOT NULL,        -- 'resource' | 'workload' | 'scheduling' | 'risk' | 'capacity'
  proposed_by       TEXT NOT NULL,        -- agent_type
  entity_ids        UUID[] NOT NULL DEFAULT '{}',
  entity_type       TEXT,
  status            optimization_status NOT NULL DEFAULT 'proposed',
  proposal          JSONB NOT NULL DEFAULT '{}',
  rationale         TEXT,
  expected_gain     NUMERIC(5,2),         -- 0–100 expected improvement
  actual_gain       NUMERIC(5,2),         -- 0–100 measured gain (populated after apply)
  approved_by       TEXT,
  applied_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_of_tenant           ON optimization_feedback (tenant_id);
CREATE INDEX idx_of_status           ON optimization_feedback (status, tenant_id);
CREATE INDEX idx_of_proposed_by      ON optimization_feedback (proposed_by, tenant_id);
CREATE INDEX idx_of_type             ON optimization_feedback (optimization_type, tenant_id);
CREATE INDEX idx_of_created          ON optimization_feedback (created_at);
CREATE INDEX idx_of_entity_type      ON optimization_feedback (entity_type, tenant_id);

ALTER TABLE optimization_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON optimization_feedback
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
