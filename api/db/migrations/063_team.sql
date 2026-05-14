-- Denver Engineering — Migration 063: Team & Workforce (v10.13.0)

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'member_status') THEN
    CREATE TYPE member_status AS ENUM ('active','inactive','on_leave');
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_role') THEN
    CREATE TYPE assignment_role AS ENUM (
      'project_manager','superintendent','engineer','foreman',
      'inspector','safety_officer','estimator','coordinator','other'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS team_members (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID          NOT NULL,
  first_name   TEXT          NOT NULL,
  last_name    TEXT          NOT NULL,
  email        TEXT,
  phone        TEXT,
  role         TEXT          NOT NULL,   -- job title / role
  trade        TEXT,                     -- electrical, mechanical, civil…
  hourly_rate  NUMERIC(10,2),
  status       member_status NOT NULL DEFAULT 'active',
  notes        TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_assignments (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID            NOT NULL,
  member_id       UUID            NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  project_id      UUID            NOT NULL REFERENCES projects(id)     ON DELETE CASCADE,
  assignment_role assignment_role NOT NULL DEFAULT 'other',
  allocation_pct  INT             NOT NULL DEFAULT 100 CHECK (allocation_pct BETWEEN 1 AND 100),
  start_date      DATE            NOT NULL,
  end_date        DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, member_id, project_id, start_date)
);

CREATE INDEX IF NOT EXISTS team_members_tenant
  ON team_members (tenant_id, status);

CREATE INDEX IF NOT EXISTS project_assignments_member
  ON project_assignments (tenant_id, member_id, start_date DESC);

CREATE INDEX IF NOT EXISTS project_assignments_project
  ON project_assignments (tenant_id, project_id);

ALTER TABLE team_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_assignments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'team_members_tenant_isolation') THEN
    CREATE POLICY team_members_tenant_isolation ON team_members
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'project_assignments_tenant_isolation') THEN
    CREATE POLICY project_assignments_tenant_isolation ON project_assignments
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END$$;
