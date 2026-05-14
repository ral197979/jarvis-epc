-- Denver Engineering — v10.6.2
-- Add UNIQUE constraint to evm_wbs_entries so ON CONFLICT upserts work correctly.
-- Without this, ON CONFLICT DO NOTHING never fires (PK is gen_random_uuid()),
-- causing duplicate WBS entries on every upsert call.
--
-- Note: ADD CONSTRAINT does not support IF NOT EXISTS in PostgreSQL;
-- guard with a pg_constraint existence check instead.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'evm_wbs_entries_baseline_wbs_unique'
  ) THEN
    ALTER TABLE evm_wbs_entries
      ADD CONSTRAINT evm_wbs_entries_baseline_wbs_unique
      UNIQUE (tenant_id, baseline_id, wbs_code);
  END IF;
END$$;
