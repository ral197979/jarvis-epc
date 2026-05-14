-- Denver Engineering — Migration 066: Risk Register (v10.17.0)

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

CREATE TABLE IF NOT EXISTS risks (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL,
  project_id        UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  risk_number       INT           NOT NULL,
  title             TEXT          NOT NULL,
  description       TEXT,
  category          risk_category NOT NULL DEFAULT 'other',
  status            risk_status   NOT NULL DEFAULT 'open',

  -- 1–5 scale
  probability       INT           NOT NULL DEFAULT 3 CHECK (probability BETWEEN 1 AND 5),
  impact            INT           NOT NULL DEFAULT 3 CHECK (impact       BETWEEN 1 AND 5),
  risk_score        INT           GENERATED ALWAYS AS (probability * impact) STORED,

  -- Post-mitigation residual
  residual_probability INT        CHECK (residual_probability BETWEEN 1 AND 5),
  residual_impact      INT        CHECK (residual_impact      BETWEEN 1 AND 5),
  residual_score       INT        GENERATED ALWAYS AS (
    COALESCE(residual_probability, probability) * COALESCE(residual_impact, impact)
  ) STORED,

  cost_exposure     NUMERIC(14,2),  -- potential $ impact
  owner             TEXT,           -- name or user id
  mitigation_plan   TEXT,
  contingency_plan  TEXT,
  identified_date   DATE            NOT NULL DEFAULT CURRENT_DATE,
  target_date       DATE,
  closed_date       DATE,
  created_by        TEXT,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

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
