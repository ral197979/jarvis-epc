-- ============================================================
-- JARVIS EPC — Migration 004: Integrations Registry
-- v4.26.0 | External system connections, webhooks, sync log
-- ============================================================

CREATE TYPE integration_type   AS ENUM ('procore', 'sap', 'oracle_primavera', 'ms_project', 'aconex', 'autodesk_bim360', 'custom_webhook', 'email', 'slack', 'teams');
CREATE TYPE integration_status AS ENUM ('pending', 'active', 'error', 'disabled');
CREATE TYPE sync_direction     AS ENUM ('push', 'pull', 'bidirectional');
CREATE TYPE sync_status        AS ENUM ('pending', 'running', 'success', 'partial', 'failed', 'cancelled');
CREATE TYPE webhook_event      AS ENUM (
  'project.created', 'project.updated', 'project.phase_changed',
  'po.created',      'po.approved',     'po.received',
  'rfi.created',     'rfi.answered',
  'submittal.created','submittal.approved', 'submittal.rejected',
  'wir.completed',   'wir.failed',
  'risk.escalated',
  'document.uploaded', 'document.approved',
  'action.created',  'action.overdue',   'action.completed'
);

-- ──────────────────────────────────────────────────────────────
-- INTEGRATION CONNECTIONS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE integrations (
  id              UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID              NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            VARCHAR(255)      NOT NULL,
  type            integration_type  NOT NULL,
  status          integration_status NOT NULL DEFAULT 'pending',
  direction       sync_direction    NOT NULL DEFAULT 'bidirectional',
  base_url        VARCHAR(512),
  -- Credentials stored encrypted (application-level AES-256)
  credentials     BYTEA,
  config          JSONB             NOT NULL DEFAULT '{}',
  field_mappings  JSONB             NOT NULL DEFAULT '{}',
  last_sync_at    TIMESTAMPTZ,
  last_error      TEXT,
  sync_enabled    BOOLEAN           NOT NULL DEFAULT false,
  sync_interval   INTEGER           NOT NULL DEFAULT 3600,  -- seconds
  created_by      UUID              REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integrations_tenant ON integrations(tenant_id);
CREATE INDEX idx_integrations_type   ON integrations(tenant_id, type);
CREATE INDEX idx_integrations_status ON integrations(tenant_id, status);

ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_integrations ON integrations
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_integrations_updated_at BEFORE UPDATE ON integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- OUTBOUND WEBHOOKS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE webhooks (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            VARCHAR(255)  NOT NULL,
  url             VARCHAR(2048) NOT NULL,
  secret          VARCHAR(255)  NOT NULL,    -- HMAC-SHA256 signing secret
  events          webhook_event[] NOT NULL DEFAULT '{}',
  active          BOOLEAN       NOT NULL DEFAULT true,
  retry_max       INTEGER       NOT NULL DEFAULT 3,
  timeout_ms      INTEGER       NOT NULL DEFAULT 10000,
  headers         JSONB         NOT NULL DEFAULT '{}',  -- custom request headers
  last_triggered  TIMESTAMPTZ,
  last_status     INTEGER,
  failure_count   INTEGER       NOT NULL DEFAULT 0,
  created_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhooks_tenant ON webhooks(tenant_id);
CREATE INDEX idx_webhooks_active ON webhooks(tenant_id, active);

ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_webhooks ON webhooks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_webhooks_updated_at BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- WEBHOOK DELIVERY LOG
-- ──────────────────────────────────────────────────────────────

CREATE TABLE webhook_deliveries (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  webhook_id      UUID          NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event           webhook_event NOT NULL,
  payload         JSONB         NOT NULL,
  attempt         INTEGER       NOT NULL DEFAULT 1,
  status_code     INTEGER,
  response_body   TEXT,
  duration_ms     INTEGER,
  error           TEXT,
  next_attempt_at TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wd_webhook ON webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX idx_wd_tenant  ON webhook_deliveries(tenant_id, created_at DESC);
CREATE INDEX idx_wd_retry   ON webhook_deliveries(next_attempt_at) WHERE delivered_at IS NULL AND error IS NOT NULL;

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_wd ON webhook_deliveries
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ──────────────────────────────────────────────────────────────
-- SYNC JOBS LOG
-- ──────────────────────────────────────────────────────────────

CREATE TABLE sync_jobs (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id  UUID        NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  status          sync_status NOT NULL DEFAULT 'pending',
  direction       sync_direction NOT NULL,
  resource        VARCHAR(100),    -- e.g. 'projects', 'rfis', 'purchase_orders'
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  records_pushed  INTEGER     NOT NULL DEFAULT 0,
  records_pulled  INTEGER     NOT NULL DEFAULT 0,
  records_failed  INTEGER     NOT NULL DEFAULT 0,
  error_log       JSONB       NOT NULL DEFAULT '[]',
  triggered_by    UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sync_tenant      ON sync_jobs(tenant_id, created_at DESC);
CREATE INDEX idx_sync_integration ON sync_jobs(integration_id, created_at DESC);
CREATE INDEX idx_sync_status      ON sync_jobs(tenant_id, status);

ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sync ON sync_jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Grant new tables to app role
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jarvis_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jarvis_app;
