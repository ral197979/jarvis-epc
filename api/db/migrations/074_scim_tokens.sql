-- Denver Engineering — SCIM 2.0 Provisioning
-- Migration 074: scim_tokens + scim_audit
-- ─────────────────────────────────────────────────────────────
-- Enables automated user provisioning from Okta, Azure AD, and
-- other identity providers that implement SCIM 2.0 (RFC 7643/7644).

-- ─── SCIM bearer tokens (per-tenant) ─────────────────────────────────────────
-- Each tenant generates one token that is shared with their IdP provisioner.
-- The token itself is shown once at generation time; only the SHA-256 hash
-- is stored (same pattern as refresh_tokens).

CREATE TABLE IF NOT EXISTS scim_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label        TEXT NOT NULL DEFAULT 'primary',  -- human-readable name
  token_hash   TEXT NOT NULL UNIQUE,             -- SHA-256 hex of the raw token
  token_prefix TEXT NOT NULL,                    -- first 8 chars for display (e.g. "scim_abc")
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,                      -- NULL = never expires
  is_active    BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(tenant_id, label)
);

CREATE INDEX IF NOT EXISTS idx_scim_tokens_hash   ON scim_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_scim_tokens_tenant ON scim_tokens(tenant_id) WHERE is_active = true;

-- RLS: tenant owners can manage their own SCIM tokens
ALTER TABLE scim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE scim_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scim_tokens
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

-- ─── SCIM provisioning audit log ─────────────────────────────────────────────
-- Tracks every SCIM operation for compliance (SOC 2, GDPR).

CREATE TABLE IF NOT EXISTS scim_audit (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  operation    TEXT NOT NULL,     -- 'create_user' | 'update_user' | 'deactivate_user' | 'delete_user' | 'list_users'
  target_user  UUID,              -- users.id if operation involved a specific user
  scim_data    JSONB,             -- sanitized SCIM payload (no passwords)
  source_ip    TEXT,
  status       TEXT NOT NULL,     -- 'success' | 'error'
  error_msg    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scim_audit_tenant ON scim_audit(tenant_id, created_at DESC);

ALTER TABLE scim_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE scim_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scim_audit
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

-- ─── GDPR: user data deletion requests ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,     -- the user being deleted (may no longer exist)
  email        TEXT NOT NULL,     -- email at time of deletion request
  requested_by UUID,              -- who initiated (user themselves or admin)
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_tenant ON data_deletion_requests(tenant_id);

ALTER TABLE data_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_deletion_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON data_deletion_requests
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);
