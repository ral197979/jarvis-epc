-- Denver Engineering — Migration 061: Field Cost Entry (v10.11.0)
-- Allows PMs to post actual costs against WBS codes → feeds evm_actuals.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cost_entry_type') THEN
    CREATE TYPE cost_entry_type AS ENUM ('labor','material','equipment','subcontract','other');
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cost_entry_status') THEN
    CREATE TYPE cost_entry_status AS ENUM ('draft','posted','void');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS cost_entries (
  id            UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID              NOT NULL,
  project_id    UUID              NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_date    DATE              NOT NULL,
  entry_type    cost_entry_type   NOT NULL DEFAULT 'labor',
  wbs_code      TEXT,
  description   TEXT              NOT NULL,
  amount        NUMERIC(14,2)     NOT NULL CHECK (amount > 0),
  quantity      NUMERIC(10,3),
  unit          TEXT,
  unit_cost     NUMERIC(14,4),
  status        cost_entry_status NOT NULL DEFAULT 'draft',
  posted_at     TIMESTAMPTZ,
  posted_by     TEXT,
  evm_actual_id UUID,                 -- foreign key to evm_actuals after posting
  created_by    TEXT,
  created_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cost_entries_tenant_project
  ON cost_entries (tenant_id, project_id, entry_date DESC);

CREATE INDEX IF NOT EXISTS cost_entries_status
  ON cost_entries (tenant_id, status);

ALTER TABLE cost_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy WHERE polname = 'cost_entries_tenant_isolation'
  ) THEN
    CREATE POLICY cost_entries_tenant_isolation ON cost_entries
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END$$;
