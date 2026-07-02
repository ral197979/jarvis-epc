-- Personal Agent (ADR-012, Phase 1) — allow 'user'-scoped agent memory.
--
-- Additive + safe: widens the scope_type CHECK on agent_memory_entries so the
-- per-user PersonalAgent can persist personal memory (scope_id = the user id,
-- agent_type = 'personal_agent'). No data change; no other table touched.
-- The feature stays dormant until the PERSONAL_AGENT flag is enabled.

ALTER TABLE agent_memory_entries
  DROP CONSTRAINT IF EXISTS agent_memory_entries_scope_type_check;

ALTER TABLE agent_memory_entries
  ADD CONSTRAINT agent_memory_entries_scope_type_check
  CHECK (scope_type IN ('project', 'workflow', 'action', 'global', 'user'));
