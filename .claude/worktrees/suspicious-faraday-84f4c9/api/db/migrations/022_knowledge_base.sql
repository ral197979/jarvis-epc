-- ============================================================
-- JARVIS EPC — Migration 022: Knowledge Base (document corpus)
-- v4.31.0 | Tenant-owned corpus for ingested technical PDFs
--
-- Two tables:
--   knowledge_sources — one row per ingested document, w/ license + status
--   knowledge_chunks  — text fragments + tsvector; reserved embedding col
--
-- Retrieval v1 uses PostgreSQL full-text search (tsvector + GIN + ts_rank).
-- Engineering content is keyword-heavy ("oil pressure trip", "VFD fault
-- F7", "chiller evaporator approach") so lexical search performs well.
-- When an embedding provider comes online (Ava Nomic, OpenAI, Voyage),
-- the `embedding_json` column receives back-filled vectors and the search
-- service blends semantic + lexical rerank — no schema change needed.
--
-- License model: every source declares a license_type before ingestion.
-- Defaults to 'owned' (tenant's own PDFs) which is the legal norm. Users
-- who ingest purchased standards attest ownership; forum/copyrighted
-- content is NOT accepted through this pipeline (use the Fix Library
-- bookmarklet flow for those).
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- KNOWLEDGE_SOURCES — the document registry
-- ──────────────────────────────────────────────────────────────

CREATE TABLE knowledge_sources (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Human-visible identity
  title              VARCHAR(512) NOT NULL,
  kind               VARCHAR(32)  NOT NULL DEFAULT 'pdf',
                     -- 'pdf' | 'docx' | 'md' | 'txt' (v1 supports pdf only)

  -- Where it came from
  storage_path       TEXT,                             -- absolute local path at ingest time
  original_filename  VARCHAR(512),
  byte_size          BIGINT,
  page_count         INTEGER,
  sha256             VARCHAR(64),                      -- dedup key within tenant

  -- License / attribution
  license_type       VARCHAR(32)  NOT NULL DEFAULT 'owned',
                     -- 'owned' | 'purchased' | 'public_domain' | 'cc-by' | 'cc-by-sa' | 'gov'
  license_attest     TEXT,
  attribution        TEXT,

  -- Lifecycle
  status             VARCHAR(32)  NOT NULL DEFAULT 'pending',
                     -- 'pending' | 'ingesting' | 'ready' | 'failed'
  error_text         TEXT,
  chunk_count        INTEGER      NOT NULL DEFAULT 0,

  -- Classification tags used for retrieval filtering
  tags               TEXT[]       NOT NULL DEFAULT '{}',
  asset_system       VARCHAR(64),                      -- 'chiller' | 'vfd' | 'pump' | ...
  project_id         UUID         REFERENCES projects(id) ON DELETE SET NULL,

  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  ingested_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT knowledge_sources_sha_unique UNIQUE (tenant_id, sha256)
);

CREATE INDEX idx_ks_tenant_status
  ON knowledge_sources(tenant_id, status, created_at DESC);

CREATE INDEX idx_ks_tags
  ON knowledge_sources USING GIN (tags);

CREATE INDEX idx_ks_asset_system
  ON knowledge_sources(tenant_id, asset_system)
  WHERE asset_system IS NOT NULL;

ALTER TABLE knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_knowledge_sources ON knowledge_sources
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_knowledge_sources_updated_at BEFORE UPDATE ON knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- KNOWLEDGE_CHUNKS — the searchable fragments
-- ──────────────────────────────────────────────────────────────

CREATE TABLE knowledge_chunks (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id)            ON DELETE CASCADE,
  source_id       UUID         NOT NULL REFERENCES knowledge_sources(id)  ON DELETE CASCADE,

  -- Position in source
  ordinal         INTEGER      NOT NULL,                -- 0-based chunk index within source
  page_ref        VARCHAR(64),                          -- 'p. 47' or 'Section 4.2.1' when inferrable
  char_start      INTEGER,
  char_end        INTEGER,

  -- The content
  text            TEXT         NOT NULL,
  tokens_est      INTEGER      NOT NULL DEFAULT 0,

  -- Primary retrieval surface
  search_tsv      tsvector,

  -- Reserved for future vector search. We store embeddings as JSONB
  -- arrays of floats; the search service computes cosine similarity in
  -- Node. When pgvector ships here, ALTER TABLE + generated column from
  -- this field is straightforward.
  embedding_json  JSONB,
  embedding_model VARCHAR(64),

  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kc_source_ordinal
  ON knowledge_chunks(source_id, ordinal);

CREATE INDEX idx_kc_tenant_time
  ON knowledge_chunks(tenant_id, created_at DESC);

-- Primary retrieval index — FTS on chunk text.
CREATE INDEX idx_kc_search_tsv
  ON knowledge_chunks USING GIN (search_tsv);

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_knowledge_chunks ON knowledge_chunks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Auto-maintained tsvector over the chunk text. 'english' covers
-- most engineering docs; multi-language support is a future column.
CREATE OR REPLACE FUNCTION knowledge_chunks_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := to_tsvector('english', COALESCE(NEW.text, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_knowledge_chunks_tsv
  BEFORE INSERT OR UPDATE OF text ON knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION knowledge_chunks_tsv_trigger();
