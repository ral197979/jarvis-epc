-- ============================================================
-- JARVIS EPC  Migration 007: PM Modules (Procore/Autodesk Parity)
-- v4.31.0 | Daily Logs, Drawings + Markups, BIM Models, Budget, Change Orders
-- ============================================================

-- DAILY LOGS (Procore-parity field reporting)
CREATE TABLE daily_logs (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_date           DATE         NOT NULL,
  weather            VARCHAR(60),
  temp_f             NUMERIC(5,1),
  wind_mph           NUMERIC(5,1),
  humidity_pct       NUMERIC(5,1),
  manpower           JSONB        NOT NULL DEFAULT '[]',
  equipment          JSONB        NOT NULL DEFAULT '[]',
  visitors           JSONB        NOT NULL DEFAULT '[]',
  deliveries         JSONB        NOT NULL DEFAULT '[]',
  work_performed     TEXT,
  delays             TEXT,
  safety_notes       TEXT,
  incidents          JSONB        NOT NULL DEFAULT '[]',
  quality_notes      TEXT,
  photos             JSONB        NOT NULL DEFAULT '[]',
  status             VARCHAR(20)  NOT NULL DEFAULT 'draft',
  submitted_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
  submitted_at       TIMESTAMPTZ,
  approved_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  approved_at        TIMESTAMPTZ,
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, log_date)
);
CREATE INDEX idx_daily_logs_tenant  ON daily_logs(tenant_id);
CREATE INDEX idx_daily_logs_project ON daily_logs(project_id, log_date DESC);
CREATE INDEX idx_daily_logs_status  ON daily_logs(tenant_id, status);
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_daily_logs ON daily_logs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_daily_logs_updated_at BEFORE UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- DRAWINGS (Autodesk/Procore-parity plans register)
CREATE TABLE drawings (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sheet_number       VARCHAR(50)  NOT NULL,
  title              VARCHAR(255) NOT NULL,
  discipline         VARCHAR(60),
  current_rev        VARCHAR(20)  NOT NULL DEFAULT 'A',
  set_name           VARCHAR(120),
  issue_date         DATE,
  document_id        UUID         REFERENCES documents(id) ON DELETE SET NULL,
  scale              VARCHAR(40),
  page_count         INTEGER      NOT NULL DEFAULT 1,
  metadata           JSONB        NOT NULL DEFAULT '{}',
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, sheet_number, current_rev)
);
CREATE INDEX idx_drawings_tenant   ON drawings(tenant_id);
CREATE INDEX idx_drawings_project  ON drawings(project_id, discipline, sheet_number);
ALTER TABLE drawings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_drawings ON drawings
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_drawings_updated_at BEFORE UPDATE ON drawings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE drawing_revisions (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  drawing_id         UUID         NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  rev                VARCHAR(20)  NOT NULL,
  issued_date        DATE         NOT NULL,
  reason             TEXT,
  document_id        UUID         REFERENCES documents(id) ON DELETE SET NULL,
  issued_by          UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (drawing_id, rev)
);
CREATE INDEX idx_drawing_revisions_drawing ON drawing_revisions(drawing_id, issued_date DESC);
ALTER TABLE drawing_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_drawing_revisions ON drawing_revisions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TABLE drawing_markups (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  drawing_id         UUID         NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  rev                VARCHAR(20)  NOT NULL,
  page               INTEGER      NOT NULL DEFAULT 1,
  title              VARCHAR(200),
  annotations        JSONB        NOT NULL DEFAULT '[]',
  resolved           BOOLEAN      NOT NULL DEFAULT FALSE,
  resolved_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  resolved_at        TIMESTAMPTZ,
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_drawing_markups_drawing ON drawing_markups(drawing_id, rev, page);
CREATE INDEX idx_drawing_markups_open    ON drawing_markups(tenant_id, resolved) WHERE resolved = FALSE;
ALTER TABLE drawing_markups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_drawing_markups ON drawing_markups
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_drawing_markups_updated_at BEFORE UPDATE ON drawing_markups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- BIM MODELS (Autodesk parity - IFC / glTF 3D coordination)
CREATE TABLE bim_models (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name               VARCHAR(200) NOT NULL,
  discipline         VARCHAR(60),
  format             VARCHAR(20)  NOT NULL,
  document_id        UUID         REFERENCES documents(id) ON DELETE SET NULL,
  size_bytes         BIGINT       NOT NULL DEFAULT 0,
  element_count      INTEGER,
  coord_system       VARCHAR(60),
  georef             JSONB        NOT NULL DEFAULT '{}',
  metadata           JSONB        NOT NULL DEFAULT '{}',
  status             VARCHAR(20)  NOT NULL DEFAULT 'active',
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bim_models_tenant  ON bim_models(tenant_id);
CREATE INDEX idx_bim_models_project ON bim_models(project_id);
ALTER TABLE bim_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bim_models ON bim_models
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_bim_models_updated_at BEFORE UPDATE ON bim_models
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE bim_issues (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_id           UUID         REFERENCES bim_models(id) ON DELETE SET NULL,
  title              VARCHAR(200) NOT NULL,
  description        TEXT,
  severity           VARCHAR(20)  NOT NULL DEFAULT 'minor',
  status             VARCHAR(20)  NOT NULL DEFAULT 'open',
  element_ids        JSONB        NOT NULL DEFAULT '[]',
  viewpoint          JSONB        NOT NULL DEFAULT '{}',
  assigned_to        UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bim_issues_project ON bim_issues(project_id, status);
ALTER TABLE bim_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bim_issues ON bim_issues
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_bim_issues_updated_at BEFORE UPDATE ON bim_issues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- BUDGET AND COST CONTROL (Procore Financials parity)
CREATE TABLE budgets (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name               VARCHAR(200) NOT NULL DEFAULT 'Project Budget',
  currency           VARCHAR(10)  NOT NULL DEFAULT 'USD',
  original_total     NUMERIC(18,2) NOT NULL DEFAULT 0,
  revised_total      NUMERIC(18,2) NOT NULL DEFAULT 0,
  committed_total    NUMERIC(18,2) NOT NULL DEFAULT 0,
  actual_total       NUMERIC(18,2) NOT NULL DEFAULT 0,
  forecast_total     NUMERIC(18,2) NOT NULL DEFAULT 0,
  baseline_date      DATE,
  status             VARCHAR(20)  NOT NULL DEFAULT 'draft',
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id)
);
CREATE INDEX idx_budgets_tenant  ON budgets(tenant_id);
CREATE INDEX idx_budgets_project ON budgets(project_id);
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_budgets ON budgets
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_budgets_updated_at BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE budget_items (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  budget_id          UUID         NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  cost_code          VARCHAR(40)  NOT NULL,
  description        VARCHAR(500) NOT NULL,
  category           VARCHAR(60),
  unit               VARCHAR(20),
  qty                NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit_cost          NUMERIC(14,4) NOT NULL DEFAULT 0,
  original_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
  revised_amount     NUMERIC(18,2) NOT NULL DEFAULT 0,
  committed_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,
  actual_amount      NUMERIC(18,2) NOT NULL DEFAULT 0,
  forecast_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes              TEXT,
  sort_order         INTEGER       NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_budget_items_budget ON budget_items(budget_id, sort_order);
CREATE INDEX idx_budget_items_cost_code ON budget_items(tenant_id, cost_code);
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_budget_items ON budget_items
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_budget_items_updated_at BEFORE UPDATE ON budget_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Change Orders (Owner COs and PCO / Prime COs)
CREATE TABLE change_orders (
  id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  co_number          VARCHAR(40)  NOT NULL,
  co_type            VARCHAR(20)  NOT NULL DEFAULT 'PCO',
  title              VARCHAR(255) NOT NULL,
  description        TEXT,
  reason_code        VARCHAR(60),
  amount             NUMERIC(18,2) NOT NULL DEFAULT 0,
  schedule_days      INTEGER       NOT NULL DEFAULT 0,
  status             VARCHAR(20)  NOT NULL DEFAULT 'draft',
  submitted_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
  submitted_at       TIMESTAMPTZ,
  approved_by        UUID         REFERENCES users(id) ON DELETE SET NULL,
  approved_at        TIMESTAMPTZ,
  executed_at        TIMESTAMPTZ,
  cost_code          VARCHAR(40),
  created_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, project_id, co_number)
);
CREATE INDEX idx_change_orders_project ON change_orders(project_id, status);
ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_change_orders ON change_orders
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE TRIGGER trg_change_orders_updated_at BEFORE UPDATE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Helper: budget rollup view
CREATE OR REPLACE VIEW budget_rollup AS
SELECT
  b.id AS budget_id,
  b.project_id,
  b.tenant_id,
  b.currency,
  COALESCE(SUM(bi.original_amount),  0) AS original_total,
  COALESCE(SUM(bi.revised_amount),   0) AS revised_total,
  COALESCE(SUM(bi.committed_amount), 0) AS committed_total,
  COALESCE(SUM(bi.actual_amount),    0) AS actual_total,
  COALESCE(SUM(bi.forecast_amount),  0) AS forecast_total,
  COUNT(bi.id) AS item_count
FROM budgets b
LEFT JOIN budget_items bi ON bi.budget_id = b.id
GROUP BY b.id;
