-- ============================================================
-- JARVIS EPC — Migration 002: EPC Core Domain Schema
-- v4.26.0 | Projects, Procurement, Engineering, Commissioning
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- ENUMS — EPC Domain
-- ──────────────────────────────────────────────────────────────

CREATE TYPE project_status   AS ENUM ('planning', 'active', 'on_hold', 'completed', 'cancelled');
CREATE TYPE project_phase     AS ENUM ('feasibility', 'feed', 'detailed_design', 'procurement', 'construction', 'commissioning', 'closeout');
CREATE TYPE contract_type     AS ENUM ('lump_sum', 'reimbursable', 'unit_rate', 'gmp', 'ep', 'epc', 'epcm');
CREATE TYPE contract_status   AS ENUM ('draft', 'negotiation', 'active', 'variation', 'closed', 'disputed');
CREATE TYPE vendor_status     AS ENUM ('prospect', 'qualified', 'approved', 'preferred', 'suspended', 'blacklisted');
CREATE TYPE po_status         AS ENUM ('draft', 'pending_approval', 'approved', 'issued', 'partial_delivery', 'delivered', 'invoiced', 'closed', 'cancelled');
CREATE TYPE rfi_status        AS ENUM ('open', 'pending', 'answered', 'closed');
CREATE TYPE submittal_status  AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected');
CREATE TYPE wir_status        AS ENUM ('open', 'in_progress', 'completed', 'failed', 'waived');
CREATE TYPE priority_level    AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE risk_likelihood   AS ENUM ('rare', 'unlikely', 'possible', 'likely', 'almost_certain');
CREATE TYPE risk_impact       AS ENUM ('negligible', 'minor', 'moderate', 'major', 'catastrophic');
CREATE TYPE action_status     AS ENUM ('open', 'in_progress', 'overdue', 'completed', 'cancelled');

-- ──────────────────────────────────────────────────────────────
-- PROJECTS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE projects (
  id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code              VARCHAR(50)  NOT NULL,
  name              VARCHAR(255) NOT NULL,
  description       TEXT,
  client_name       VARCHAR(255),
  location          VARCHAR(255),
  country           CHAR(2),                       -- ISO 3166-1 alpha-2
  status            project_status NOT NULL DEFAULT 'planning',
  current_phase     project_phase,
  contract_type     contract_type,
  currency          CHAR(3) NOT NULL DEFAULT 'USD',
  budget            NUMERIC(18,2),
  committed_cost    NUMERIC(18,2) DEFAULT 0,
  actual_cost       NUMERIC(18,2) DEFAULT 0,
  forecast_cost     NUMERIC(18,2) DEFAULT 0,
  contingency_pct   NUMERIC(5,2)  DEFAULT 10,
  planned_start     DATE,
  planned_finish    DATE,
  actual_start      DATE,
  actual_finish     DATE,
  progress_pct      NUMERIC(5,2)  DEFAULT 0,
  project_manager   UUID          REFERENCES users(id) ON DELETE SET NULL,
  lead_engineer     UUID          REFERENCES users(id) ON DELETE SET NULL,
  metadata          JSONB         NOT NULL DEFAULT '{}',
  created_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

CREATE INDEX idx_projects_tenant  ON projects(tenant_id);
CREATE INDEX idx_projects_status  ON projects(tenant_id, status);
CREATE INDEX idx_projects_phase   ON projects(tenant_id, current_phase);
CREATE INDEX idx_projects_pm      ON projects(project_manager);
CREATE INDEX idx_projects_name_trgm ON projects USING gin(name gin_trgm_ops);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_projects ON projects
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- VENDORS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE vendors (
  id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            VARCHAR(50)  NOT NULL,
  name            VARCHAR(255) NOT NULL,
  type            VARCHAR(100),                    -- 'contractor', 'supplier', 'consultant'
  status          vendor_status NOT NULL DEFAULT 'prospect',
  country         CHAR(2),
  address         TEXT,
  primary_contact VARCHAR(255),
  email           VARCHAR(255),
  phone           VARCHAR(50),
  website         VARCHAR(512),
  tax_id          VARCHAR(100),
  payment_terms   VARCHAR(100),
  currency        CHAR(3) DEFAULT 'USD',
  rating          NUMERIC(3,2) CHECK (rating BETWEEN 0 AND 5),
  approved_at     TIMESTAMPTZ,
  approved_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  categories      TEXT[],
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

CREATE INDEX idx_vendors_tenant ON vendors(tenant_id);
CREATE INDEX idx_vendors_status ON vendors(tenant_id, status);
CREATE INDEX idx_vendors_type   ON vendors(tenant_id, type);
CREATE INDEX idx_vendors_name_trgm ON vendors USING gin(name gin_trgm_ops);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_vendors ON vendors
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_vendors_updated_at BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- CONTRACTS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE contracts (
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID            NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      UUID            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vendor_id       UUID            NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  contract_number VARCHAR(100)    NOT NULL,
  title           VARCHAR(255)    NOT NULL,
  type            contract_type   NOT NULL,
  status          contract_status NOT NULL DEFAULT 'draft',
  scope           TEXT,
  currency        CHAR(3)         DEFAULT 'USD',
  original_value  NUMERIC(18,2)   NOT NULL DEFAULT 0,
  approved_value  NUMERIC(18,2)   NOT NULL DEFAULT 0,
  invoiced_amount NUMERIC(18,2)   NOT NULL DEFAULT 0,
  paid_amount     NUMERIC(18,2)   NOT NULL DEFAULT 0,
  retention_pct   NUMERIC(5,2)    DEFAULT 10,
  start_date      DATE,
  end_date        DATE,
  executed_date   DATE,
  metadata        JSONB           NOT NULL DEFAULT '{}',
  created_by      UUID            REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, contract_number)
);

CREATE INDEX idx_contracts_tenant  ON contracts(tenant_id);
CREATE INDEX idx_contracts_project ON contracts(project_id);
CREATE INDEX idx_contracts_vendor  ON contracts(vendor_id);
CREATE INDEX idx_contracts_status  ON contracts(tenant_id, status);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_contracts ON contracts
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_contracts_updated_at BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- PURCHASE ORDERS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE purchase_orders (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  vendor_id       UUID        NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  contract_id     UUID        REFERENCES contracts(id) ON DELETE SET NULL,
  po_number       VARCHAR(100) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  status          po_status   NOT NULL DEFAULT 'draft',
  currency        CHAR(3)     DEFAULT 'USD',
  subtotal        NUMERIC(18,2) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(18,2) NOT NULL DEFAULT 0,
  received_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  required_date   DATE,
  issued_date     DATE,
  delivery_date   DATE,
  approved_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  approved_at     TIMESTAMPTZ,
  line_items      JSONB       NOT NULL DEFAULT '[]',   -- embedded for simplicity
  shipping_to     TEXT,
  notes           TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, po_number)
);

