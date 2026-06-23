-- Denver Engineering — SAML 2.0 SSO Configuration
-- Migration 073: tenant_sso_configs + sp_certificates
-- ─────────────────────────────────────────────────────────────
-- Supports: Azure AD, Microsoft Entra ID, Okta, Google Workspace, OneLogin
-- Protocols: SAML 2.0, OIDC (future)

-- ─── SP signing certificates (global + per-tenant rotation) ──────────────────

CREATE TABLE IF NOT EXISTS sp_certificates (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = platform default
  label        TEXT NOT NULL DEFAULT 'primary',                 -- 'primary' | 'secondary'
  cert_pem     TEXT NOT NULL,                                   -- X.509 PEM
  key_pem      TEXT NOT NULL,                                   -- RSA private key PEM (encrypted at rest)
  fingerprint  TEXT NOT NULL,                                   -- SHA-256 hex fingerprint
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sp_certificates_tenant ON sp_certificates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sp_certificates_active ON sp_certificates(is_active) WHERE is_active = true;

-- ─── Tenant SSO configurations ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_sso_configs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  protocol     TEXT NOT NULL DEFAULT 'saml'
               CHECK (protocol IN ('saml', 'oidc')),

  provider     TEXT                    -- 'azure_ad' | 'okta' | 'google' | 'onelogin' | 'custom'
               CHECK (provider IN ('azure_ad', 'okta', 'google', 'onelogin', 'custom')),

  is_active    BOOLEAN NOT NULL DEFAULT false,   -- must be explicitly activated

  -- ── SAML: Identity Provider settings ───────────────────────────────────────
  idp_entity_id    TEXT,              -- IdP entityID from metadata
  idp_sso_url      TEXT,              -- SingleSignOnService Location (HTTP-Redirect)
  idp_sso_binding  TEXT DEFAULT 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
  idp_slo_url      TEXT,              -- SingleLogoutService Location (optional)
  idp_certificate  TEXT,             -- IdP signing certificate (PEM, no headers needed)
  idp_metadata_url TEXT,             -- auto-import URL (e.g. Azure federation metadata endpoint)

  -- ── SAML: Service Provider settings ────────────────────────────────────────
  sp_entity_id     TEXT,             -- SP entityID (defaults to api base URL + /saml/metadata)
  sp_cert_id       UUID REFERENCES sp_certificates(id),  -- signing cert for SP-signed requests

  -- ── Attribute mapping ───────────────────────────────────────────────────────
  -- Maps IdP attribute names to Denver Eng fields.
  -- Defaults cover common Azure AD / Okta attribute names.
  attribute_mapping JSONB NOT NULL DEFAULT '{
    "email":       ["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "email", "mail"],
    "displayName": ["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name", "displayName", "cn"],
    "groups":      ["http://schemas.microsoft.com/ws/2008/06/identity/claims/groups", "groups", "memberOf"]
  }',

  -- ── Role mapping ────────────────────────────────────────────────────────────
  -- Maps IdP group names → Denver Eng roles.
  -- Example: { "Engineering-Admins": "admin", "PM-Team": "project_manager" }
  role_mapping JSONB NOT NULL DEFAULT '{}',

  -- Default role when user has no matching group claim
  default_role TEXT NOT NULL DEFAULT 'viewer'
               CHECK (default_role IN ('owner', 'admin', 'project_manager', 'engineer', 'viewer')),

  -- ── OIDC settings (future) ──────────────────────────────────────────────────
  oidc_client_id     TEXT,
  oidc_client_secret TEXT,           -- encrypted at rest
  oidc_discovery_url TEXT,           -- e.g. https://login.microsoftonline.com/{tenantId}/v2.0

  -- ── JIT provisioning ────────────────────────────────────────────────────────
  jit_provisioning   BOOLEAN NOT NULL DEFAULT true,   -- auto-create users on first login
  jit_update_profile BOOLEAN NOT NULL DEFAULT true,   -- sync name on every login

  -- ── Metadata ────────────────────────────────────────────────────────────────
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(tenant_id, protocol)  -- one SAML and one OIDC config per tenant
);

CREATE INDEX IF NOT EXISTS idx_sso_configs_tenant   ON tenant_sso_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sso_configs_active   ON tenant_sso_configs(tenant_id) WHERE is_active = true;

-- ─── SAML sessions (relay state + assertion replay prevention) ───────────────

CREATE TABLE IF NOT EXISTS saml_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  relay_state  TEXT NOT NULL UNIQUE,   -- random nonce linking request to response
  assertion_id TEXT,                   -- assertion ID for replay prevention (set on consume)
  redirect_url TEXT,                   -- post-login redirect
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes',
  consumed_at  TIMESTAMPTZ            -- null until used
);

CREATE INDEX IF NOT EXISTS idx_saml_sessions_relay   ON saml_sessions(relay_state);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_expires ON saml_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_saml_sessions_assertion ON saml_sessions(assertion_id) WHERE assertion_id IS NOT NULL;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_sso_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_sso_configs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_sso_configs
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

ALTER TABLE saml_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE saml_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saml_sessions
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

-- sp_certificates: global table (platform certs visible to all, tenant certs scoped)
ALTER TABLE sp_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sp_certificates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sp_certificates
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

-- ─── Cleanup function (called by scheduler) ──────────────────────────────────

CREATE OR REPLACE FUNCTION purge_expired_saml_sessions() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE deleted integer;
BEGIN
  DELETE FROM saml_sessions WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;
