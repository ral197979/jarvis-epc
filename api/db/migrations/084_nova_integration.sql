-- ════════════════════════════════════════════════════════════════════════════
-- 084_nova_integration.sql — Nova ↔ Denver integration (ADR-001, v1)
-- ════════════════════════════════════════════════════════════════════════════
-- Nova (business operations) originates commercial projects and commands Denver
-- to create the linked EPC project; Denver publishes summarized progress and
-- turnover status back through a transactional outbox. Contracts live in
-- docs/integration/nova-denver/contracts/v1/. This migration is ADDITIVE and
-- behavior-neutral: nothing reads these tables until NOVA_EXTERNAL is enabled.
--
-- RLS decision (per-table, deliberate):
--   * nova_project_links / nova_inbound_commands — ENABLE + FORCE ROW LEVEL
--     SECURITY with the standard tenant_isolation policy (mirrors 081
--     cx_status_mirror / cx_inbound_events): these are only ever touched with
--     tenant context via tenantQuery()/tenantTransaction().
--   * nova_connections / nova_outbox — ENABLE (NOT FORCE) ROW LEVEL SECURITY,
--     mirroring background_jobs (009) and webhook_deliveries (004): the worker
--     drain and the pre-auth connection lookup in routes/novaCommands.ts run on
--     the privileged owner pool via plain query() WITHOUT tenant context
--     (connection resolution happens BEFORE a tenant is known; the outbox drain
--     spans tenants). PostgreSQL exempts the table OWNER from RLS unless FORCE
--     is set, so the owner pool can read these rows cross-tenant exactly like
--     it reads background_jobs, while the non-owner app role (jarvis_app,
--     NOBYPASSRLS, migration 075) remains fully constrained by the
--     tenant_isolation policy on the request path.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Connection registry: one row per provisioned Nova connection ────────────
-- Tenant is ALWAYS derived from this row (matched by connection_id + verified
-- HMAC), never from payload IDs. v1 provisioning is a documented bootstrap
-- insert (no self-service UI yet).
CREATE TABLE IF NOT EXISTS nova_connections (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  connection_id  TEXT         UNIQUE NOT NULL,
  nova_tenant_id TEXT         NOT NULL,
  nova_base_url  TEXT,
  status         TEXT         NOT NULL DEFAULT 'connected',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Project link: Denver project ↔ Nova project mapping ─────────────────────
-- last_summary_hash / last_turnover_state / last_event_at drive the snapshot
-- diff job (novaSnapshotDiff.ts): events are emitted only when the projected
-- summary or a turnover package actually changed.
CREATE TABLE IF NOT EXISTS nova_project_links (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id          UUID         UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connection_id       TEXT         NOT NULL,
  nova_project_id     TEXT         NOT NULL,
  nova_project_number TEXT,
  nova_project_url    TEXT,        -- relative path only (^/[A-Za-z0-9/_-]+$); non-conforming values are dropped
  nova_customer_name  TEXT,
  contract_number     TEXT,
  metadata            JSONB        NOT NULL DEFAULT '{}',
  last_summary_hash   TEXT,
  last_turnover_state JSONB        NOT NULL DEFAULT '{}',   -- { packageId: stateHash } for turnover diffing
  last_event_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, nova_project_id)
);

CREATE INDEX IF NOT EXISTS idx_nova_links_tenant ON nova_project_links(tenant_id, connection_id);

-- ─── Inbound command idempotency ledger ───────────────────────────────────────
-- UNIQUE (tenant_id, idempotency_key) is the idempotency key. request_digest is
-- the SHA-256 hex of the RAW request body: a replayed key with the SAME digest
-- returns the stored response (status already_exists); a replayed key with a
-- DIFFERENT digest is a 409 idempotency_conflict and never returns the original.
CREATE TABLE IF NOT EXISTS nova_inbound_commands (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  idempotency_key TEXT         NOT NULL,
  command         TEXT         NOT NULL,
  request_digest  TEXT,
  response        JSONB,
  status          TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, idempotency_key)
);

-- ─── Transactional outbox (Denver → Nova events) ──────────────────────────────
-- Rows are written IN THE SAME TRANSACTION as the state change they describe and
-- drained by the worker (novaOutbox.ts) with the connector-framework backoff
-- ladder [30s, 60s, 5m, 15m, 1h]; status 'dead' after 6 attempts.
-- seq is the sender-side monotonic sequence carried in every event envelope —
-- Nova's stale guard orders on (occurredAt, sequence).
CREATE TABLE IF NOT EXISTS nova_outbox (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             BIGINT       GENERATED ALWAYS AS IDENTITY,
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id        UUID         NOT NULL DEFAULT gen_random_uuid(),
  event_type      TEXT         NOT NULL,
  payload         JSONB        NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'queued',   -- queued | delivering | delivered | dead
  attempts        INTEGER      NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_error      TEXT,
  correlation_id  TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_nova_outbox_due    ON nova_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_nova_outbox_tenant ON nova_outbox(tenant_id, created_at DESC);

-- ─── updated_at triggers ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_nova_connections_updated_at ON nova_connections;
CREATE TRIGGER trg_nova_connections_updated_at BEFORE UPDATE ON nova_connections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_nova_project_links_updated_at ON nova_project_links;
CREATE TRIGGER trg_nova_project_links_updated_at BEFORE UPDATE ON nova_project_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_nova_outbox_updated_at ON nova_outbox;
CREATE TRIGGER trg_nova_outbox_updated_at BEFORE UPDATE ON nova_outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row-Level Security ───────────────────────────────────────────────────────
-- Tenant-context-only tables: ENABLE + FORCE (like 081).
ALTER TABLE nova_project_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_project_links    FORCE  ROW LEVEL SECURITY;
ALTER TABLE nova_inbound_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_inbound_commands FORCE  ROW LEVEL SECURITY;

-- Worker/pre-auth tables: ENABLE only (like background_jobs 009 /
-- webhook_deliveries 004) — see RLS decision in the header.
ALTER TABLE nova_connections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE nova_outbox           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON nova_project_links;
CREATE POLICY tenant_isolation ON nova_project_links
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON nova_inbound_commands;
CREATE POLICY tenant_isolation ON nova_inbound_commands
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON nova_connections;
CREATE POLICY tenant_isolation ON nova_connections
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON nova_outbox;
CREATE POLICY tenant_isolation ON nova_outbox
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON nova_connections      TO jarvis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON nova_project_links    TO jarvis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON nova_inbound_commands TO jarvis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON nova_outbox           TO jarvis_app;
