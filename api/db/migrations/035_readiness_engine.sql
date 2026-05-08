-- Migration 035: Readiness Engine
-- LUNA Phase 3 — Operational readiness scoring tables

BEGIN;

-- ─── Readiness domain enum ───────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE readiness_domain AS ENUM (
    'project', 'system', 'subsystem', 'commissioning',
    'safety', 'compliance', 'turnover'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE readiness_state AS ENUM (
    'not_ready', 'at_risk', 'conditionally_ready', 'ready'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Readiness thresholds (configurable per tenant) ──────────────────────────

CREATE TABLE IF NOT EXISTS readiness_thresholds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain        readiness_domain NOT NULL,
  not_ready_below      NUMERIC(5,2) NOT NULL DEFAULT 40,
  at_risk_below        NUMERIC(5,2) NOT NULL DEFAULT 65,
  conditionally_ready_below NUMERIC(5,2) NOT NULL DEFAULT 85,
  -- weights for sub-components (must sum to 1.0)
  weight_open_actions  NUMERIC(4,3) DEFAULT 0.30,
  weight_blockers      NUMERIC(4,3) DEFAULT 0.25,
  weight_sla_health    NUMERIC(4,3) DEFAULT 0.20,
  weight_inspections   NUMERIC(4,3) DEFAULT 0.15,
  weight_escalations   NUMERIC(4,3) DEFAULT 0.10,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, domain)
);

-- ─── Readiness scores (current state) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS readiness_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain          readiness_domain NOT NULL,
  entity_id       UUID NOT NULL,  -- project_id, system_id, subsystem_id, etc.
  entity_type     VARCHAR(60) NOT NULL,
  readiness_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  readiness_state readiness_state NOT NULL DEFAULT 'not_ready',
  blocking_factors JSONB NOT NULL DEFAULT '[]',
  predicted_completion_risk NUMERIC(5,2),
  component_scores JSONB NOT NULL DEFAULT '{}', -- { open_actions: 80, blockers: 60, ... }
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, domain, entity_id)
);

CREATE INDEX IF NOT EXISTS readiness_scores_tenant_state_idx
  ON readiness_scores (tenant_id, readiness_state, readiness_score);

CREATE INDEX IF NOT EXISTS readiness_scores_entity_idx
  ON readiness_scores (tenant_id, entity_id, domain);

-- ─── Readiness snapshots (historical) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS readiness_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL,
  domain          readiness_domain NOT NULL,
  entity_id       UUID NOT NULL,
  entity_type     VARCHAR(60) NOT NULL,
  readiness_score NUMERIC(5,2) NOT NULL,
  readiness_state readiness_state NOT NULL,
  blocking_factors JSONB NOT NULL DEFAULT '[]',
  component_scores JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, snapshot_date, domain, entity_id)
);

CREATE INDEX IF NOT EXISTS readiness_snapshots_trend_idx
  ON readiness_snapshots (tenant_id, entity_id, domain, snapshot_date DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE readiness_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE readiness_scores     ENABLE ROW LEVEL SECURITY;
ALTER TABLE readiness_snapshots  ENABLE ROW LEVEL SECURITY;

CREATE POLICY readiness_thresholds_tenant ON readiness_thresholds
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY readiness_scores_tenant ON readiness_scores
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY readiness_snapshots_tenant ON readiness_snapshots
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

COMMIT;
