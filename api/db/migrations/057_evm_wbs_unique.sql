-- Denver Engineering — v10.6.2
-- Add UNIQUE constraint to evm_wbs_entries so ON CONFLICT upserts work correctly.
-- Without this, ON CONFLICT DO NOTHING never fires (PK is gen_random_uuid()),
-- causing duplicate WBS entries on every upsert call.

ALTER TABLE evm_wbs_entries
  ADD CONSTRAINT IF NOT EXISTS evm_wbs_entries_baseline_wbs_unique
  UNIQUE (tenant_id, baseline_id, wbs_code);
