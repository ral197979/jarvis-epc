-- ============================================================
-- JARVIS EPC  Migration 008: Tier-1 Gap Close
-- Punch Lists + Inspection Templates/Records
-- (RFIs and Submittals already exist in 002_epc_core)
-- ============================================================

-- PUNCH LISTS
CREATE TABLE punch_lists (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title              VARCHAR(255) NOT NULL,
  description        TEXT,
  status             VARCHAR(20)  NOT NULL DEFAULT 'open',
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_punch_lists_project ON punch_lists(project_id, status);
ALTER TABLE punch_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_punch_lists ON punch_lists
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_punch_lists_updated_at BEFORE UPDATE ON punch_lists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE punch_items (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  punch_list_id      UUID         NOT NULL REFERENCES punch_lists(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_number        INTEGER      NOT NULL DEFAULT 0,
  title              VARCHAR(255) NOT NULL,
  description        TEXT,
  location           VARCHAR(200),
  discipline         VARCHAR(60),
  priority           VARCHAR(20)  NOT NULL DEFAULT 'medium',
  status             VARCHAR(20)  NOT NULL DEFAULT 'open',
  assigned_to        UUID         REFERENCES users(id) ON DELETE SET NULL,
  due_date           DATE,
  drawing_id         UUID         REFERENCES drawings(id) ON DELETE SET NULL,
  pin_x              NUMERIC(8,2),
  pin_y              NUMERIC(8,2),
  photos             JSONB        NOT NULL DEFAULT '[]',
  verified_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  verified_at        TIMESTAMPTZ,
  closed_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  closed_at          TIMESTAMPTZ,
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_punch_items_list    ON punch_items(punch_list_id, status);
CREATE INDEX idx_punch_items_project ON punch_items(project_id, status);
CREATE INDEX idx_punch_items_assignee ON punch_items(assigned_to) WHERE status IN ('open','in_progress');
ALTER TABLE punch_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_punch_items ON punch_items
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_punch_items_updated_at BEFORE UPDATE ON punch_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- INSPECTION TEMPLATES
CREATE TABLE inspection_templates (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               VARCHAR(200) NOT NULL,
  category           VARCHAR(60),
  discipline         VARCHAR(60),
  checklist          JSONB        NOT NULL DEFAULT '[]',
  version            INTEGER      NOT NULL DEFAULT 1,
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_inspection_templates_tenant ON inspection_templates(tenant_id, is_active);
ALTER TABLE inspection_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_inspection_templates ON inspection_templates
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_inspection_templates_updated_at BEFORE UPDATE ON inspection_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- INSPECTION RECORDS
CREATE TABLE inspections (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  template_id        UUID         REFERENCES inspection_templates(id) ON DELETE SET NULL,
  inspection_number  VARCHAR(50)  NOT NULL,
  title              VARCHAR(255) NOT NULL,
  type               VARCHAR(60),
  location           VARCHAR(200),
  discipline         VARCHAR(60),
  status             VARCHAR(20)  NOT NULL DEFAULT 'scheduled',
  scheduled_date     DATE,
  completed_date     DATE,
  inspector_id       UUID         REFERENCES users(id) ON DELETE SET NULL,
  results            JSONB        NOT NULL DEFAULT '[]',
  pass_count         INTEGER      NOT NULL DEFAULT 0,
  fail_count         INTEGER      NOT NULL DEFAULT 0,
  na_count           INTEGER      NOT NULL DEFAULT 0,
  overall_result     VARCHAR(20),
  notes              TEXT,
  photos             JSONB        NOT NULL DEFAULT '[]',
  signatures         JSONB        NOT NULL DEFAULT '[]',
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, inspection_number)
);
CREATE INDEX idx_inspections_project ON inspections(project_id, status);
CREATE INDEX idx_inspections_template ON inspections(template_id);
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_inspections ON inspections
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_inspections_updated_at BEFORE UPDATE ON inspections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
