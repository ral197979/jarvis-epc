-- ============================================================
-- JARVIS EPC — Migration 015: MCP Tool Marketplace (disable list)
-- v4.31.0 | Per-tenant opt-out for MCP tools
--
-- Model: rows = disabled tools. No row = tool is enabled.
-- This keeps the common case (everything enabled) zero-row and
-- makes re-enable a simple DELETE.
--
-- Enforcement lives in api/routes/mcp.ts POST /execute — the
-- handler checks this table before dispatching to the native
-- or Ava backend and returns 403 when the tool is listed.
-- ============================================================

CREATE TABLE mcp_disabled_tools (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tool_name    VARCHAR(128) NOT NULL,
  reason       TEXT,
  disabled_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT mcp_disabled_tools_unique UNIQUE (tenant_id, tool_name)
);

CREATE INDEX idx_mcp_disabled_tenant ON mcp_disabled_tools(tenant_id);

ALTER TABLE mcp_disabled_tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_mcp_disabled_tools ON mcp_disabled_tools
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
