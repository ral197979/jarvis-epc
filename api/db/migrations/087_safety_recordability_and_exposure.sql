-- Denver Engineering — recordable classification + exposure hours (TRIR)
-- ─────────────────────────────────────────────────────────────────────────────
-- The defect this closes
-- ──────────────────────
-- The executive dashboard rendered a Total Recordable Incident Rate as
--
--     TRIR = (recordable × 200,000) / (200,000 × toolbox_talks.length)
--
-- `safety_incidents` had no `recordable` column, so the numerator counted a
-- field that did not exist and was always zero. `toolbox_talks` has no table at
-- all, so the denominator was invented outright — and clamped to a minimum of
-- one, which meant the card ALWAYS produced a plausible-looking rate.
--
-- TRIR is a regulated OSHA metric. A fabricated one on an executive dashboard
-- is a compliance claim about a workplace, so the fix is not a better proxy —
-- it is a real numerator and a real denominator, and refusal when either is
-- incomplete.
--
-- Two rules govern everything below.
--
--   UNKNOWN STAYS UNKNOWN. `recordable` is nullable and has NO default. Every
--   incident already in the table stays NULL, meaning "nobody has determined
--   this yet". It is deliberately not backfilled to false: recording that an
--   injury was non-recordable is a regulatory determination, and inferring it
--   from silence is exactly the fabrication this migration exists to remove.
--
--   HOURS ARE MEASURED, NEVER DERIVED. Exposure hours get their own table with
--   a period, a scope, a stated source and a recorder. They are never computed
--   from headcount, days elapsed, toolbox talks or any other proxy.

-- ─── 1. Recordable classification ────────────────────────────────────────────

ALTER TABLE safety_incidents
  ADD COLUMN IF NOT EXISTS recordable               BOOLEAN,
  ADD COLUMN IF NOT EXISTS recordable_classified_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recordable_classified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recordable_basis         TEXT;

COMMENT ON COLUMN safety_incidents.recordable IS
  'OSHA recordability. NULL = not yet determined, and is never inferred: a rate '
  'cannot be computed while any incident in the period is unclassified.';
COMMENT ON COLUMN safety_incidents.recordable_basis IS
  'Why the determination was made. Free text, for audit.';

-- A determination must carry its timestamp. Without this, `recordable` could be
-- set with no record of when, which is not an auditable classification.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'safety_incidents_recordable_audited'
  ) THEN
    ALTER TABLE safety_incidents
      ADD CONSTRAINT safety_incidents_recordable_audited
      CHECK (recordable IS NULL OR recordable_classified_at IS NOT NULL);
  END IF;
END$$;

-- Finding unclassified incidents in a period is the hot path of the TRIR
-- calculation, and it is the query that decides whether a rate may be shown.
CREATE INDEX IF NOT EXISTS idx_safety_inc_recordable
  ON safety_incidents (tenant_id, project_id, incident_date)
  WHERE recordable IS NULL;

CREATE INDEX IF NOT EXISTS idx_safety_inc_recordable_true
  ON safety_incidents (tenant_id, project_id, incident_date)
  WHERE recordable IS TRUE;

-- ─── 2. Exposure hours ───────────────────────────────────────────────────────
--
-- Scope. `project_id NULL` means the row measures the WHOLE TENANT for that
-- period; a non-null project measures that project. The two levels are never
-- mixed when computing a rate — a tenant TRIR uses tenant-scoped rows and a
-- project TRIR uses that project's rows. Summing project rows into a tenant
-- figure would silently under-count any project that never reported, which is
-- the same class of error as inventing the denominator.

CREATE TABLE IF NOT EXISTS safety_exposure_hours (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  -- NULL = tenant-wide. See the scope note above.
  project_id     UUID          REFERENCES projects(id) ON DELETE CASCADE,

  period_start   DATE          NOT NULL,
  period_end     DATE          NOT NULL,
  hours          NUMERIC(14,2) NOT NULL,

  -- Where the number came from. NOT NULL and non-empty on purpose: an exposure
  -- figure with no stated origin cannot be audited, and an unauditable
  -- denominator is what this whole migration exists to prevent.
  source         VARCHAR(120)  NOT NULL,
  source_reference TEXT,
  note           TEXT,

  recorded_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT safety_exposure_period_ordered CHECK (period_end >= period_start),
  -- Zero is allowed (a shut site genuinely worked no hours) but it can never
  -- be a denominator; the service refuses to divide by it rather than
  -- returning an infinite rate.
  CONSTRAINT safety_exposure_hours_nonneg   CHECK (hours >= 0),
  CONSTRAINT safety_exposure_source_present CHECK (length(btrim(source)) > 0)
);

-- Exact-duplicate periods are the common double-count and are refused here.
-- PARTIAL OVERLAP is refused by the service, which can report which row it
-- collided with; a unique index cannot express range overlap without
-- btree_gist, and no other migration in this repository requires that
-- extension.
CREATE UNIQUE INDEX IF NOT EXISTS uq_safety_exposure_project_period
  ON safety_exposure_hours (tenant_id, project_id, period_start, period_end)
  WHERE project_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_safety_exposure_tenant_period
  ON safety_exposure_hours (tenant_id, period_start, period_end)
  WHERE project_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_safety_exposure_lookup
  ON safety_exposure_hours (tenant_id, project_id, period_start, period_end);

-- ─── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE safety_exposure_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_exposure_hours FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'safety_exposure_hours' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON safety_exposure_hours
      USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);
  END IF;
END$$;

DROP TRIGGER IF EXISTS trg_safety_exposure_updated_at ON safety_exposure_hours;
CREATE TRIGGER trg_safety_exposure_updated_at
  BEFORE UPDATE ON safety_exposure_hours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE safety_exposure_hours IS
  'Measured worker exposure hours, the TRIR denominator. Never derived from '
  'headcount, days, toolbox talks or any other proxy. project_id NULL = tenant-wide.';
