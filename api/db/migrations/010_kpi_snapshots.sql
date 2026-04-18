-- ============================================================
-- JARVIS EPC — Migration 010: KPI Snapshots
-- v4.31.0 | Periodic tenant-wide metric rollups for trending
--
-- Populated by the 'snapshot_kpis' scheduler handler (see
-- api/services/kpiSnapshot.ts). One row per capture. The
-- metrics column is a free-form JSONB blob so new KPIs can be
-- added to the snapshot without a migration — consumers that
-- care about a specific field use ->>'field' / ->'field'.
--
-- Intended use:
--   1. Admin creates a scheduled_jobs row: job_type='snapshot_kpis',
--      interval_seconds=86400 (daily) via /automation UI.
--   2. Scheduler fires the handler once per interval.
--   3. Trend dashboard queries kpi_snapshots over a date range.
-- ============================================================

CREATE TABLE kpi_snapshots (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- When the snapshot was captured (set by handler; defaults for ad-hoc inserts).
  captured_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Tenant-wide rollup. Schema is intentionally flat so consumers can
  -- read specific fields with minimal effort, e.g.
  --   SELECT captured_at, (metrics->>'total_budget')::numeric
  --   FROM kpi_snapshots WHERE tenant_id = ... ORDER BY captured_at DESC
  metrics     JSONB        NOT NULL DEFAULT '{}',

  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Primary trend-query index: ORDER BY captured_at DESC within a tenant.
CREATE INDEX idx_kpi_snapshots_tenant_time
  ON kpi_snapshots(tenant_id, captured_at DESC);

ALTER TABLE kpi_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_kpi_snapshots ON kpi_snapshots
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
