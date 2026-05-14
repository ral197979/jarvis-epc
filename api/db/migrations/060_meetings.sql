-- ============================================================
-- Denver Engineering — Migration 060: Meeting Minutes
-- v10.9.0
--
-- Formal meeting documentation: OAC, safety, coordination,
-- progress, kickoff. Action items spawned here write into
-- the existing action_items table (source_type='meeting').
--
-- Workflow: draft → published → archived
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_type') THEN
    CREATE TYPE meeting_type AS ENUM ('oac','safety','coordination','progress','kickoff','other');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meeting_status') THEN
    CREATE TYPE meeting_status AS ENUM ('draft','published','archived');
  END IF;
END $$;

-- ─── Meetings ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meetings (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID           NOT NULL,
  project_id      UUID           NOT NULL,
  mtg_number      INTEGER        NOT NULL,              -- auto-seq per project
  meeting_type    meeting_type   NOT NULL DEFAULT 'oac',
  status          meeting_status NOT NULL DEFAULT 'draft',
  title           TEXT           NOT NULL,
  meeting_date    DATE           NOT NULL,
  start_time      TIME,
  end_time        TIME,
  location        TEXT,
  facilitator     TEXT,
  attendees       JSONB          NOT NULL DEFAULT '[]', -- [{name, company, role}]
  general_notes   TEXT,
  next_meeting_date DATE,
  created_by      UUID,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, mtg_number)
);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meetings_tenant ON meetings;
CREATE POLICY meetings_tenant ON meetings
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS meetings_project_idx ON meetings (tenant_id, project_id, meeting_date DESC);
CREATE INDEX IF NOT EXISTS meetings_status_idx  ON meetings (tenant_id, project_id, status);

-- ─── Agenda items ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meeting_agenda_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL,
  meeting_id    UUID        NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  topic         TEXT        NOT NULL,
  presenter     TEXT,
  duration_min  INTEGER,
  notes         TEXT,
  decision      TEXT,        -- formal decision reached
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meeting_agenda_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mtg_agenda_tenant ON meeting_agenda_items;
CREATE POLICY mtg_agenda_tenant ON meeting_agenda_items
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS mtg_agenda_meeting_idx ON meeting_agenda_items (meeting_id, sort_order);