CREATE INDEX idx_po_tenant   ON purchase_orders(tenant_id);
CREATE INDEX idx_po_project  ON purchase_orders(project_id);
CREATE INDEX idx_po_vendor   ON purchase_orders(vendor_id);
CREATE INDEX idx_po_status   ON purchase_orders(tenant_id, status);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_po ON purchase_orders
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_po_updated_at BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- RFIs
-- ──────────────────────────────────────────────────────────────

CREATE TABLE rfis (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rfi_number      VARCHAR(50) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  status          rfi_status  NOT NULL DEFAULT 'open',
  priority        priority_level NOT NULL DEFAULT 'medium',
  discipline      VARCHAR(100),
  raised_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  assigned_to     UUID        REFERENCES users(id) ON DELETE SET NULL,
  response        TEXT,
  response_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  due_date        DATE,
  responded_at    TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, project_id, rfi_number)
);

CREATE INDEX idx_rfis_tenant  ON rfis(tenant_id);
CREATE INDEX idx_rfis_project ON rfis(project_id);
CREATE INDEX idx_rfis_status  ON rfis(tenant_id, status);

ALTER TABLE rfis ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_rfis ON rfis
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_rfis_updated_at BEFORE UPDATE ON rfis
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- SUBMITTALS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE submittals (
  id                UUID             PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID             NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        UUID             NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  submittal_number  VARCHAR(50)      NOT NULL,
  title             VARCHAR(255)     NOT NULL,
  type              VARCHAR(100),
  status            submittal_status NOT NULL DEFAULT 'draft',
  discipline        VARCHAR(100),
  spec_section      VARCHAR(50),
  submitted_by      UUID             REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by       UUID             REFERENCES users(id) ON DELETE SET NULL,
  review_notes      TEXT,
  due_date          DATE,
  submitted_at      TIMESTAMPTZ,
  reviewed_at       TIMESTAMPTZ,
  metadata          JSONB            NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, project_id, submittal_number)
);

CREATE INDEX idx_submittals_tenant  ON submittals(tenant_id);
CREATE INDEX idx_submittals_project ON submittals(project_id);
CREATE INDEX idx_submittals_status  ON submittals(tenant_id, status);

