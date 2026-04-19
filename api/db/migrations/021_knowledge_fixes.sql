-- ============================================================
-- JARVIS EPC — Migration 021: Engineer-authored Fix Library (Pattern C)
-- v4.31.0 | Tenant-owned troubleshooting corpus
--
-- Each row is a verified resolution for a commissioning symptom,
-- authored by an engineer on this platform. Forum threads can inspire
-- a fix but are not ingested — the engineer re-writes the resolution
-- in their own words, optionally linking the inspiring URL. This keeps
-- the corpus legally clean and quality-controlled.
--
-- Retrieval model (v1): symptom-tag overlap (GIN) + full-text search on
-- the narrative fields, blended in the service. No pgvector dependency.
-- An `embedding_json` column is reserved so embedding-based retrieval
-- can be added later without a breaking migration.
-- ============================================================

CREATE TABLE knowledge_fixes (
  id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id        UUID         REFERENCES projects(id)          ON DELETE SET NULL,

  -- Scope tags used by retrieval
  asset_system      VARCHAR(64),                         -- 'chiller','vfd','ro_skid','pump',...
  asset_tag         VARCHAR(64),                         -- normalized e.g. 'CH-01'
  symptoms          TEXT[]       NOT NULL DEFAULT '{}',  -- ['oil_pressure_trip','startup_fail']

  -- The narrative
  root_cause        TEXT         NOT NULL,
  resolution_steps  TEXT         NOT NULL,

  -- Confidence & attribution
  confidence        VARCHAR(16)  NOT NULL DEFAULT 'probable'
                    CHECK (confidence IN ('confirmed','probable','suspected')),
  verified_by       UUID         REFERENCES users(id)    ON DELETE SET NULL,
  verified_at       TIMESTAMPTZ,

  -- Forum-thread or manufacturer-page that inspired this fix. Stored as
  -- a pointer + short engineer note; never the full copied text.
  source_url        TEXT,
  source_note       TEXT,

  -- Reserved for future embedding-based retrieval; null in v1.
  embedding_json    JSONB,

  -- Quick retrieval: full-text search on root_cause || resolution_steps.
  -- Maintained by trigger (see below) so INSERT/UPDATE callers don't
  -- need to compute it client-side.
  search_tsv        tsvector,

  created_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fixes_tenant_time
  ON knowledge_fixes(tenant_id, created_at DESC);

-- Symptom-tag overlap queries are the primary search path.
CREATE INDEX idx_fixes_symptoms
  ON knowledge_fixes USING GIN (symptoms);

CREATE INDEX idx_fixes_asset_system
  ON knowledge_fixes(tenant_id, asset_system)
  WHERE asset_system IS NOT NULL;

CREATE INDEX idx_fixes_search_tsv
  ON knowledge_fixes USING GIN (search_tsv);

ALTER TABLE knowledge_fixes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_knowledge_fixes ON knowledge_fixes
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_knowledge_fixes_updated_at BEFORE UPDATE ON knowledge_fixes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Maintain search_tsv automatically. 'english' is a safe default; multi-
-- language tenants can be addressed later by adding a `language` column
-- and adjusting this trigger.
CREATE OR REPLACE FUNCTION knowledge_fixes_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv :=
       setweight(to_tsvector('english', COALESCE(NEW.root_cause, '')),       'A')
    || setweight(to_tsvector('english', COALESCE(NEW.resolution_steps, '')), 'B')
    || setweight(to_tsvector('english', COALESCE(NEW.source_note, '')),      'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_knowledge_fixes_tsv
  BEFORE INSERT OR UPDATE OF root_cause, resolution_steps, source_note
  ON knowledge_fixes
  FOR EACH ROW EXECUTE FUNCTION knowledge_fixes_tsv_trigger();
