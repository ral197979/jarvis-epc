-- Migration 038: Operational Command Center
-- LUNA Phase 3 — Incidents, supervisor commands, audit trail

BEGIN;

DO $$ BEGIN
  CREATE TYPE ops_command_type AS ENUM (
    'reassign', 'bulk_escalate', 'freeze', 'unfreeze',
    'emergency_override', 'bulk_reassign', 'force_complete', 'war_room_activate'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE incident_severity AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Operational incidents ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ops_incidents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      UUID,
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  severity        incident_severity NOT NULL DEFAULT 'medium',
  status          VARCHAR(30) NOT NULL DEFAULT 'open',
  -- open | investigating | mitigated | resolved
  reported_by     UUID NOT NULL,
  assigned_to     UUID,
  related_action_ids UUID[] DEFAULT '{}',
  affected_systems   VARCHAR(60)[] DEFAULT '{}',
  resolution_notes TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ops_incidents_tenant_status_idx
  ON ops_incidents (tenant_id, status, severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ops_incidents_project_idx
  ON ops_incidents (tenant_id, project_id) WHERE project_id IS NOT NULL;

-- ─── Supervisor commands ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ops_commands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  command_type    ops_command_type NOT NULL,
  issued_by       UUID NOT NULL,
  -- targets
  target_action_ids UUID[] DEFAULT '{}',
  target_user_id  UUID,
  target_project_id UUID,
  -- params
  reason          TEXT NOT NULL,
  params          JSONB NOT NULL DEFAULT '{}',
  -- approval (for emergency overrides)
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by     UUID,
  approved_at     TIMESTAMPTZ,
  -- execution
  status          VARCHAR(30) NOT NULL DEFAULT 'pending',
  -- pending | approved | executing | completed | rejected | failed
  executed_at     TIMESTAMPTZ,
  result          JSONB,
  error           TEXT,
  correlation_id  VARCHAR(64),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ops_commands_tenant_status_idx
  ON ops_commands (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ops_commands_issuer_idx
  ON ops_commands (tenant_id, issued_by, created_at DESC);

-- ─── Asset scan events (QR/NFC) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asset_scan_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id        UUID NOT NULL,
  asset_type      VARCHAR(60) NOT NULL,  -- 'equipment' | 'system' | 'subsystem' | 'location'
  scan_method     VARCHAR(20) NOT NULL DEFAULT 'qr',  -- 'qr' | 'nfc' | 'manual'
  scanned_by      UUID NOT NULL,
  device_id       UUID REFERENCES mobile_devices(id),
  geolocation     JSONB,   -- { lat, lng, accuracy_meters }
  scan_context    VARCHAR(120),   -- 'inspection' | 'punch_item' | 'commissioning' | 'browse'
  action_taken    VARCHAR(60),    -- what the user did after scanning
  duration_seconds NUMERIC(6,2),  -- how long they stayed on the asset view
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asset_scan_events_asset_idx
  ON asset_scan_events (tenant_id, asset_id, asset_type, created_at DESC);
CREATE INDEX IF NOT EXISTS asset_scan_events_user_idx
  ON asset_scan_events (tenant_id, scanned_by, created_at DESC);

-- ─── Real-time event replay log ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS realtime_event_log (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type      VARCHAR(80) NOT NULL,
  payload         JSONB NOT NULL,
  subscription_scope VARCHAR(30) NOT NULL,  -- 'tenant' | 'project' | 'action' | etc.
  scope_id        VARCHAR(128),             -- the id of the scoped entity
  sequence_number BIGINT,
  correlation_id  VARCHAR(64),
  published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS realtime_event_log_tenant_seq_idx
  ON realtime_event_log (tenant_id, sequence_number DESC);
CREATE INDEX IF NOT EXISTS realtime_event_log_scope_idx
  ON realtime_event_log (tenant_id, subscription_scope, scope_id, published_at DESC);

-- Sequence for ordering
CREATE SEQUENCE IF NOT EXISTS realtime_event_seq START 1;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE ops_incidents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops_commands         ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_scan_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime_event_log   ENABLE ROW LEVEL SECURITY;

CREATE POLICY ops_incidents_tenant ON ops_incidents
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY ops_commands_tenant ON ops_commands
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY asset_scan_events_tenant ON asset_scan_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY realtime_event_log_tenant ON realtime_event_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

COMMIT;
