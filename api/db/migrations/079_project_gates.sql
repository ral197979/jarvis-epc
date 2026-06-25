-- ════════════════════════════════════════════════════════════════════════════
-- 079_project_gates.sql — Workflow Redesign W3: Approval Gate Framework
-- ════════════════════════════════════════════════════════════════════════════
-- Stores the APPROVAL state of each project lifecycle gate. The gate's outstanding
-- REQUIREMENTS are computed live from records (RFIs, NCRs, punch, inspections, …)
-- by the lifecycle service — they are never hand-maintained here. This table holds
-- only the human decision (pending → approved | waived), its owner, and timing.
-- Gate keys correspond to project_phase enum values (the phase the gate unlocks).
-- Tenant-isolated via RLS. See WORKFLOW_REDESIGN.md §8.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_gates (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id    UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  gate_key      VARCHAR(40)  NOT NULL,           -- a project_phase value (the phase this gate unlocks)
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','waived')),
  owner_id      UUID         REFERENCES users(id) ON DELETE SET NULL,
  expected_date DATE,
  notes         TEXT,
  approved_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, gate_key)
);

CREATE INDEX IF NOT EXISTS idx_project_gates_project ON project_gates(tenant_id, project_id);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE project_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_gates FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON project_gates;
CREATE POLICY tenant_isolation ON project_gates
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_gates TO jarvis_app;
