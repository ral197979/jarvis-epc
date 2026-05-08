-- Denver Engineering — Migration 042: Operational Simulation + Replay Engine (v4.40.0)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates tables for replayable operational simulations, what-if scenarios,
-- and projected result storage. No production mutations occur during simulation.

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE simulation_status AS ENUM (
  'pending', 'running', 'completed', 'failed', 'cancelled'
);

CREATE TYPE simulation_type AS ENUM (
  'replay',       -- replays historical events in order
  'what_if',      -- injects synthetic mutations
  'forecast',     -- forward-projects from current state
  'training'      -- generates synthetic scenarios for AI evaluation
);

-- ─── Simulation sessions ─────────────────────────────────────────────────────

CREATE TABLE simulation_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  simulation_type      simulation_type NOT NULL DEFAULT 'replay',
  status               simulation_status NOT NULL DEFAULT 'pending',
  config               jsonb NOT NULL DEFAULT '{}',

  -- Isolated snapshot of tenant state at start (no production references)
  context_snapshot     jsonb NOT NULL DEFAULT '{}',

  triggered_by         uuid NOT NULL,

  -- Replay window (for 'replay' and 'what_if' types)
  replay_from          timestamptz,
  replay_to            timestamptz,

  -- Replay integrity: SHA-256 of concatenated event IDs in replay order
  replay_checksum      text,
  events_replayed      int NOT NULL DEFAULT 0,

  -- Projected outcomes
  projected_readiness  numeric(5,2),
  projected_escalations int NOT NULL DEFAULT 0,
  projected_sla_breaches int NOT NULL DEFAULT 0,

  result_summary       jsonb,
  error                text,
  started_at           timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── Per-session event log (isolated from realtime_event_log) ────────────────

CREATE TABLE simulation_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  session_id      uuid NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  sequence_number int NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  source          text NOT NULL DEFAULT 'replay'
                    CHECK (source IN ('replay', 'synthetic', 'mutation', 'forecast')),
  original_event_id uuid,   -- FK to realtime_event_log for replay events
  simulated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, session_id, sequence_number)
);

-- ─── Simulation results ───────────────────────────────────────────────────────

CREATE TABLE simulation_results (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  session_id             uuid NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  projected_readiness    numeric(5,2),
  projected_escalations  int NOT NULL DEFAULT 0,
  projected_sla_breaches int NOT NULL DEFAULT 0,
  predicted_bottlenecks  jsonb NOT NULL DEFAULT '[]',
  impacted_systems       text[] NOT NULL DEFAULT '{}',

  -- Delta vs. current production state
  readiness_delta        numeric(5,2),   -- +/- from current
  risk_delta             numeric(5,2),

  -- What-if scenario projections
  what_if_scenarios      jsonb NOT NULL DEFAULT '[]',

  -- Per-entity state projections
  entity_projections     jsonb NOT NULL DEFAULT '[]',

  generated_at           timestamptz NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_sim_sessions_tenant   ON simulation_sessions(tenant_id, status);
CREATE INDEX idx_sim_events_session    ON simulation_events(session_id);
CREATE INDEX idx_sim_results_session   ON simulation_results(session_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE simulation_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_results   ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON simulation_sessions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON simulation_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON simulation_results
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
