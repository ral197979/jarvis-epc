-- ============================================================
-- JARVIS EPC — Migration 006: Commissioning Pack Workflow
-- v4.30.0 | Pack generation, async jobs, credit ledger, uploads
--
-- Integrates EngineeringHub v11 workflow layer into JarvisEPC.
--
-- New tables:
--   commissioning_packs   — draft → ready_for_review → finalized
--   generation_jobs       — async worker queue (poll-based)
--   billing_credits       — append-only credit ledger per tenant
--   source_uploads        — spec doc ingestion with extracted text
--
-- Links to existing schema:
--   tenant_id  → tenants(id)
--   project_id → projects(id)       [nullable — packs may be standalone]
--   created_by → users(id)
--
-- Notes:
--   - pack_status intentionally distinct from project_status
--   - generation_jobs uses optimistic locking (locked_by / locked_at)
--     compatible with multi-process workers without requiring Redis
--   - billing_credits is a ledger (never UPDATE, only INSERT with delta)
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────────────────────

CREATE TYPE pack_status AS ENUM (
  'draft',
  'ready_for_review',
  'finalized',
  'failed'
);

CREATE TYPE pack_job_type AS ENUM (
  'generate_draft',
  'finalize_pack'
);

CREATE TYPE pack_job_status AS ENUM (
  'queued',
  'running',
  'complete',
  'failed'
);

-- ──────────────────────────────────────────────────────────────
-- SOURCE UPLOADS
-- Ingested spec documents (PDF / DOCX / TXT) with extracted text.
-- Written before draft generation so the job worker can read it.
-- ──────────────────────────────────────────────────────────────

CREATE TABLE source_uploads (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  project_id      UUID          REFERENCES projects(id)           ON DELETE SET NULL,
  uploaded_by     UUID          NOT NULL REFERENCES users(id)     ON DELETE RESTRICT,
  file_name       VARCHAR(512)  NOT NULL,
  storage_path    TEXT,                      -- local or S3 object key
  content_type    VARCHAR(128),
  size_bytes      BIGINT,
  extracted_text  TEXT,                      -- plain-text result of parse pipeline
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_src_uploads_tenant   ON source_uploads(tenant_id, created_at DESC);
CREATE INDEX idx_src_uploads_project  ON source_uploads(project_id) WHERE project_id IS NOT NULL;

ALTER TABLE source_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_source_uploads ON source_uploads
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ──────────────────────────────────────────────────────────────
-- BILLING CREDITS
-- Append-only ledger. Positive delta = credit grant; negative = consumption.
-- Balance is always SUM(delta) — never stored directly.
-- ──────────────────────────────────────────────────────────────

CREATE TABLE billing_credits (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delta       INTEGER       NOT NULL,          -- positive = grant, negative = spend
  reason      VARCHAR(128)  NOT NULL,          -- e.g. 'signup_grant', 'draft_pack_generation'
  ref_type    VARCHAR(64),                     -- e.g. 'commissioning_pack', 'stripe_payment'
  ref_id      UUID,                            -- FK to referenced entity (untyped for flexibility)
  created_by  UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_credits_tenant  ON billing_credits(tenant_id, created_at DESC);
CREATE INDEX idx_billing_credits_ref     ON billing_credits(ref_type, ref_id) WHERE ref_id IS NOT NULL;

ALTER TABLE billing_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_billing_credits ON billing_credits
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Helper view: current balance per tenant
CREATE VIEW tenant_credit_balance AS
  SELECT tenant_id, COALESCE(SUM(delta), 0)::INTEGER AS balance
  FROM billing_credits
  GROUP BY tenant_id;

-- ──────────────────────────────────────────────────────────────
-- COMMISSIONING PACKS
-- The primary deliverable entity. Each pack targets one system type
-- and progresses through the draft → review → finalize lifecycle.
--
-- payload_json:       draft content (plan / pfc / fpt / notes arrays)
-- final_payload_json: finalized content after review edits applied
-- html_path / markdown_path / pdf_path: generated artifact locations
-- ──────────────────────────────────────────────────────────────

CREATE TABLE commissioning_packs (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  project_id         UUID         REFERENCES projects(id)            ON DELETE SET NULL,
  created_by         UUID         NOT NULL REFERENCES users(id)      ON DELETE RESTRICT,
  source_upload_id   UUID         REFERENCES source_uploads(id)      ON DELETE SET NULL,

  -- Identity
  title              VARCHAR(255) NOT NULL,
  system_type        VARCHAR(64)  NOT NULL,   -- matches rules.ts asset key: chiller, ro skid, vfd, etc.
  input_text         TEXT,                    -- free-text scope description from engineer
  review_notes       TEXT,                    -- reviewer additions before finalization

  -- Lifecycle
  status             pack_status  NOT NULL DEFAULT 'draft',

  -- Generated artifacts (storage paths or presigned URLs)
  html_path          TEXT,
  markdown_path      TEXT,
  pdf_path           TEXT,

  -- Content payloads
  payload_json       JSONB,                   -- draft: { plan[], pfc[], fpt[], notes[] }
  final_payload_json JSONB,                   -- finalized: same shape, review notes applied

  -- Metadata
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cx_packs_tenant          ON commissioning_packs(tenant_id, created_at DESC);
CREATE INDEX idx_cx_packs_project         ON commissioning_packs(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_cx_packs_status          ON commissioning_packs(tenant_id, status);
CREATE INDEX idx_cx_packs_system_type     ON commissioning_packs(tenant_id, system_type);

ALTER TABLE commissioning_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cx_packs ON commissioning_packs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_cx_packs_updated_at BEFORE UPDATE ON commissioning_packs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- GENERATION JOBS
-- Async work queue polled by packWorker.ts.
-- Optimistic locking via locked_by / locked_at prevents double-processing
-- without requiring Redis or an external queue.
--
-- payload_json shape:
--   generate_draft:  { packTitle, systemType, inputText, sourceUploadId?, projectId? }
--   finalize_pack:   { packId, reviewNotes }
-- ──────────────────────────────────────────────────────────────

CREATE TABLE generation_jobs (
  id           UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by   UUID           NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,

  type         pack_job_type  NOT NULL,
  status       pack_job_status NOT NULL DEFAULT 'queued',

  payload_json JSONB          NOT NULL DEFAULT '{}',
  result_json  JSONB,
  error_text   TEXT,

  -- Retry / locking
  attempts     INTEGER        NOT NULL DEFAULT 0,
  max_attempts INTEGER        NOT NULL DEFAULT 3,
  locked_at    TIMESTAMPTZ,
  locked_by    VARCHAR(128),              -- worker instance id
  run_after    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Primary polling index: worker selects queued jobs eligible to run
CREATE INDEX idx_gen_jobs_queue    ON generation_jobs(tenant_id, status, run_after)
  WHERE status IN ('queued', 'running');
CREATE INDEX idx_gen_jobs_tenant   ON generation_jobs(tenant_id, created_at DESC);

ALTER TABLE generation_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_gen_jobs ON generation_jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_gen_jobs_updated_at BEFORE UPDATE ON generation_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- SEED: Starter credits for existing tenants
-- Run once after migration. New tenants get credits via onboarding route.
-- ──────────────────────────────────────────────────────────────

INSERT INTO billing_credits (tenant_id, delta, reason)
SELECT id, 10, 'migration_006_starter_grant'
FROM tenants
WHERE status = 'active';
