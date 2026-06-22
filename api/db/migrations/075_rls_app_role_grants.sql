-- ════════════════════════════════════════════════════════════════════════════
-- 075_rls_app_role_grants.sql — AUD-002 remediation
-- ════════════════════════════════════════════════════════════════════════════
-- Makes the non-owner application role `jarvis_app` fully usable for the tenant
-- request path so PostgreSQL Row Level Security is actually ENFORCED.
--
-- Background: ~224 tables ENABLE ROW LEVEL SECURITY, but the app historically
-- connected as `jarvis` (the table OWNER). PostgreSQL exempts a table's owner
-- from RLS unless FORCE ROW LEVEL SECURITY is set, so the tenant_isolation
-- policies were silently bypassed at runtime. The fix is to connect tenant
-- traffic as a NON-OWNER role (jarvis_app), which is subject to RLS.
--
-- The original grants in 001 only covered tables that existed at that time;
-- every table added in migrations 002–074 was never granted to jarvis_app.
-- This migration re-grants across the whole schema and sets default privileges
-- so future tables are covered automatically.
--
-- ACTIVATION (operational, not automatic):
--   1. Set a real password:  ALTER ROLE jarvis_app PASSWORD '<strong>';
--   2. Point the app at it:   DATABASE_URL_APP=postgres://jarvis_app:<strong>@host/db
--   tenantQuery()/tenantTransaction() then run as jarvis_app (RLS enforced),
--   while plain query() (workers/migrations/admin) keeps using the owner role.
-- ════════════════════════════════════════════════════════════════════════════

-- Ensure the role exists (idempotent; mirrors 001).
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'jarvis_app') THEN
    CREATE ROLE jarvis_app LOGIN PASSWORD 'change-in-production';
  END IF;
END $$;

-- Critical: the app role must NOT bypass RLS.
ALTER ROLE jarvis_app NOBYPASSRLS;

-- Connect + schema usage.
DO $grant$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO jarvis_app', current_database());
END $grant$;
GRANT USAGE ON SCHEMA public TO jarvis_app;

-- Data access on every existing table/sequence (covers 002–074 and beyond).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO jarvis_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO jarvis_app;

-- Future tables/sequences created by the owner are granted automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO jarvis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO jarvis_app;
