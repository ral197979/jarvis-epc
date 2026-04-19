-- ============================================================
-- JARVIS EPC — Migration 018: Per-project Agent Mode (kill switch)
-- v4.31.0 | Safe-by-default gate on automated writes
--
-- Three states:
--   auto         — agents may commit writes subject to autosign rules
--   review_all   — agents draft & record; nothing auto-signs (default)
--   frozen       — agents cannot act at all; hard stop
--
-- Enforcement lives in api/middleware/agentMode.ts — handlers that
-- accept agent-originated mutations check this column before writing.
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS agent_mode VARCHAR(16) NOT NULL DEFAULT 'review_all'
    CHECK (agent_mode IN ('auto','review_all','frozen'));

CREATE INDEX IF NOT EXISTS idx_projects_agent_mode
  ON projects(tenant_id, agent_mode)
  WHERE agent_mode <> 'review_all';
