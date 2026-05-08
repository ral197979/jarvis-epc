-- ─────────────────────────────────────────────────────────────────────────────
-- 005_calc_sessions.sql
-- Engineering calculation sessions from Denver Suite tools.
-- Linked to projects. P&ID SVG outputs are stored inline and optionally
-- promoted to the documents table by the API route.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calc_sessions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  project_id      UUID                  REFERENCES projects(id)  ON DELETE SET NULL,
  tool_name       VARCHAR(100) NOT NULL,   -- wwtp | aquasim | mep | stormwater | pid-universal | pid-true
  tool_version    VARCHAR(20),
  input_summary   JSONB,                   -- key design inputs (optional, filled by bridge)
  output_summary  JSONB        NOT NULL,   -- results received via postMessage DENVER_RESULT
  pid_svg         TEXT,                    -- raw SVG for P&ID / PFD outputs
  notes           TEXT,
  created_by      UUID                  REFERENCES users(id)     ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calc_sessions_tenant_idx
  ON calc_sessions (tenant_id);

CREATE INDEX IF NOT EXISTS calc_sessions_project_idx
  ON calc_sessions (project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS calc_sessions_tool_tenant_idx
  ON calc_sessions (tenant_id, tool_name, created_at DESC);

ALTER TABLE calc_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY calc_sessions_tenant_isolation ON calc_sessions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

COMMENT ON TABLE  calc_sessions                IS 'Calculation sessions from Denver Engineering Suite tools, linked to EPC projects';
COMMENT ON COLUMN calc_sessions.tool_name      IS 'Denver tool identifier: wwtp | aquasim | mep | stormwater | pid-universal | pid-true';
COMMENT ON COLUMN calc_sessions.output_summary IS 'Structured results JSON received via postMessage DENVER_RESULT from iframe';
COMMENT ON COLUMN calc_sessions.pid_svg        IS 'Raw SVG for P&ID outputs. API also writes to documents table on save.';
