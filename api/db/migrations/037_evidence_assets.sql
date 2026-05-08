-- Migration 037: Field Evidence Ingestion Pipeline
-- LUNA Phase 3 — Evidence assets, links, and processing jobs

BEGIN;

DO $$ BEGIN
  CREATE TYPE evidence_type AS ENUM (
    'photo', 'video', 'voice_note', 'pdf', 'markup', 'annotated_drawing', 'document'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE evidence_status AS ENUM (
    'uploading', 'uploaded', 'processing', 'processed', 'failed', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Evidence assets ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evidence_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  uploaded_by     UUID NOT NULL,
  evidence_type   evidence_type NOT NULL,
  status          evidence_status NOT NULL DEFAULT 'uploading',
  -- storage
  storage_key     VARCHAR(512) NOT NULL,       -- S3/GCS object key
  storage_bucket  VARCHAR(128),
  original_filename VARCHAR(255),
  content_type    VARCHAR(100),
  file_size_bytes BIGINT,
  checksum_sha256 VARCHAR(64),                 -- dedup + integrity
  -- metadata
  title           VARCHAR(255),
  description     TEXT,
  captured_at     TIMESTAMPTZ,                 -- when photo/video was taken
  geolocation     JSONB,                       -- { lat, lng, accuracy_meters }
  device_id       UUID REFERENCES mobile_devices(id),
  -- processing results
  thumbnail_key   VARCHAR(512),
  compressed_key  VARCHAR(512),
  ocr_text        TEXT,
  ocr_confidence  NUMERIC(4,3),
  ai_tags         JSONB DEFAULT '[]',          -- future: defect recognition labels
  duration_seconds NUMERIC(8,2),              -- for video/voice
  page_count      INTEGER,                     -- for PDFs
  -- upload retry
  upload_attempts INTEGER NOT NULL DEFAULT 0,
  last_upload_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, checksum_sha256)
);

CREATE INDEX IF NOT EXISTS evidence_assets_tenant_status_idx
  ON evidence_assets (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS evidence_assets_uploader_idx
  ON evidence_assets (tenant_id, uploaded_by, created_at DESC);
CREATE INDEX IF NOT EXISTS evidence_assets_checksum_idx
  ON evidence_assets (checksum_sha256) WHERE checksum_sha256 IS NOT NULL;

-- ─── Evidence links (polymorphic associations) ────────────────────────────────

CREATE TABLE IF NOT EXISTS evidence_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evidence_id     UUID NOT NULL REFERENCES evidence_assets(id) ON DELETE CASCADE,
  entity_type     VARCHAR(60) NOT NULL,   -- 'action' | 'inspection' | 'punch_item' | 'asset' | etc.
  entity_id       UUID NOT NULL,
  linked_by       UUID NOT NULL,
  linked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context         VARCHAR(120),           -- e.g. 'defect_photo', 'before', 'after', 'completion_proof'
  UNIQUE (tenant_id, evidence_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS evidence_links_entity_idx
  ON evidence_links (tenant_id, entity_type, entity_id, linked_at DESC);
CREATE INDEX IF NOT EXISTS evidence_links_evidence_idx
  ON evidence_links (evidence_id);

-- ─── Evidence processing jobs ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evidence_processing_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  evidence_id     UUID NOT NULL REFERENCES evidence_assets(id) ON DELETE CASCADE,
  job_type        VARCHAR(60) NOT NULL,   -- 'compress' | 'thumbnail' | 'ocr' | 'ai_tag' | 'transcode'
  status          VARCHAR(30) NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  run_after       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until    TIMESTAMPTZ,
  locked_by       VARCHAR(60),
  result          JSONB,
  error           TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS evidence_processing_jobs_claim_idx
  ON evidence_processing_jobs (status, run_after)
  WHERE status IN ('pending', 'failed');

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE evidence_assets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_processing_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY evidence_assets_tenant ON evidence_assets
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY evidence_links_tenant ON evidence_links
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY evidence_processing_jobs_tenant ON evidence_processing_jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

COMMIT;
