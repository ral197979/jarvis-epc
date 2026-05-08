-- ============================================================
-- JARVIS EPC — Migration 028: Coverage endpoint performance
--
-- Adds composite indexes to support the F05 coverage query:
--   GET /api/v1/projects/:projectId/coverage
--
-- The query shape is:
--   FROM tags t
--   LEFT JOIN test_packs tp ON tp.tag_id = t.id AND tp.project_id = $1
--   WHERE t.project_id = $1
--
-- idx_tags_tenant_project(tenant_id, project_id) already exists
-- and covers the tags scan under RLS. The additional plain
-- idx_tags_project_id covers cases where the query planner
-- accesses tags without the tenant prefix in scope.
--
-- idx_test_packs_project_tag is the key addition: makes the
-- LEFT JOIN on (project_id, tag_id) a single index seek instead
-- of a seq-scan filtered by project_id.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_tags_project_id
  ON tags(project_id);

CREATE INDEX IF NOT EXISTS idx_test_packs_project_tag
  ON test_packs(project_id, tag_id)
  WHERE tag_id IS NOT NULL;
