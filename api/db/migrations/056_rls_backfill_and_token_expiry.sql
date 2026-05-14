-- Denver Engineering — v10.6.0
-- 1. RLS backfill: tenant_subscriptions, tenant_lifecycle_events, external_agent_executions
-- 2. IoT ingest token expiry (adds expires_at + default 90-day TTL on insert)

-- ─── RLS: tenant_subscriptions ────────────────────────────────────────────────

ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_subscriptions_tenant ON tenant_subscriptions;
CREATE POLICY tenant_subscriptions_tenant ON tenant_subscriptions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── RLS: tenant_lifecycle_events ────────────────────────────────────────────

ALTER TABLE tenant_lifecycle_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_lifecycle_events_tenant ON tenant_lifecycle_events;
CREATE POLICY tenant_lifecycle_events_tenant ON tenant_lifecycle_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── RLS: external_agent_executions ──────────────────────────────────────────
-- external_agents itself is a global registry (owner_tenant_id, cross-tenant) — no RLS.
-- executions are scoped to the calling tenant.

ALTER TABLE external_agent_executions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_agent_executions_tenant ON external_agent_executions;
CREATE POLICY external_agent_executions_tenant ON external_agent_executions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── IoT ingest token expiry ──────────────────────────────────────────────────

ALTER TABLE sensor_ingest_tokens
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Set a 90-day expiry for all existing non-revoked tokens
UPDATE sensor_ingest_tokens
SET expires_at = created_at + INTERVAL '90 days'
WHERE revoked_at IS NULL AND expires_at IS NULL;

-- Index for expiry lookups (expires_at check is at query time — now() is not IMMUTABLE)
CREATE INDEX IF NOT EXISTS idx_sensor_ingest_tokens_expiry
  ON sensor_ingest_tokens (token_hash, expires_at)
  WHERE revoked_at IS NULL;
