-- ════════════════════════════════════════════════════════════════════════════
-- 080_turnover_packages.sql — Workflow Redesign W7: Turnover + Commissioning handoff
-- ════════════════════════════════════════════════════════════════════════════
-- A turnover package is a named deliverable bundle for a system/area, tracked
-- through the handoff chain: open → ready_for_commissioning → in_commissioning →
-- ready_for_turnover → accepted. Completeness is computed from the deliverables
-- checklist. Commissioning itself runs in a SEPARATE external workspace — this
-- table only records the handoff boundary: an outbound launch URL and the status
-- read back from that workspace (manually recorded; no fabricated live sync).
-- Tenant-isolated via RLS. See WORKFLOW_REDESIGN.md §17.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS turnover_packages (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id           UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 VARCHAR(200) NOT NULL,
  area                 VARCHAR(200),
  status               VARCHAR(30)  NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','ready_for_commissioning','in_commissioning','ready_for_turnover','accepted')),
  deliverables         JSONB        NOT NULL DEFAULT '{}',   -- { as_built, om_manuals, warranties, test_records, punch_signoff } : bool
  commissioning_url    TEXT,                                  -- outbound link to the external commissioning workspace
  commissioning_status TEXT,                                  -- status read back from that workspace (recorded here)
  owner_id             UUID         REFERENCES users(id) ON DELETE SET NULL,
  notes                TEXT,
  created_by           UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_turnover_project ON turnover_packages(tenant_id, project_id, status);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE turnover_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE turnover_packages FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON turnover_packages;
CREATE POLICY tenant_isolation ON turnover_packages
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON turnover_packages TO jarvis_app;
