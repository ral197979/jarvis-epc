-- Denver Engineering — Migration 069: RLS for transmittal_counters
--
-- Migration 051 created transmittal_counters with tenant_id in the PK
-- but omitted ENABLE ROW LEVEL SECURITY and the tenant isolation policy.

ALTER TABLE transmittal_counters ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polname = 'transmittal_counters_tenant_isolation'
      AND polrelid = 'transmittal_counters'::regclass
  ) THEN
    CREATE POLICY transmittal_counters_tenant_isolation ON transmittal_counters
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END$$;
