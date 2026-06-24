-- ════════════════════════════════════════════════════════════════════════════
-- 077_safety.sql — Phase 10: Safety (observations, incidents, near-misses)
-- ════════════════════════════════════════════════════════════════════════════
-- The one EPC module previously absent. Captures leading indicators (safety
-- observations) and lagging indicators (incidents / near misses) so the
-- predictive safety engine can surface high-risk areas, recurring hazards, and
-- the observation-to-incident ratio. Tenant-isolated via RLS.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'safety_severity') THEN
    CREATE TYPE safety_severity AS ENUM ('low','medium','high','critical');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'safety_obs_type') THEN
    CREATE TYPE safety_obs_type AS ENUM ('unsafe_condition','unsafe_act','hazard','positive');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'safety_obs_status') THEN
    CREATE TYPE safety_obs_status AS ENUM ('open','actioned','closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'safety_incident_type') THEN
    CREATE TYPE safety_incident_type AS ENUM ('near_miss','first_aid','injury','property_damage','environmental');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'safety_incident_status') THEN
    CREATE TYPE safety_incident_status AS ENUM ('reported','investigating','corrective','closed');
  END IF;
END $$;

-- ─── Observations (leading indicators) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS safety_observations (
  id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID            NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id    UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type          safety_obs_type   NOT NULL DEFAULT 'unsafe_condition',
  severity      safety_severity   NOT NULL DEFAULT 'low',
  status        safety_obs_status NOT NULL DEFAULT 'open',
  location      VARCHAR(200),
  discipline    VARCHAR(60),
  description   TEXT            NOT NULL,
  observed_at   DATE            NOT NULL DEFAULT CURRENT_DATE,
  reported_by   UUID            REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- ─── Incidents (lagging indicators, incl. near-misses) ───────────────────────
CREATE TABLE IF NOT EXISTS safety_incidents (
  id                 UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID                   NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id         UUID                   NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type               safety_incident_type   NOT NULL DEFAULT 'near_miss',
  severity           safety_severity        NOT NULL DEFAULT 'medium',
  status             safety_incident_status NOT NULL DEFAULT 'reported',
  location           VARCHAR(200),
  discipline         VARCHAR(60),
  description        TEXT                   NOT NULL,
  incident_date      DATE                   NOT NULL DEFAULT CURRENT_DATE,
  root_cause         TEXT,
  corrective_action  TEXT,
  reported_by        UUID                   REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_safety_obs_project ON safety_observations(tenant_id, project_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_safety_inc_project ON safety_incidents(tenant_id, project_id, incident_date DESC);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE safety_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_observations FORCE  ROW LEVEL SECURITY;
ALTER TABLE safety_incidents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_incidents    FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON safety_observations
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);
CREATE POLICY tenant_isolation ON safety_incidents
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON safety_observations, safety_incidents TO jarvis_app;
