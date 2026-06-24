-- ════════════════════════════════════════════════════════════════════════════
-- 078_ncr_capa.sql — Phase 9: Non-Conformance Reports + Corrective Actions (CAPA)
-- ════════════════════════════════════════════════════════════════════════════
-- Closes the NCR → CAPA → root-cause quality workflow. An NCR captures a
-- non-conformance (often raised from a failed inspection or punch item); one or
-- more corrective/preventive actions (CAPA) are tracked to closure against it.
-- Tenant-isolated via RLS.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ncr_severity') THEN
    CREATE TYPE ncr_severity AS ENUM ('minor','major','critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ncr_status') THEN
    CREATE TYPE ncr_status AS ENUM ('open','investigating','corrective_action','verification','closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ncr_disposition') THEN
    CREATE TYPE ncr_disposition AS ENUM ('pending','use_as_is','rework','repair','reject','return');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'capa_type') THEN
    CREATE TYPE capa_type AS ENUM ('corrective','preventive');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'capa_status') THEN
    CREATE TYPE capa_status AS ENUM ('open','in_progress','completed','verified');
  END IF;
END $$;

-- ─── Non-Conformance Reports ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ncrs (
  id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID            NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id    UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ncr_number    INTEGER         NOT NULL,                 -- auto-seq per project
  title         VARCHAR(255)    NOT NULL,
  description   TEXT,
  severity      ncr_severity    NOT NULL DEFAULT 'minor',
  status        ncr_status      NOT NULL DEFAULT 'open',
  disposition   ncr_disposition NOT NULL DEFAULT 'pending',
  discipline    VARCHAR(60),
  location      VARCHAR(200),
  source        VARCHAR(40),                              -- inspection | punch | observation | audit | other
  source_ref    VARCHAR(120),                             -- originating record number/id
  root_cause    TEXT,
  raised_by     UUID            REFERENCES users(id) ON DELETE SET NULL,
  raised_at     DATE            NOT NULL DEFAULT CURRENT_DATE,
  closed_at     DATE,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, ncr_number)
);

-- ─── Corrective / Preventive Actions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corrective_actions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  ncr_id        UUID         NOT NULL REFERENCES ncrs(id)     ON DELETE CASCADE,
  project_id    UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type          capa_type    NOT NULL DEFAULT 'corrective',
  description   TEXT         NOT NULL,
  status        capa_status  NOT NULL DEFAULT 'open',
  assigned_to   UUID         REFERENCES users(id) ON DELETE SET NULL,
  due_date      DATE,
  completed_at  DATE,
  verified_by   UUID         REFERENCES users(id) ON DELETE SET NULL,
  verified_at   DATE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ncrs_project ON ncrs(tenant_id, project_id, status);
CREATE INDEX IF NOT EXISTS idx_capa_ncr     ON corrective_actions(tenant_id, ncr_id);
CREATE INDEX IF NOT EXISTS idx_capa_project ON corrective_actions(tenant_id, project_id, status);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE ncrs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ncrs               FORCE  ROW LEVEL SECURITY;
ALTER TABLE corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrective_actions FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ncrs
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);
CREATE POLICY tenant_isolation ON corrective_actions
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON ncrs, corrective_actions TO jarvis_app;
