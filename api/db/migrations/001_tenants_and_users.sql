-- ============================================================
-- JARVIS EPC — Migration 001: Tenants & Users
-- v4.26.0 | Multi-tenant foundation with Row Level Security
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ──────────────────────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────────────────────

CREATE TYPE tenant_plan   AS ENUM ('trial', 'starter', 'professional', 'enterprise');
CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'cancelled', 'pending');

CREATE TYPE user_role AS ENUM (
  'owner',          -- full system access for the tenant
  'admin',          -- tenant admin (manage users/settings)
  'project_manager',
  'engineer',
  'procurement',
  'field_ops',
  'viewer'
);

CREATE TYPE audit_action AS ENUM (
  'create', 'read', 'update', 'delete',
  'login', 'logout', 'export', 'approve', 'reject',
  'upload', 'download', 'integrate_push', 'integrate_pull'
);

-- ──────────────────────────────────────────────────────────────
-- TENANTS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE tenants (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug           VARCHAR(63) UNIQUE NOT NULL,   -- subdomain / URL segment
  name           VARCHAR(255) NOT NULL,
  plan           tenant_plan NOT NULL DEFAULT 'trial',
  status         tenant_status NOT NULL DEFAULT 'pending',
  domain         VARCHAR(255),                  -- custom domain (optional)
  settings       JSONB NOT NULL DEFAULT '{}',   -- feature flags, theme, etc.
  max_users      INTEGER NOT NULL DEFAULT 5,
  max_storage_gb NUMERIC(8,2) NOT NULL DEFAULT 10,
  used_storage_gb NUMERIC(8,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug   ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_domain ON tenants(domain) WHERE domain IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- USERS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE users (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email           VARCHAR(255) NOT NULL,
  display_name    VARCHAR(100) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            user_role   NOT NULL DEFAULT 'viewer',
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  mfa_secret      VARCHAR(64),                -- TOTP secret (nullable = MFA disabled)
  last_login      TIMESTAMPTZ,
  login_count     INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  avatar_url      VARCHAR(512),
  preferences     JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

CREATE INDEX idx_users_tenant   ON users(tenant_id);
CREATE INDEX idx_users_email    ON users(email);
CREATE INDEX idx_users_role     ON users(tenant_id, role);
CREATE INDEX idx_users_active   ON users(tenant_id, is_active);
CREATE INDEX idx_users_email_trgm ON users USING gin(email gin_trgm_ops);

-- ──────────────────────────────────────────────────────────────
-- REFRESH TOKENS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jti         VARCHAR(64) UNIQUE NOT NULL,     -- JWT ID, indexed for O(1) lookup
  token_hash  VARCHAR(255) NOT NULL,           -- SHA-256 of the raw token
  ip_address  INET,
  user_agent  TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rt_jti        ON refresh_tokens(jti);
CREATE INDEX idx_rt_user       ON refresh_tokens(user_id);
CREATE INDEX idx_rt_tenant     ON refresh_tokens(tenant_id);
CREATE INDEX idx_rt_expires    ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;

-- ──────────────────────────────────────────────────────────────
-- AUDIT LOG (tenant-scoped)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE audit_log (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      UUID         REFERENCES users(id) ON DELETE SET NULL,
  action       audit_action NOT NULL,
  resource     VARCHAR(100) NOT NULL,   -- e.g. 'project', 'document'
  resource_id  UUID,
  old_data     JSONB,
  new_data     JSONB,
  ip_address   INET,
  user_agent   TEXT,
  request_id   VARCHAR(64),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant    ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_user      ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_resource  ON audit_log(tenant_id, resource, resource_id);
CREATE INDEX idx_audit_action    ON audit_log(tenant_id, action);

-- ──────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────
-- All tenant-scoped tables enforce RLS via app.current_tenant_id
-- which is set by the application layer before each query.
-- Superuser / migration connections bypass RLS (BYPASSRLS).

ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log     ENABLE ROW LEVEL SECURITY;

-- Application role (limited permissions)
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'jarvis_app') THEN
    CREATE ROLE jarvis_app LOGIN PASSWORD 'change-in-production';
  END IF;
END $$;

DO $grant$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO jarvis_app', current_database());
END $grant$;
GRANT USAGE   ON SCHEMA public       TO jarvis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO jarvis_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO jarvis_app;

-- RLS policies
CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_rt ON refresh_tokens
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_audit ON audit_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ──────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGER (reusable)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
