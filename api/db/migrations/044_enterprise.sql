-- Denver Engineering — Migration 044: Enterprise Infrastructure (v4.40.0)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates tables for integration connectors, export jobs, audit integrity
-- snapshots, and distributed worker leases (advisory locking without pg_advisory).

-- ─── Integration Connectors ───────────────────────────────────────────────────

CREATE TYPE connector_type AS ENUM (
  'slack', 'teams', 'email', 'erp', 'cmms', 'bacnet',
  'quickbooks', 'sap', 'oracle', 'webhook', 'custom'
);

CREATE TYPE connector_status AS ENUM (
  'active', 'inactive', 'error', 'configuring', 'paused'
);

CREATE TABLE integration_connectors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  name            text NOT NULL,
  connector_type  connector_type NOT NULL,
  status          connector_status NOT NULL DEFAULT 'configuring',
  config          jsonb NOT NULL DEFAULT '{}',   -- non-sensitive configuration
  credential_ref  text,                           -- reference key into encrypted vault
  health_score    int NOT NULL DEFAULT 100 CHECK (health_score BETWEEN 0 AND 100),
  consecutive_failures int NOT NULL DEFAULT 0,
  last_sync_at    timestamptz,
  last_error      text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integration_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  connector_id    uuid NOT NULL REFERENCES integration_connectors(id) ON DELETE CASCADE,
  job_type        text NOT NULL
                    CHECK (job_type IN ('sync', 'push', 'pull', 'health_check', 'test')),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed','dead_letter')),
  payload         jsonb NOT NULL DEFAULT '{}',
  result          jsonb,
  attempts        int NOT NULL DEFAULT 0,
  max_attempts    int NOT NULL DEFAULT 3,
  error           text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_by      text,
  claimed_at      timestamptz,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE(tenant_id, idempotency_key)
);

-- ─── Export Jobs ──────────────────────────────────────────────────────────────

CREATE TYPE export_status AS ENUM (
  'pending', 'running', 'completed', 'failed', 'expired'
);

CREATE TYPE export_format AS ENUM (
  'csv', 'json', 'parquet'
);

CREATE TABLE export_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  name            text NOT NULL,
  export_type     text NOT NULL,  -- 'analytics' | 'audit' | 'actions' | 'readiness' | 'events'
  format          export_format NOT NULL DEFAULT 'json',
  filters         jsonb NOT NULL DEFAULT '{}',
  status          export_status NOT NULL DEFAULT 'pending',
  row_count       int,
  file_size_bytes bigint,
  storage_key     text,
  download_url    text,
  url_expires_at  timestamptz,
  requested_by    uuid NOT NULL,
  worker_id       text,
  claimed_at      timestamptz,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  completed_at    timestamptz
);

-- ─── Audit Integrity Snapshots ────────────────────────────────────────────────

CREATE TABLE audit_integrity_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  snapshot_date     date NOT NULL DEFAULT CURRENT_DATE,
  event_count       int NOT NULL DEFAULT 0,
  chain_hash        text NOT NULL,   -- rolling SHA-256 over event IDs + sequences
  first_event_id    uuid,
  last_event_id     uuid,
  first_seq         bigint,
  last_seq          bigint,
  gaps_detected     int NOT NULL DEFAULT 0,   -- count of sequence gaps found
  integrity_status  text NOT NULL DEFAULT 'valid'
                      CHECK (integrity_status IN ('valid', 'tampered', 'gap_detected', 'empty')),
  verified_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, snapshot_date)
);

-- ─── Worker Leases (distributed locking) ─────────────────────────────────────
-- Replaces advisory locks with a DB-level lease table.
-- Workers claim a lease_key for a TTL; heartbeat renews the TTL.
-- Stale workers (heartbeat_at > expires_at) can be reclaimed.

CREATE TABLE worker_leases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid,          -- NULL = system-level lock (not tenant-scoped)
  lease_key      text NOT NULL, -- e.g., 'sla_worker', 'export_worker:tenant-uuid'
  worker_id      text NOT NULL, -- unique worker identifier (hostname + pid)
  acquired_at    timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  heartbeat_at   timestamptz NOT NULL DEFAULT now(),
  metadata       jsonb NOT NULL DEFAULT '{}',
  UNIQUE(lease_key)
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_connectors_tenant      ON integration_connectors(tenant_id, status);
CREATE INDEX idx_integration_jobs_claim ON integration_jobs(status, next_attempt_at)
  WHERE status = 'pending';
CREATE INDEX idx_export_jobs_tenant     ON export_jobs(tenant_id, status);
CREATE INDEX idx_export_jobs_claim      ON export_jobs(status) WHERE status = 'pending';
CREATE INDEX idx_audit_snapshots_tenant ON audit_integrity_snapshots(tenant_id, snapshot_date DESC);
CREATE INDEX idx_worker_leases_exp      ON worker_leases(expires_at) WHERE heartbeat_at < expires_at;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE integration_connectors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_jobs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_integrity_snapshots  ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON integration_connectors
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON integration_jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON export_jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON audit_integrity_snapshots
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- worker_leases is system-level; no RLS (accessed by system workers, not tenant users)
