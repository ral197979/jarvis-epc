-- ============================================================
-- Denver Engineering — Migration 033: Action Analytics (v4.34.0)
-- LUNA Phase 2F — Nightly snapshot aggregation + rolling KPIs
--
-- NEW tables:
--   action_analytics_snapshots  — daily aggregated metrics per tenant
-- ============================================================

CREATE TABLE action_analytics_snapshots (
  id                        UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                 UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  snapshot_date             DATE          NOT NULL,   -- date this snapshot covers

  -- Volume
  total_created             INTEGER       NOT NULL DEFAULT 0,
  total_completed           INTEGER       NOT NULL DEFAULT 0,
  total_cancelled           INTEGER       NOT NULL DEFAULT 0,
  total_open                INTEGER       NOT NULL DEFAULT 0,

  -- SLA
  total_overdue             INTEGER       NOT NULL DEFAULT 0,
  sla_compliance_pct        NUMERIC(5,2),            -- % completed before due_at
  avg_resolution_hours      NUMERIC(8,2),            -- avg hours open→completed
  median_resolution_hours   NUMERIC(8,2),

  -- Escalations
  total_escalations_fired   INTEGER       NOT NULL DEFAULT 0,
  actions_escalated_l1      INTEGER       NOT NULL DEFAULT 0,
  actions_escalated_l2      INTEGER       NOT NULL DEFAULT 0,
  actions_escalated_l3      INTEGER       NOT NULL DEFAULT 0,
  escalation_rate_pct       NUMERIC(5,2),            -- % of completed that were escalated

  -- Aging buckets (open actions as of snapshot_date)
  age_0_24h                 INTEGER       NOT NULL DEFAULT 0,
  age_24_72h                INTEGER       NOT NULL DEFAULT 0,
  age_72h_plus              INTEGER       NOT NULL DEFAULT 0,

  -- Module breakdown (JSONB for flexibility)
  -- { "rfis": { created: N, completed: N, overdue: N },
  --   "submittals": { ... }, ... }
  by_module                 JSONB         NOT NULL DEFAULT '{}'::jsonb,

  -- Priority breakdown
  by_priority               JSONB         NOT NULL DEFAULT '{}'::jsonb,

  -- System type breakdown
  by_system_type            JSONB         NOT NULL DEFAULT '{}'::jsonb,

  -- Workload: top 10 assignees by open count
  assignee_workload         JSONB         NOT NULL DEFAULT '[]'::jsonb,

  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, snapshot_date)
);

CREATE INDEX idx_analytics_snapshots_tenant ON action_analytics_snapshots(tenant_id, snapshot_date DESC);

ALTER TABLE action_analytics_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_action_analytics_snapshots ON action_analytics_snapshots
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

COMMENT ON TABLE action_analytics_snapshots IS
  'Daily pre-aggregated analytics per tenant. Nightly job writes one row per tenant per day. JSONB columns for module/priority/system breakdowns.';
