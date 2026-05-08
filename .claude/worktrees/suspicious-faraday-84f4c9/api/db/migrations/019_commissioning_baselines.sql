-- ============================================================
-- JARVIS EPC — Migration 019: Commissioning Baselines + Observations
-- v4.31.0 | Rolling statistical novelty detection for numeric criteria
--
-- One baseline row per (scope, system_type, criteria_name). Same scope
-- precedence as autosign rules (project > client > global). Maintains
-- running aggregates updated atomically on each passing observation;
-- the arbiter uses mean + std_dev to flag novel readings even when the
-- hard rule tolerance passes.
--
-- Why IQR (p25/p75) alongside mean/std:
--   mean/std  → z-score for novelty flag
--   p25/p75   → IQR band displayed in admin UI; robust visualization
--               even when distribution is skewed
--
-- Boolean criteria (autosign_criteria_kind='boolean') DO NOT get
-- baseline rows — they short-circuit to hard pass/fail.
--
-- Future-proofing note (not implemented v1 but reserved):
--   Additional scope dimensions (season, equipment_subtype, operating_mode)
--   can be added as columns + widened into the unique constraint without
--   breaking existing rows. If you need bimodal-by-mode baselines later,
--   ALTER TABLE ADD COLUMN operating_mode ... and extend the constraint.
-- ============================================================

CREATE TABLE commissioning_baselines (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  scope           VARCHAR(16) NOT NULL
                  CHECK (scope IN ('global','client','project')),
  client_id       VARCHAR(128),
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,

  system_type     VARCHAR(64)  NOT NULL,
  criteria_name   VARCHAR(128) NOT NULL,

  -- Rolling aggregates. Updated atomically after each passing observation.
  sample_count    INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  mean_value      NUMERIC(18,4),
  std_dev         NUMERIC(18,4),
  min_observed    NUMERIC(18,4),
  max_observed    NUMERIC(18,4),
  p25_value       NUMERIC(18,4),
  p75_value       NUMERIC(18,4),
  last_sample_at  TIMESTAMPTZ,

  -- Rolling window — observations older than window_days are excluded
  -- on recompute. window_days=0 means "all observations", which is fine
  -- for small datasets where recency doesn't matter yet.
  window_days     INTEGER NOT NULL DEFAULT 90 CHECK (window_days >= 0),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One baseline per (tenant, scope tuple, system_type, criteria_name).
  -- Listing client_id and project_id in the constraint means NULLs group
  -- together correctly (Postgres treats NULL = NULL as unknown inside
  -- UNIQUE, but the multi-column form works here because NULLs in a
  -- composite key behave as distinct — that's actually what we want:
  -- a global rule with NULL client_id/project_id has exactly one row.)
  CONSTRAINT baselines_scope_unique
    UNIQUE (tenant_id, scope, client_id, project_id, system_type, criteria_name)
);

CREATE INDEX idx_baselines_tenant
  ON commissioning_baselines(tenant_id, updated_at DESC);

CREATE INDEX idx_baselines_lookup
  ON commissioning_baselines(tenant_id, system_type, criteria_name, scope);

ALTER TABLE commissioning_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_baselines ON commissioning_baselines
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_baselines_updated_at BEFORE UPDATE ON commissioning_baselines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- OBSERVATIONS
-- Raw pass/fail/queued events. Kept so baselines can be recomputed
-- from history when window_days changes, and so the admin UI can
-- display a scatter of recent readings on the Baselines tab.
-- ──────────────────────────────────────────────────────────────

CREATE TABLE commissioning_observations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  baseline_id      UUID NOT NULL REFERENCES commissioning_baselines(id) ON DELETE CASCADE,
  pack_id          UUID REFERENCES commissioning_packs(id) ON DELETE SET NULL,
  rule_id          UUID REFERENCES commissioning_autosign_rules(id) ON DELETE SET NULL,

  value            NUMERIC(18,4) NOT NULL,
  decision         VARCHAR(32) NOT NULL,            -- 'auto_pass'|'auto_fail'|'queued_novelty'|'queued_warmup'|'human_pass'|'human_fail'
  decision_reason  TEXT NOT NULL,                   -- durable: "rule_pass; z=0.7 so auto_pass"
  z_score          NUMERIC(10,4),                   -- null when baseline not yet established

  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_observations_baseline_time
  ON commissioning_observations(baseline_id, created_at DESC);

CREATE INDEX idx_observations_tenant_time
  ON commissioning_observations(tenant_id, created_at DESC);

ALTER TABLE commissioning_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_observations ON commissioning_observations
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
