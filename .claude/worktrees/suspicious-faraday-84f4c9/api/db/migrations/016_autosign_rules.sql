-- ============================================================
-- JARVIS EPC — Migration 016: Commissioning Auto-sign Rules
-- v4.31.0 | Tolerance-gated auto-approval for commissioning tests
--
-- Scope precedence (most specific wins):
--   project > client > global
--
-- criteria_kind splits the world:
--   numeric  → rule specifies tolerance_pct OR tolerance_abs + a target.
--              Baseline z-score check (019) also runs for these.
--   boolean  → rule is a pass/fail gate. No baseline, no z-score; either
--              the observation matches expected_bool or it doesn't.
--              Binary checklist items route here.
--
-- The arbiter (api/services/ciArbiter.ts) looks up rules in scope order,
-- runs the kind-specific check, and returns a structured decision_trail
-- for the agent_actions log.
-- ============================================================

CREATE TYPE autosign_criteria_kind AS ENUM ('numeric', 'boolean')
;

CREATE TABLE commissioning_autosign_rules (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  scope            VARCHAR(16) NOT NULL
                   CHECK (scope IN ('global','client','project')),
  client_id        VARCHAR(128),                  -- matches projects.client_name
  project_id       UUID REFERENCES projects(id) ON DELETE CASCADE,

  system_type      VARCHAR(64)  NOT NULL,         -- matches commissioning_packs.system_type
  criteria_name    VARCHAR(128) NOT NULL,         -- e.g. 'inlet_pressure_psig'
  criteria_kind    autosign_criteria_kind NOT NULL DEFAULT 'numeric',

  -- Numeric criteria (required when criteria_kind = 'numeric')
  target_value     NUMERIC(18,4),
  tolerance_pct    NUMERIC(6,3),
  tolerance_abs    NUMERIC(18,4),
  unit             VARCHAR(32),

  -- Boolean criteria (required when criteria_kind = 'boolean')
  expected_bool    BOOLEAN,

  enabled          BOOLEAN NOT NULL DEFAULT TRUE,

  -- Baseline warmup gate: until a paired baseline (019) has this many
  -- observations, rule-pass still queues for human. Per-rule override so
  -- high-risk rules can demand more history before auto-signing.
  baseline_min_samples INTEGER NOT NULL DEFAULT 30 CHECK (baseline_min_samples >= 0),

  -- Z-score threshold above which observations are flagged as novel and
  -- queued even if within tolerance. 2.5σ is a sensible default.
  novelty_z_threshold  NUMERIC(4,2) NOT NULL DEFAULT 2.5
                       CHECK (novelty_z_threshold > 0),

  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Numeric rules: exactly one tolerance specified, target required
  CONSTRAINT autosign_numeric_shape CHECK (
    criteria_kind <> 'numeric'
    OR (target_value IS NOT NULL
        AND ((tolerance_pct IS NOT NULL) <> (tolerance_abs IS NOT NULL)))
  ),
  -- Boolean rules: expected_bool required, numeric fields must be null
  CONSTRAINT autosign_boolean_shape CHECK (
    criteria_kind <> 'boolean'
    OR (expected_bool IS NOT NULL
        AND target_value IS NULL
        AND tolerance_pct IS NULL
        AND tolerance_abs IS NULL)
  )
);

CREATE INDEX idx_autosign_lookup
  ON commissioning_autosign_rules(tenant_id, system_type, criteria_name, scope)
  WHERE enabled = TRUE;

CREATE INDEX idx_autosign_tenant
  ON commissioning_autosign_rules(tenant_id, created_at DESC);

ALTER TABLE commissioning_autosign_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_autosign_rules ON commissioning_autosign_rules
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_autosign_rules_updated_at BEFORE UPDATE ON commissioning_autosign_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
