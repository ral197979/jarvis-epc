-- ============================================================
-- JARVIS EPC — Migration 026: EPC Core Persistence (v4.32.0)
-- Closes audit blockers F01 (backend-persisted commissioning
-- workflow) and F05 (real EPC hierarchy + pack grounding).
--
-- NEW tables:
--   systems, subsystems, tags, commissioning_items,
--   test_packs, test_results, deficiencies
--
-- Design notes:
--   - Tenant-only RLS (matches existing repo pattern from 001/002).
--     Project scope is enforced in application queries, not in RLS,
--     because `app.current_project_id` is not a current session var
--     and enabling it would return 0 rows from every existing route.
--   - set_updated_at() already defined in migration 001; reused.
--   - uuid-ossp already loaded in 001 — use uuid_generate_v4().
--   - `test_packs` are intentionally distinct from `commissioning_packs`
--     (generated deliverable). Linking the two via FK is a later pass.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- SYSTEMS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE systems (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id      UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code            VARCHAR(50)  NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  status          VARCHAR(32)  NOT NULL DEFAULT 'draft',
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, code)
);

CREATE INDEX idx_systems_tenant_project ON systems(tenant_id, project_id);
CREATE INDEX idx_systems_status         ON systems(tenant_id, status);

ALTER TABLE systems ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_systems ON systems
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_systems_updated_at BEFORE UPDATE ON systems
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- SUBSYSTEMS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE subsystems (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id      UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  system_id       UUID         NOT NULL REFERENCES systems(id)  ON DELETE CASCADE,
  code            VARCHAR(50)  NOT NULL,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  status          VARCHAR(32)  NOT NULL DEFAULT 'draft',
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, system_id, code)
);

CREATE INDEX idx_subsystems_system ON subsystems(system_id);
CREATE INDEX idx_subsystems_tenant_project ON subsystems(tenant_id, project_id);

ALTER TABLE subsystems ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_subsystems ON subsystems
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_subsystems_updated_at BEFORE UPDATE ON subsystems
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- TAGS (equipment register)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE tags (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  project_id      UUID         NOT NULL REFERENCES projects(id)    ON DELETE CASCADE,
  system_id       UUID         NOT NULL REFERENCES systems(id)     ON DELETE CASCADE,
  subsystem_id    UUID         REFERENCES subsystems(id)           ON DELETE SET NULL,
  tag_no          VARCHAR(100) NOT NULL,
  equipment_name  VARCHAR(255) NOT NULL,
  equipment_type  VARCHAR(100),
  location        VARCHAR(255),
  manufacturer    VARCHAR(255),
  model_no        VARCHAR(100),
  serial_no       VARCHAR(100),
  status          VARCHAR(32)  NOT NULL DEFAULT 'planned',
  created_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, tag_no)
);

CREATE INDEX idx_tags_system    ON tags(system_id);
CREATE INDEX idx_tags_subsystem ON tags(subsystem_id) WHERE subsystem_id IS NOT NULL;
CREATE INDEX idx_tags_tenant_project ON tags(tenant_id, project_id);
CREATE INDEX idx_tags_status    ON tags(tenant_id, status);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tags ON tags
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_tags_updated_at BEFORE UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- COMMISSIONING ITEMS
-- Structured per-item coverage (replaces unstructured JSONB in
-- commissioning_packs.payload_json for the new workflow).
-- ──────────────────────────────────────────────────────────────

CREATE TABLE commissioning_items (
  id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id          UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  system_id           UUID         NOT NULL REFERENCES systems(id)  ON DELETE CASCADE,
  subsystem_id        UUID         REFERENCES subsystems(id)        ON DELETE SET NULL,
  tag_id              UUID         REFERENCES tags(id)              ON DELETE SET NULL,
  item_type           VARCHAR(32)  NOT NULL,       -- pre_comm, pre_func, func, startup, turnover
  title               VARCHAR(255) NOT NULL,
  description         TEXT,
  status              VARCHAR(32)  NOT NULL DEFAULT 'not_started',
  source_document_id  UUID         REFERENCES documents(id) ON DELETE SET NULL,
  source_reference    TEXT,
  created_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cx_items_tenant_project_status ON commissioning_items(tenant_id, project_id, status);
CREATE INDEX idx_cx_items_system  ON commissioning_items(system_id);
CREATE INDEX idx_cx_items_tag     ON commissioning_items(tag_id) WHERE tag_id IS NOT NULL;

ALTER TABLE commissioning_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_cx_items ON commissioning_items
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_cx_items_updated_at BEFORE UPDATE ON commissioning_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- TEST PACKS
-- Real EPC pack entity with hard scope (system_id NOT NULL).
-- Distinct from commissioning_packs (generated deliverable).
-- F05 hard rule: NO synthetic-asset pack creation.
-- ──────────────────────────────────────────────────────────────

CREATE TABLE test_packs (
  id                      UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID         NOT NULL REFERENCES tenants(id)              ON DELETE CASCADE,
  project_id              UUID         NOT NULL REFERENCES projects(id)             ON DELETE CASCADE,
  system_id               UUID         NOT NULL REFERENCES systems(id)              ON DELETE CASCADE,
  subsystem_id            UUID         REFERENCES subsystems(id)                    ON DELETE SET NULL,
  tag_id                  UUID         REFERENCES tags(id)                          ON DELETE SET NULL,
  commissioning_item_id   UUID         REFERENCES commissioning_items(id)           ON DELETE SET NULL,
  pack_no                 VARCHAR(100) NOT NULL,
  title                   VARCHAR(255) NOT NULL,
  revision                VARCHAR(16)  NOT NULL DEFAULT 'A',
  pack_type               VARCHAR(32)  NOT NULL,   -- pre_comm, loop_check, start_up, functional, turnover
  status                  VARCHAR(32)  NOT NULL DEFAULT 'draft',
  generated_from          VARCHAR(32)  NOT NULL DEFAULT 'manual', -- manual, template, ai, imported
  created_by              UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by              UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, pack_no)
);

