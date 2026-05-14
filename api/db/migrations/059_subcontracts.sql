-- ============================================================
-- Denver Engineering — Migration 059: Bid Packages & Subcontracts
-- v10.8.0
--
-- Adds construction subcontract management on top of the existing
-- vendors table (migration 002). Pipeline:
--
--   Bid Package (draft → issued → closed → awarded | cancelled)
--     └── Bid Submissions (pending → accepted | declined)
--         └── Subcontract (active → complete | terminated | suspended)
--               └── Subcontract Invoices (draft → submitted → approved | rejected)
-- ============================================================

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bid_pkg_status') THEN
    CREATE TYPE bid_pkg_status AS ENUM ('draft','issued','closed','awarded','cancelled');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bid_sub_status') THEN
    CREATE TYPE bid_sub_status AS ENUM ('pending','accepted','declined','withdrawn');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subcontract_status') THEN
    CREATE TYPE subcontract_status AS ENUM ('active','suspended','complete','terminated');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sc_invoice_status') THEN
    CREATE TYPE sc_invoice_status AS ENUM ('draft','submitted','approved','rejected');
  END IF;
END $$;

-- ─── Bid packages ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bid_packages (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID           NOT NULL,
  project_id        UUID           NOT NULL,
  change_order_id   UUID,                              -- optional CO linkage
  pkg_number        INTEGER        NOT NULL,           -- auto-seq per project
  title             TEXT           NOT NULL,
  scope             TEXT,
  csi_code          VARCHAR(20),                       -- CSI MasterFormat division
  status            bid_pkg_status NOT NULL DEFAULT 'draft',
  budget_amount     NUMERIC(18,2),
  bid_due_date      DATE,
  issued_at         TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  awarded_at        TIMESTAMPTZ,
  created_by        UUID,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, pkg_number)
);

ALTER TABLE bid_packages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bid_packages_tenant ON bid_packages;
CREATE POLICY bid_packages_tenant ON bid_packages
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS bid_packages_project_idx ON bid_packages (tenant_id, project_id, status);

-- ─── Bid submissions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bid_submissions (
  id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID           NOT NULL,
  bid_package_id  UUID           NOT NULL REFERENCES bid_packages(id) ON DELETE CASCADE,
  vendor_id       UUID           NOT NULL,             -- FK to vendors table
  status          bid_sub_status NOT NULL DEFAULT 'pending',
  bid_amount      NUMERIC(18,2),
  notes           TEXT,
  submitted_at    TIMESTAMPTZ    NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID,
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (bid_package_id, vendor_id)
);

ALTER TABLE bid_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bid_submissions_tenant ON bid_submissions;
CREATE POLICY bid_submissions_tenant ON bid_submissions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS bid_subs_pkg_idx ON bid_submissions (bid_package_id);
CREATE INDEX IF NOT EXISTS bid_subs_vendor_idx ON bid_submissions (tenant_id, vendor_id);

-- ─── Subcontracts ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subcontracts (
  id                UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID               NOT NULL,
  project_id        UUID               NOT NULL,
  bid_package_id    UUID               REFERENCES bid_packages(id) ON DELETE SET NULL,
  bid_submission_id UUID               REFERENCES bid_submissions(id) ON DELETE SET NULL,
  vendor_id         UUID               NOT NULL,
  sc_number         INTEGER            NOT NULL,       -- auto-seq per project
  title             TEXT               NOT NULL,
  scope             TEXT,
  status            subcontract_status NOT NULL DEFAULT 'active',
  contract_value    NUMERIC(18,2)      NOT NULL DEFAULT 0,
  retention_pct     NUMERIC(5,2)       NOT NULL DEFAULT 10, -- % held back
  start_date        DATE,
  end_date          DATE,
  executed_at       TIMESTAMPTZ,
  created_by        UUID,
  created_at        TIMESTAMPTZ        NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ        NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_id, sc_number)
);

ALTER TABLE subcontracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS subcontracts_tenant ON subcontracts;
CREATE POLICY subcontracts_tenant ON subcontracts
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS subcontracts_project_idx ON subcontracts (tenant_id, project_id, status);
CREATE INDEX IF NOT EXISTS subcontracts_vendor_idx  ON subcontracts (tenant_id, vendor_id);

-- ─── Subcontract invoices ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subcontract_invoices (
  id               UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID              NOT NULL,
  subcontract_id   UUID              NOT NULL REFERENCES subcontracts(id) ON DELETE CASCADE,
  inv_number       INTEGER           NOT NULL,         -- auto-seq per subcontract
  period_start     DATE              NOT NULL,
  period_end       DATE              NOT NULL,
  gross_amount     NUMERIC(18,2)     NOT NULL DEFAULT 0,
  retention_held   NUMERIC(18,2)     NOT NULL DEFAULT 0,
  net_amount       NUMERIC(18,2)     NOT NULL DEFAULT 0,
  status           sc_invoice_status NOT NULL DEFAULT 'draft',
  submitted_at     TIMESTAMPTZ,
  reviewed_by      UUID,
  reviewed_at      TIMESTAMPTZ,
  review_notes     TEXT,
  created_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ       NOT NULL DEFAULT now(),
  UNIQUE (subcontract_id, inv_number)
);

ALTER TABLE subcontract_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sc_invoices_tenant ON subcontract_invoices;
CREATE POLICY sc_invoices_tenant ON subcontract_invoices
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS sc_invoices_sc_idx ON subcontract_invoices (subcontract_id);
