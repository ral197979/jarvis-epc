-- ============================================================
-- JARVIS EPC — Migration 003: File Management
-- v4.26.0 | Documents, versions, and storage tracking
-- ============================================================

CREATE TYPE file_status AS ENUM ('uploading', 'active', 'archived', 'deleted');

-- ──────────────────────────────────────────────────────────────
-- DOCUMENT FOLDERS (hierarchical)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE document_folders (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id  UUID        REFERENCES projects(id) ON DELETE CASCADE,
  parent_id   UUID        REFERENCES document_folders(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  path        TEXT        NOT NULL,   -- materialized path for fast subtree queries: /root/eng/drawings
  color       VARCHAR(20),
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_folders_tenant  ON document_folders(tenant_id);
CREATE INDEX idx_folders_project ON document_folders(project_id);
CREATE INDEX idx_folders_parent  ON document_folders(parent_id);
CREATE INDEX idx_folders_path    ON document_folders(tenant_id, path);

ALTER TABLE document_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_folders ON document_folders
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_folders_updated_at BEFORE UPDATE ON document_folders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- DOCUMENTS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE documents (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      UUID        REFERENCES projects(id) ON DELETE SET NULL,
  folder_id       UUID        REFERENCES document_folders(id) ON DELETE SET NULL,
  doc_number      VARCHAR(100),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  type            VARCHAR(100),    -- 'drawing', 'spec', 'report', 'certificate', 'photo', etc.
  discipline      VARCHAR(100),
  status          file_status NOT NULL DEFAULT 'uploading',
  current_version INTEGER     NOT NULL DEFAULT 1,
  tags            TEXT[],
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_docs_tenant    ON documents(tenant_id);
CREATE INDEX idx_docs_project   ON documents(project_id);
CREATE INDEX idx_docs_folder    ON documents(folder_id);
CREATE INDEX idx_docs_type      ON documents(tenant_id, type);
CREATE INDEX idx_docs_tags      ON documents USING gin(tags);
CREATE INDEX idx_docs_title_trgm ON documents USING gin(title gin_trgm_ops);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_documents ON documents
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_docs_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- DOCUMENT VERSIONS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE document_versions (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id     UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version         INTEGER     NOT NULL,
  -- Storage fields
  storage_backend VARCHAR(20) NOT NULL DEFAULT 'local',  -- 'local' | 's3' | 'gcs' | 'azure'
  storage_bucket  VARCHAR(255),
  storage_key     VARCHAR(1024) NOT NULL,                -- relative path or S3 key
  storage_url     VARCHAR(2048),                         -- presigned or CDN URL (ephemeral)
  -- File metadata
  original_name   VARCHAR(255) NOT NULL,
  mime_type       VARCHAR(127),
  size_bytes      BIGINT      NOT NULL DEFAULT 0,
  checksum_sha256 CHAR(64),
  -- Upload lifecycle
  upload_id       VARCHAR(255),                          -- multipart upload ID (S3)
  status          file_status NOT NULL DEFAULT 'uploading',
  -- Content
  extracted_text  TEXT,                                  -- for full-text search
  ai_summary      TEXT,
  change_note     TEXT,
  uploaded_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, version)
);

CREATE INDEX idx_dv_document ON document_versions(document_id);
CREATE INDEX idx_dv_tenant   ON document_versions(tenant_id);
CREATE INDEX idx_dv_status   ON document_versions(tenant_id, status);

-- Full-text search on extracted content
CREATE INDEX idx_dv_fts ON document_versions
  USING gin(to_tsvector('english', coalesce(extracted_text, '') || ' ' || coalesce(ai_summary, '')));

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_dv ON document_versions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ──────────────────────────────────────────────────────────────
-- UPLOAD PRESIGN TOKENS (short-lived, single-use)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE upload_tokens (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id     UUID        REFERENCES documents(id) ON DELETE CASCADE,
  version_id      UUID        REFERENCES document_versions(id) ON DELETE CASCADE,
  token           VARCHAR(128) UNIQUE NOT NULL,
  storage_key     VARCHAR(1024) NOT NULL,
  max_size_bytes  BIGINT      NOT NULL DEFAULT 104857600,  -- 100 MB default
  mime_types      TEXT[],                                  -- allowed MIME types
  used_at         TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_upload_tokens_token    ON upload_tokens(token) WHERE used_at IS NULL;
CREATE INDEX idx_upload_tokens_expires  ON upload_tokens(expires_at) WHERE used_at IS NULL;

ALTER TABLE upload_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_upload_tokens ON upload_tokens
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ──────────────────────────────────────────────────────────────
-- STORAGE USAGE TRACKING (maintain tenant quota)
-- ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_tenant_storage()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    UPDATE tenants
    SET used_storage_gb = used_storage_gb + (NEW.size_bytes::numeric / 1073741824)
    WHERE id = NEW.tenant_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != 'active' AND NEW.status = 'active' THEN
      UPDATE tenants
      SET used_storage_gb = used_storage_gb + (NEW.size_bytes::numeric / 1073741824)
      WHERE id = NEW.tenant_id;
    ELSIF OLD.status = 'active' AND NEW.status = 'deleted' THEN
      UPDATE tenants
      SET used_storage_gb = GREATEST(0, used_storage_gb - (OLD.size_bytes::numeric / 1073741824))
      WHERE id = NEW.tenant_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_storage_quota AFTER INSERT OR UPDATE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION update_tenant_storage();

-- Grant new tables to app role
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jarvis_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jarvis_app;