ALTER TABLE submittals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_submittals ON submittals
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_submittals_updated_at BEFORE UPDATE ON submittals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- COMMISSIONING — WORK INSPECTION RECORDS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE wirs (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id      UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  wir_number      VARCHAR(50) NOT NULL,
  title           VARCHAR(255) NOT NULL,
  discipline      VARCHAR(100),
  system_tag      VARCHAR(100),
  status          wir_status  NOT NULL DEFAULT 'open',
  inspection_type VARCHAR(100),
  required_by     DATE,
  scheduled_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  inspector       UUID        REFERENCES users(id) ON DELETE SET NULL,
  witness         UUID        REFERENCES users(id) ON DELETE SET NULL,
  punch_items     JSONB       NOT NULL DEFAULT '[]',
  test_data       JSONB       NOT NULL DEFAULT '{}',
  result_notes    TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, project_id, wir_number)
);

CREATE INDEX idx_wirs_tenant   ON wirs(tenant_id);
CREATE INDEX idx_wirs_project  ON wirs(project_id);
CREATE INDEX idx_wirs_status   ON wirs(tenant_id, status);
CREATE INDEX idx_wirs_tag      ON wirs(tenant_id, system_tag);

ALTER TABLE wirs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_wirs ON wirs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_wirs_updated_at BEFORE UPDATE ON wirs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- ACTION ITEMS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE action_items (
  id            UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    UUID          REFERENCES projects(id) ON DELETE CASCADE,
  title         VARCHAR(255)  NOT NULL,
  description   TEXT,
  status        action_status NOT NULL DEFAULT 'open',
  priority      priority_level NOT NULL DEFAULT 'medium',
  assigned_to   UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
  due_date      DATE,
  completed_at  TIMESTAMPTZ,
  source_type   VARCHAR(50),  -- 'rfi', 'wir', 'meeting', 'manual'
  source_id     UUID,
  metadata      JSONB         NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_action_tenant   ON action_items(tenant_id);
CREATE INDEX idx_action_project  ON action_items(project_id);
CREATE INDEX idx_action_assigned ON action_items(assigned_to, status);
CREATE INDEX idx_action_status   ON action_items(tenant_id, status);

ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_actions ON action_items
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_actions_updated_at BEFORE UPDATE ON action_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- RISK REGISTER
-- ──────────────────────────────────────────────────────────────

CREATE TABLE risks (
  id            UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID           NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    UUID           NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  risk_number   VARCHAR(50)    NOT NULL,
  title         VARCHAR(255)   NOT NULL,
  description   TEXT,
  category      VARCHAR(100),
  likelihood    risk_likelihood NOT NULL DEFAULT 'possible',
  impact        risk_impact     NOT NULL DEFAULT 'moderate',
  risk_score    INTEGER GENERATED ALWAYS AS (
    CASE likelihood
      WHEN 'rare'           THEN 1
      WHEN 'unlikely'       THEN 2
      WHEN 'possible'       THEN 3
      WHEN 'likely'         THEN 4
      WHEN 'almost_certain' THEN 5
    END *
    CASE impact
      WHEN 'negligible'   THEN 1
      WHEN 'minor'        THEN 2
      WHEN 'moderate'     THEN 3
      WHEN 'major'        THEN 4
      WHEN 'catastrophic' THEN 5
    END
  ) STORED,
  mitigation    TEXT,
  contingency   TEXT,
  owner         UUID           REFERENCES users(id) ON DELETE SET NULL,
  status        VARCHAR(50)    NOT NULL DEFAULT 'open',
  closed_at     TIMESTAMPTZ,
  metadata      JSONB          NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, project_id, risk_number)
);

CREATE INDEX idx_risks_tenant  ON risks(tenant_id);
CREATE INDEX idx_risks_project ON risks(project_id);
CREATE INDEX idx_risks_score   ON risks(tenant_id, risk_score DESC);

ALTER TABLE risks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_risks ON risks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_risks_updated_at BEFORE UPDATE ON risks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- CRM LEADS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE crm_leads (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company       VARCHAR(255) NOT NULL,
  contact_name  VARCHAR(255),
  email         VARCHAR(255),
  phone         VARCHAR(50),
  stage         VARCHAR(50)  NOT NULL DEFAULT 'prospecting',
  value         NUMERIC(18,2),
  probability   NUMERIC(5,2),
  source        VARCHAR(100),
  notes         TEXT,
  assigned_to   UUID        REFERENCES users(id) ON DELETE SET NULL,
  expected_close DATE,
  project_id    UUID        REFERENCES projects(id) ON DELETE SET NULL,
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crm_tenant ON crm_leads(tenant_id);
CREATE INDEX idx_crm_stage  ON crm_leads(tenant_id, stage);
CREATE INDEX idx_crm_name_trgm ON crm_leads USING gin(company gin_trgm_ops);

ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_crm ON crm_leads
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_crm_updated_at BEFORE UPDATE ON crm_leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Grant new tables to app role
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jarvis_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jarvis_app;