CREATE INDEX idx_test_packs_tenant_project_status ON test_packs(tenant_id, project_id, status);
CREATE INDEX idx_test_packs_system               ON test_packs(system_id);
CREATE INDEX idx_test_packs_tag                  ON test_packs(tag_id) WHERE tag_id IS NOT NULL;
CREATE INDEX idx_test_packs_cx_item              ON test_packs(commissioning_item_id) WHERE commissioning_item_id IS NOT NULL;

ALTER TABLE test_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_test_packs ON test_packs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_test_packs_updated_at BEFORE UPDATE ON test_packs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- TEST RESULTS
-- Per-step result for a test pack (pass/fail/na + evidence).
-- ──────────────────────────────────────────────────────────────

CREATE TABLE test_results (
  id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID         NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  project_id          UUID         NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  test_pack_id        UUID         NOT NULL REFERENCES test_packs(id) ON DELETE CASCADE,
  step_no             INTEGER      NOT NULL,
  step_title          VARCHAR(255) NOT NULL,
  expected_result     TEXT,
  actual_result       TEXT,
  result_status       VARCHAR(16)  NOT NULL DEFAULT 'pending',  -- pending, pass, fail, na
  evidence_uri        TEXT,
  performed_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  witnessed_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  performed_at        TIMESTAMPTZ,
  comments            TEXT,
  created_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, test_pack_id, step_no)
);

CREATE INDEX idx_test_results_pack   ON test_results(test_pack_id);
CREATE INDEX idx_test_results_status ON test_results(tenant_id, project_id, result_status);

ALTER TABLE test_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_test_results ON test_results
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_test_results_updated_at BEFORE UPDATE ON test_results
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- DEFICIENCIES
-- Test-traced deficiency (distinct from field punch_items).
-- ──────────────────────────────────────────────────────────────

CREATE TABLE deficiencies (
  id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID         NOT NULL REFERENCES tenants(id)      ON DELETE CASCADE,
  project_id          UUID         NOT NULL REFERENCES projects(id)     ON DELETE CASCADE,
  test_pack_id        UUID         REFERENCES test_packs(id)            ON DELETE SET NULL,
  test_result_id      UUID         REFERENCES test_results(id)          ON DELETE SET NULL,
  tag_id              UUID         REFERENCES tags(id)                  ON DELETE SET NULL,
  code                VARCHAR(100) NOT NULL,
  title               VARCHAR(255) NOT NULL,
  description         TEXT,
  severity            VARCHAR(16)  NOT NULL DEFAULT 'medium',   -- low, medium, high, critical
  status              VARCHAR(16)  NOT NULL DEFAULT 'open',     -- open, in_review, closed, waived
  assignee_user_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
  due_date            DATE,
  closed_at           TIMESTAMPTZ,
  closed_by           UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  updated_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, code)
);

CREATE INDEX idx_deficiencies_status       ON deficiencies(tenant_id, project_id, status);
CREATE INDEX idx_deficiencies_pack         ON deficiencies(test_pack_id)   WHERE test_pack_id IS NOT NULL;
CREATE INDEX idx_deficiencies_result       ON deficiencies(test_result_id) WHERE test_result_id IS NOT NULL;
CREATE INDEX idx_deficiencies_tag          ON deficiencies(tag_id)         WHERE tag_id IS NOT NULL;
CREATE INDEX idx_deficiencies_assignee     ON deficiencies(assignee_user_id, status);

ALTER TABLE deficiencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_deficiencies ON deficiencies
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_deficiencies_updated_at BEFORE UPDATE ON deficiencies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Grant new tables to app role (matches pattern from 002_epc_core.sql)
GRANT SELECT, INSERT, UPDATE, DELETE ON systems, subsystems, tags,
  commissioning_items, test_packs, test_results, deficiencies TO jarvis_app;
