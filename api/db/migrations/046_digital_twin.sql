-- Denver Engineering — Migration 046: Operational Digital Twin (v6.0.0)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates tables for digital twin registry, state snapshots, relationship graph,
-- event links, scenario simulations, anomaly records, and forecast cache.

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE twin_entity_type AS ENUM (
  'project', 'system', 'subsystem', 'equipment', 'tag',
  'workflow', 'action', 'inspection', 'deficiency',
  'permit', 'vendor', 'workforce', 'site', 'region'
);

CREATE TYPE twin_status AS ENUM (
  'active', 'inactive', 'degraded', 'failed', 'maintenance', 'decommissioned'
);

CREATE TYPE twin_rel_type AS ENUM (
  'depends_on', 'blocks', 'contains', 'feeds_into', 'peer',
  'owns', 'inspects', 'permits', 'maintains'
);

CREATE TYPE anomaly_severity AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE scenario_status AS ENUM (
  'pending', 'running', 'completed', 'failed', 'cancelled'
);

-- ─── Digital twin registry ────────────────────────────────────────────────────

CREATE TABLE operational_twins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  entity_type     twin_entity_type NOT NULL,
  entity_id       text NOT NULL,    -- FK to the source entity (project id, system id, etc.)
  name            text NOT NULL,
  description     text,
  status          twin_status NOT NULL DEFAULT 'active',
  metadata        jsonb NOT NULL DEFAULT '{}',
  readiness_score numeric(5,2),
  risk_score      numeric(5,2),
  health_score    numeric(5,2),
  last_synced_at  timestamptz,
  sync_lag_ms     int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, entity_type, entity_id)
);

-- ─── Twin state snapshots ─────────────────────────────────────────────────────

CREATE TABLE twin_state_snapshots (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  twin_id         uuid NOT NULL REFERENCES operational_twins(id) ON DELETE CASCADE,
  snapshot_at     timestamptz NOT NULL DEFAULT now(),
  sequence_num    bigint NOT NULL,
  state           jsonb NOT NULL,           -- full state capture
  diff            jsonb,                    -- diff from previous snapshot
  checksum        text NOT NULL,            -- SHA-256 of state for integrity
  triggering_event_id text,                 -- event that caused this snapshot
  UNIQUE(twin_id, sequence_num)
);

-- ─── Twin relationship graph ──────────────────────────────────────────────────

CREATE TABLE twin_relationships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  from_twin_id    uuid NOT NULL REFERENCES operational_twins(id) ON DELETE CASCADE,
  to_twin_id      uuid NOT NULL REFERENCES operational_twins(id) ON DELETE CASCADE,
  rel_type        twin_rel_type NOT NULL,
  weight          numeric(5,2) NOT NULL DEFAULT 1.0,
  metadata        jsonb NOT NULL DEFAULT '{}',
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(from_twin_id, to_twin_id, rel_type)
);

-- ─── Twin event links ─────────────────────────────────────────────────────────

CREATE TABLE twin_event_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  twin_id         uuid NOT NULL REFERENCES operational_twins(id) ON DELETE CASCADE,
  event_id        text NOT NULL,            -- realtime_event_log.id
  event_type      text NOT NULL,
  state_delta     jsonb NOT NULL DEFAULT '{}',
  occurred_at     timestamptz NOT NULL,
  applied         boolean NOT NULL DEFAULT false
);

-- ─── Anomaly records ──────────────────────────────────────────────────────────

CREATE TABLE operational_anomalies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  twin_id         uuid REFERENCES operational_twins(id),
  anomaly_type    text NOT NULL,
  severity        anomaly_severity NOT NULL,
  anomaly_score   numeric(5,2) NOT NULL CHECK (anomaly_score BETWEEN 0 AND 100),
  impacted_entities jsonb NOT NULL DEFAULT '[]',
  explanation     text NOT NULL,
  suggested_actions jsonb NOT NULL DEFAULT '[]',
  baseline_value  numeric,
  observed_value  numeric,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  false_positive  boolean NOT NULL DEFAULT false,
  metadata        jsonb NOT NULL DEFAULT '{}'
);

-- ─── Scenario simulations ─────────────────────────────────────────────────────

CREATE TABLE scenario_simulations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  name            text NOT NULL,
  scenario_type   text NOT NULL,
  status          scenario_status NOT NULL DEFAULT 'pending',
  config          jsonb NOT NULL DEFAULT '{}',
  base_snapshot_id uuid REFERENCES twin_state_snapshots(id),
  injected_events jsonb NOT NULL DEFAULT '[]',
  results         jsonb,
  projected_readiness_impact numeric(5,2),
  projected_sla_impact       numeric(5,2),
  confidence_score           numeric(5,2),
  isolation_token text NOT NULL DEFAULT gen_random_uuid()::text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

-- ─── Forecast cache ───────────────────────────────────────────────────────────

CREATE TABLE operational_forecasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  forecast_type   text NOT NULL,
  scope_type      text NOT NULL,
  scope_id        text NOT NULL,
  horizon_days    int NOT NULL DEFAULT 30,
  projections     jsonb NOT NULL DEFAULT '{}',
  confidence      numeric(5,2),
  computed_at     timestamptz NOT NULL DEFAULT now(),
  valid_until     timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  UNIQUE(tenant_id, forecast_type, scope_type, scope_id, horizon_days)
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_twins_tenant_type      ON operational_twins(tenant_id, entity_type);
CREATE INDEX idx_twins_entity           ON operational_twins(tenant_id, entity_type, entity_id);
CREATE INDEX idx_twin_snapshots_twin    ON twin_state_snapshots(twin_id, sequence_num DESC);
CREATE INDEX idx_twin_snapshots_time    ON twin_state_snapshots(twin_id, snapshot_at DESC);
CREATE INDEX idx_twin_rels_from         ON twin_relationships(from_twin_id);
CREATE INDEX idx_twin_rels_to           ON twin_relationships(to_twin_id);
CREATE INDEX idx_twin_rels_tenant_type  ON twin_relationships(tenant_id, rel_type);
CREATE INDEX idx_twin_event_links_twin  ON twin_event_links(twin_id, occurred_at DESC);
CREATE INDEX idx_anomalies_tenant       ON operational_anomalies(tenant_id, severity);
CREATE INDEX idx_anomalies_twin         ON operational_anomalies(twin_id);
CREATE INDEX idx_scenarios_tenant       ON scenario_simulations(tenant_id, status);
CREATE INDEX idx_forecasts_lookup       ON operational_forecasts(tenant_id, forecast_type, scope_type, scope_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE operational_twins         ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin_state_snapshots      ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin_relationships        ENABLE ROW LEVEL SECURITY;
ALTER TABLE twin_event_links          ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_anomalies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scenario_simulations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_forecasts     ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON operational_twins
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON twin_state_snapshots
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON twin_relationships
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON twin_event_links
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON operational_anomalies
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON scenario_simulations
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON operational_forecasts
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
