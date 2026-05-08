-- Migration 036: Mobile + Offline Field Execution
-- LUNA Phase 3 — Device registration, sync sessions, offline mutations, conflict resolution

BEGIN;

-- ─── Mobile device registry ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mobile_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  device_token    VARCHAR(255) NOT NULL UNIQUE,
  device_name     VARCHAR(120),
  device_platform VARCHAR(30),   -- 'ios' | 'android' | 'web'
  app_version     VARCHAR(30),
  push_token      VARCHAR(512),  -- FCM / APNs token
  last_seen_at    TIMESTAMPTZ,
  last_ip         INET,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mobile_devices_tenant_user_idx
  ON mobile_devices (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS mobile_devices_token_idx
  ON mobile_devices (device_token) WHERE is_active = TRUE;

-- ─── Sync sessions ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id       UUID NOT NULL REFERENCES mobile_devices(id),
  user_id         UUID NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  status          VARCHAR(30) NOT NULL DEFAULT 'in_progress',  -- in_progress | completed | failed | partial
  mutations_pushed INTEGER NOT NULL DEFAULT 0,
  mutations_pulled INTEGER NOT NULL DEFAULT 0,
  conflicts_detected INTEGER NOT NULL DEFAULT 0,
  conflicts_resolved INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  server_watermark TIMESTAMPTZ,  -- last server event time client is caught up to
  client_watermark TIMESTAMPTZ,  -- last client event time server processed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sync_sessions_device_idx
  ON sync_sessions (device_id, started_at DESC);
CREATE INDEX IF NOT EXISTS sync_sessions_tenant_status_idx
  ON sync_sessions (tenant_id, status);

-- ─── Offline mutation queue ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS offline_mutations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id       UUID NOT NULL REFERENCES mobile_devices(id),
  user_id         UUID NOT NULL,
  session_id      UUID REFERENCES sync_sessions(id),
  mutation_type   VARCHAR(60) NOT NULL,  -- 'create_punch_item' | 'update_inspection' | etc.
  entity_type     VARCHAR(60) NOT NULL,
  client_id       VARCHAR(128) NOT NULL, -- client-generated idempotency key
  payload         JSONB NOT NULL,
  attachments     JSONB NOT NULL DEFAULT '[]',  -- list of attachment refs
  status          VARCHAR(30) NOT NULL DEFAULT 'pending',
  -- pending | applied | conflicted | rejected | skipped
  applied_entity_id UUID,           -- server-assigned ID after apply
  conflict_id     UUID,             -- FK to offline_conflicts if conflicted
  created_offline_at TIMESTAMPTZ NOT NULL,  -- when action was taken offline
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at      TIMESTAMPTZ,
  error_message   TEXT,
  UNIQUE (tenant_id, device_id, client_id)
);

CREATE INDEX IF NOT EXISTS offline_mutations_status_idx
  ON offline_mutations (tenant_id, status, received_at);
CREATE INDEX IF NOT EXISTS offline_mutations_session_idx
  ON offline_mutations (session_id) WHERE session_id IS NOT NULL;

-- ─── Offline conflicts ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS offline_conflicts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mutation_id     UUID NOT NULL REFERENCES offline_mutations(id),
  entity_type     VARCHAR(60) NOT NULL,
  entity_id       UUID,
  client_version  JSONB NOT NULL,   -- what the client sent
  server_version  JSONB NOT NULL,   -- what the server had at receive time
  conflict_type   VARCHAR(60) NOT NULL,  -- 'concurrent_edit' | 'deleted_on_server' | 'schema_mismatch'
  resolution      VARCHAR(30),           -- 'client_wins' | 'server_wins' | 'merged' | 'rejected' | NULL (unresolved)
  resolved_by     UUID,
  resolved_at     TIMESTAMPTZ,
  merge_result    JSONB,            -- final merged payload if resolution = 'merged'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS offline_conflicts_tenant_resolution_idx
  ON offline_conflicts (tenant_id, resolution, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE mobile_devices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_mutations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE offline_conflicts  ENABLE ROW LEVEL SECURITY;

CREATE POLICY mobile_devices_tenant ON mobile_devices
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY sync_sessions_tenant ON sync_sessions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY offline_mutations_tenant ON offline_mutations
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY offline_conflicts_tenant ON offline_conflicts
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

COMMIT;
