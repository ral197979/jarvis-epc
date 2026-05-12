-- ============================================================
-- Denver Engineering — Migration 054: Schedule Import Jobs
-- v10.4.0
--
-- Tracks P6 XER and MS Project XML file imports into schedule_tasks.
-- Stores the original file for re-processing, maps P6 task IDs to
-- our UUIDs for idempotent re-imports.
-- ============================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_import_format') THEN
    CREATE TYPE schedule_import_format AS ENUM ('xer', 'mspdi', 'mpx');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_import_status') THEN
    CREATE TYPE schedule_import_status AS ENUM ('pending', 'running', 'completed', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS schedule_import_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  project_id      UUID        NOT NULL,
  format          schedule_import_format NOT NULL,
  status          schedule_import_status NOT NULL DEFAULT 'pending',
  filename        TEXT        NOT NULL,
  file_size_bytes INTEGER,

  -- Results
  tasks_imported  INTEGER     NOT NULL DEFAULT 0,
  tasks_updated   INTEGER     NOT NULL DEFAULT 0,
  deps_imported   INTEGER     NOT NULL DEFAULT 0,
  warnings        JSONB       NOT NULL DEFAULT '[]',
  error           TEXT,

  -- Audit
  imported_by     UUID,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE schedule_import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY schedule_import_jobs_tenant ON schedule_import_jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE INDEX IF NOT EXISTS schedule_import_jobs_project_idx
  ON schedule_import_jobs(tenant_id, project_id, created_at DESC);

-- Map external IDs (P6 task_id / MSP UID) → our schedule_task UUIDs.
-- Enables idempotent re-imports: same external ID → UPSERT.
CREATE TABLE IF NOT EXISTS schedule_import_id_map (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL,
  project_id      UUID        NOT NULL,
  import_job_id   UUID        NOT NULL REFERENCES schedule_import_jobs(id) ON DELETE CASCADE,
  external_id     TEXT        NOT NULL,   -- P6 task_id or MSP UID
  task_id         UUID        NOT NULL,   -- our schedule_tasks.id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, external_id)
);
ALTER TABLE schedule_import_id_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY schedule_import_id_map_tenant ON schedule_import_id_map
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
