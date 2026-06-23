-- ============================================================
-- Denver Engineering — Migration 072: RLS Hardening (Phase 1)
--
-- Adds Row-Level Security to the remaining tenant-scoped tables
-- identified in the Phase 1 enterprise audit.
--
-- Tables addressed:
--   demo_tenants         — tenant_id FK → protect demo config per tenant
--   worker_leases        — optional tenant_id → isolate tenant locks
--   workflow_versions    — inherits isolation via workflows.tenant_id
--
-- Global/system tables confirmed intentionally RLS-free:
--   benchmark_cohorts       (no tenant_id — global analytics)
--   deployment_health_checks (no tenant_id — system metrics)
--   external_agents          (explicitly global registry per 056 comment)
--   federated_model_versions (no tenant_id — platform ML models)
--   federated_patterns       (no tenant_id — anonymized data)
--   federated_privacy_audits (no tenant_id — system audit trail)
--   marketplace_playbooks    (no tenant_id — platform marketplace)
--   playbook_versions        (no tenant_id — marketplace versions)
--   plugin_versions          (no tenant_id — plugin registry)
--   plugins                  (no tenant_id — plugin registry)
--   tenants                  (RLS anchor — cannot self-isolate)
-- ============================================================

-- ─── demo_tenants ─────────────────────────────────────────────────────────────
-- Protects demo tenant configuration from cross-tenant visibility.
-- Owner and admin may view their own tenant's demo configuration.

ALTER TABLE demo_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON demo_tenants;
CREATE POLICY tenant_isolation ON demo_tenants
  USING (
    tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid
  );

-- ─── worker_leases ────────────────────────────────────────────────────────────
-- worker_leases.tenant_id is nullable (NULL = system-level lock).
-- Policy: system locks (tenant_id IS NULL) are visible to all;
-- tenant-scoped locks are isolated per tenant.

ALTER TABLE worker_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_leases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON worker_leases;
CREATE POLICY tenant_isolation ON worker_leases
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid
  );

-- ─── workflow_versions ────────────────────────────────────────────────────────
-- workflow_versions has no direct tenant_id column but is linked to the
-- tenant-scoped workflows table via workflow_id FK.
-- Policy: allow access only to versions of workflows owned by the current tenant.

ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON workflow_versions;
CREATE POLICY tenant_isolation ON workflow_versions
  USING (
    workflow_id IN (
      SELECT id FROM workflows
      WHERE tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid
    )
  );

-- ─── Verification helper ──────────────────────────────────────────────────────
-- Run post-migration to confirm all tenant-scoped tables have RLS:
--
-- SELECT tablename,
--        rowsecurity,
--        (SELECT count(*) FROM pg_policies WHERE polrelid = c.oid) AS policy_count
-- FROM pg_tables t
-- JOIN pg_class c ON c.relname = t.tablename
-- WHERE t.schemaname = 'public'
-- ORDER BY tablename;
