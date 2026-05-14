-- Denver Engineering — Migration 065: Workforce Timesheets (v10.16.0)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'timesheet_status') THEN
    CREATE TYPE timesheet_status AS ENUM ('draft','submitted','approved','rejected');
  END IF;
END$$;

-- One row per week per member per project
CREATE TABLE IF NOT EXISTS timesheets (
  id           UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID             NOT NULL,
  member_id    UUID             NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  project_id   UUID             NOT NULL REFERENCES projects(id)     ON DELETE CASCADE,
  week_start   DATE             NOT NULL,   -- always a Monday
  status       timesheet_status NOT NULL DEFAULT 'draft',
  total_hours  NUMERIC(7,2)     GENERATED ALWAYS AS (
    COALESCE(mon_hrs,0)+COALESCE(tue_hrs,0)+COALESCE(wed_hrs,0)+
    COALESCE(thu_hrs,0)+COALESCE(fri_hrs,0)+COALESCE(sat_hrs,0)+COALESCE(sun_hrs,0)
  ) STORED,
  total_cost   NUMERIC(14,2),   -- computed on approve: total_hours * member hourly_rate
  mon_hrs      NUMERIC(5,2),
  tue_hrs      NUMERIC(5,2),
  wed_hrs      NUMERIC(5,2),
  thu_hrs      NUMERIC(5,2),
  fri_hrs      NUMERIC(5,2),
  sat_hrs      NUMERIC(5,2),
  sun_hrs      NUMERIC(5,2),
  wbs_code     TEXT,
  notes        TEXT,
  submitted_at TIMESTAMPTZ,
  approved_at  TIMESTAMPTZ,
  approved_by  TEXT,
  cost_entry_id UUID,           -- FK to cost_entries after approval
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, member_id, project_id, week_start)
);

CREATE INDEX IF NOT EXISTS timesheets_tenant_project_week
  ON timesheets (tenant_id, project_id, week_start DESC);

CREATE INDEX IF NOT EXISTS timesheets_tenant_member
  ON timesheets (tenant_id, member_id, week_start DESC);

ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'timesheets_tenant_isolation') THEN
    CREATE POLICY timesheets_tenant_isolation ON timesheets
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END$$;
