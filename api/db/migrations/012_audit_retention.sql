-- ============================================================
-- JARVIS EPC — Migration 012: Audit Retention Policy
-- v4.31.0 | Per-tenant retention window for audit_log rows
--
-- Adds a configurable retention column to tenants and wires it
-- into the 'purge_audit_logs' scheduler handler (see
-- api/services/auditRetention.ts).
--
-- Default is 365 days. Contract-sensitive tenants can be raised
-- via UPDATE tenants SET audit_retention_days = 2555 (7 years)
-- or similar. A value of 0 disables purging for that tenant.
-- ============================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS audit_retention_days INTEGER NOT NULL DEFAULT 365
    CHECK (audit_retention_days >= 0);
