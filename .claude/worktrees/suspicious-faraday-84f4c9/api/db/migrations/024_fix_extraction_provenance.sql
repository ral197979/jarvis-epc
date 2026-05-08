-- ============================================================
-- JARVIS EPC — Migration 024: Fix Library extraction provenance
-- v4.31.0 | Trace auto-extracted fixes back to their source + run
--
-- Pattern C originally supported engineer-authored fixes only. Phase 2
-- seeds the library automatically by extracting troubleshooting narratives
-- from ingested OEM manuals via Claude. To keep the two populations
-- distinguishable and re-runnable:
--
--   source_id         — FK to the knowledge_sources row the fix came from.
--                       NULL = engineer-authored via the bookmarklet/UI.
--   extraction_run_id — UUID grouping fixes extracted in one job. Lets
--                       us roll back a bad extraction by deleting all
--                       rows with a given run_id, or compare two runs.
--
-- Confidence for auto-extracted fixes starts at 'suspected' — engineers
-- promote to 'probable' / 'confirmed' when they verify the resolution.
-- ============================================================

ALTER TABLE knowledge_fixes
  ADD COLUMN IF NOT EXISTS source_id         UUID REFERENCES knowledge_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extraction_run_id UUID;

CREATE INDEX IF NOT EXISTS idx_fixes_source
  ON knowledge_fixes(source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fixes_extraction_run
  ON knowledge_fixes(extraction_run_id)
  WHERE extraction_run_id IS NOT NULL;
