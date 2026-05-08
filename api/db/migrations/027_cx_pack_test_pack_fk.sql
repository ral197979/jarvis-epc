-- Migration 027: FK bridge — commissioning_packs → test_packs
-- ─────────────────────────────────────────────────────────────
-- Links an AI-generated commissioning pack document to the structured
-- test_pack that was used to execute it. Nullable; existing rows unaffected.
-- Closes the P2 FK bridge item from the v4.32.0 audit roadmap.

ALTER TABLE commissioning_packs
  ADD COLUMN IF NOT EXISTS test_pack_id UUID REFERENCES test_packs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cx_packs_test_pack_id
  ON commissioning_packs(test_pack_id) WHERE test_pack_id IS NOT NULL;
