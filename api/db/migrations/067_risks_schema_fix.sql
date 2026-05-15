-- Denver Engineering — Migration 067: Fix risks table schema conflict
--
-- Migration 002 created a `risks` table with legacy `risk_likelihood`/`risk_impact`
-- enum columns. Migration 066 attempted to create the correct schema (probability
-- INT, impact INT, residual scores, risk_status/risk_category enums) but used
-- CREATE TABLE IF NOT EXISTS — so the 002 schema silently persisted.
-- This migration drops the legacy table and recreates it correctly.

-- 1. Drop legacy objects
DROP TABLE IF EXISTS risks CASCADE;
DROP TYPE  IF EXISTS risk_likelihood;
DROP TYPE  IF EXISTS risk_impact;

-- 2. Ensure new enum types exist (066 may have created them already)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_status') THEN
    CREATE TYPE risk_status AS ENUM ('open','mitigating','accepted','closed','occurred');
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_category') THEN
    CREATE TYPE risk_category AS ENUM (
      'schedule','cost','scope','safety','technical','regulatory',
      'environmental','procurement','force_majeure','other'
    );
  END IF;
END$$;

-- 3. Create correct risks table
CREATE TABLE risks (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID          NOT NULL,
  project_id           UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  risk_number          INT           NOT NULL,
  title                TEXT          NOT NULL,
  description          TEXT,
  category             risk_category NOT NULL DEFAULT 'other',
  status               risk_status   NOT NULL DEFAULT 'open',

  probability          INT           NOT NULL DEFAULT 3 CHECK (probability BETWEEN 1 AND 5),
  impact               INT           NOT NULL DEFAULT 3 CHECK (impact      BETWEEN 1 AND 5),
  risk_score           INT           GENERATED ALWAYS AS (probability * impact) STORED,

  residual_probability INT           CHECK (residual_probability BETWEEN 1 AND 5),
  residual_impact      INT           CHECK (residual_impact      BETWEEN 1 AND 5),
  residual_score       INT           GENERATED ALWAYS AS (
    COALESCE(residual_probability, probability) * COALESCE(residual_impact, impact)
  ) STORED,

  cost_exposure        NUMERIC(14,2),
  owner                TEXT,
  mitigation_plan      TEXT,
  contingency_plan     TEXT,
  identified_date      DATE          NOT NULL DEFAULT CURRENT_DATE,
  target_date          DATE,
  closed_date          DATE,
  created_by           TEXT,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, project_id, risk_number)
);

CREATE INDEX IF NOT EXISTS risks_tenant_project
  ON risks (tenant_id, project_id, risk_score DESC);

CREATE INDEX IF NOT EXISTS risks_tenant_status
  ON risks (tenant_id, status);

ALTER TABLE risks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'risks_tenant_isolation') THEN
    CREATE POLICY risks_tenant_isolation ON risks
      USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  END IF;
END$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON risks TO jarvis_app;
