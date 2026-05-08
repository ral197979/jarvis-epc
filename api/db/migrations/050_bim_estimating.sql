-- Migration 050: BIM Element Layer + Estimating Engine
-- Denver Engineering — Phase 10 (v10.0.0)
-- Extends the existing bim_models / bim_issues tables (migration 007)
-- with parsed element data, quantity takeoff, cost database, and estimates.

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE bim_element_status AS ENUM (
    'active', 'demolished', 'temporary', 'existing', 'new', 'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE takeoff_quantity_type AS ENUM (
    'count', 'length', 'area', 'volume', 'weight', 'duration'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estimate_status AS ENUM (
    'draft', 'in_review', 'approved', 'rejected', 'superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cost_source AS ENUM (
    'rsmeans', 'custom', 'historical', 'vendor_quote', 'ai_estimated'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── BIM Elements ─────────────────────────────────────────────────────────────
-- Parsed IFC elements extracted from a bim_model upload.

CREATE TABLE IF NOT EXISTS bim_elements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  model_id        UUID NOT NULL,                 -- → bim_models.id
  ifc_guid        TEXT NOT NULL,                 -- GlobalId from IFC spec (22-char base64)
  ifc_type        TEXT NOT NULL,                 -- IfcWall, IfcBeam, IfcDoor, IfcSpace, etc.
  name            TEXT,
  description     TEXT,
  discipline      TEXT,                          -- 'structural' | 'mechanical' | 'electrical' | etc.
  level           TEXT,                          -- storey / level name
  zone            TEXT,
  status          bim_element_status NOT NULL DEFAULT 'unknown',
  -- Geometry summary (no raw geometry stored — viewer handles that)
  bounding_box    JSONB,                         -- { min: {x,y,z}, max: {x,y,z} }
  centroid        JSONB,                         -- { x, y, z }
  -- Properties extracted from IFC property sets
  properties      JSONB NOT NULL DEFAULT '{}',   -- raw pset key-value pairs
  quantities      JSONB NOT NULL DEFAULT '{}',   -- BaseQuantities: Length, Area, Volume, etc.
  material        TEXT,
  load_bearing    BOOLEAN,
  is_external     BOOLEAN,
  -- Links to other platform entities
  asset_id        UUID,                          -- → assets.id if matched
  system_id       UUID,                          -- → systems.id if matched
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, model_id, ifc_guid)
);

CREATE INDEX IF NOT EXISTS idx_be_tenant_model   ON bim_elements (tenant_id, model_id);
CREATE INDEX IF NOT EXISTS idx_be_ifc_type       ON bim_elements (ifc_type, tenant_id);
CREATE INDEX IF NOT EXISTS idx_be_discipline     ON bim_elements (discipline, tenant_id);
CREATE INDEX IF NOT EXISTS idx_be_level          ON bim_elements (level, model_id);
CREATE INDEX IF NOT EXISTS idx_be_asset          ON bim_elements (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_be_system         ON bim_elements (system_id) WHERE system_id IS NOT NULL;

ALTER TABLE bim_elements ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bim_elements
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── BIM Element Links ────────────────────────────────────────────────────────
-- Polymorphic: tie a BIM element to any platform entity
-- (punch_item, deficiency, action, inspection_record, evidence_asset, etc.)

CREATE TABLE IF NOT EXISTS bim_element_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  element_id      UUID NOT NULL,               -- → bim_elements.id
  entity_type     TEXT NOT NULL,               -- 'action' | 'punch_item' | 'deficiency' | 'evidence' | etc.
  entity_id       UUID NOT NULL,
  linked_by       TEXT NOT NULL,               -- user id or 'system'
  context         TEXT,                        -- 'defect_location' | 'completion_proof' | etc.
  linked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, element_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_bel_element       ON bim_element_links (element_id);
CREATE INDEX IF NOT EXISTS idx_bel_entity        ON bim_element_links (tenant_id, entity_type, entity_id);

ALTER TABLE bim_element_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON bim_element_links
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── IFC Parse Jobs ───────────────────────────────────────────────────────────
-- Queue for async IFC element extraction (mirrors evidence_processing_jobs pattern).

CREATE TABLE IF NOT EXISTS ifc_parse_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  model_id        UUID NOT NULL,               -- → bim_models.id
  storage_key     TEXT NOT NULL,               -- S3/GCS key of the IFC file
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed
  attempts        INT NOT NULL DEFAULT 0,
  max_attempts    INT NOT NULL DEFAULT 3,
  run_after       TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until    TIMESTAMPTZ,
  locked_by       TEXT,
  elements_parsed INT,
  error           TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ipj_claim ON ifc_parse_jobs (status, run_after)
  WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_ipj_model ON ifc_parse_jobs (model_id);

ALTER TABLE ifc_parse_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ifc_parse_jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Cost Items ───────────────────────────────────────────────────────────────
-- Tenant-scoped cost database (RSMeans-compatible structure).
-- Seeded from RSMeans API or imported from CSV; can be overridden per tenant.

CREATE TABLE IF NOT EXISTS cost_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID,                        -- NULL = platform default (shared library)
  csi_division    TEXT NOT NULL,               -- e.g. '03' (Concrete)
  csi_section     TEXT NOT NULL,               -- e.g. '03 30 00'
  csi_code        TEXT NOT NULL,               -- full 6-part CSI code
  description     TEXT NOT NULL,
  unit            TEXT NOT NULL,               -- 'SF', 'LF', 'CY', 'EA', 'TON', etc.
  material_cost   NUMERIC(12,4) NOT NULL DEFAULT 0,
  labor_cost      NUMERIC(12,4) NOT NULL DEFAULT 0,
  equipment_cost  NUMERIC(12,4) NOT NULL DEFAULT 0,
  total_cost      NUMERIC(12,4) GENERATED ALWAYS AS (material_cost + labor_cost + equipment_cost) STORED,
  overhead_pct    NUMERIC(5,2) NOT NULL DEFAULT 15.00,   -- default 15 % O&P
  region          TEXT,                        -- RSMeans city/region code
  year            INT NOT NULL DEFAULT 2025,
  source          cost_source NOT NULL DEFAULT 'custom',
  source_ref      TEXT,                        -- RSMeans item ID or vendor quote ref
  is_active       BOOLEAN NOT NULL DEFAULT true,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ci_csi_section  ON cost_items (csi_section, region);
CREATE INDEX IF NOT EXISTS idx_ci_tenant       ON cost_items (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ci_csi_code     ON cost_items (csi_code);
CREATE INDEX IF NOT EXISTS idx_ci_description  ON cost_items USING gin(to_tsvector('english', description));

ALTER TABLE cost_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cost_items
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Takeoff Items ────────────────────────────────────────────────────────────
-- Quantities extracted from BIM elements (or manually entered).

CREATE TABLE IF NOT EXISTS takeoff_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  model_id        UUID NOT NULL,               -- → bim_models.id
  element_id      UUID,                        -- → bim_elements.id (null = manual)
  csi_section     TEXT,                        -- mapped CSI section
  description     TEXT NOT NULL,
  quantity_type   takeoff_quantity_type NOT NULL,
  quantity        NUMERIC(16,4) NOT NULL,
  unit            TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'bim', -- 'bim' | 'manual' | 'ai'
  confidence      NUMERIC(4,3),                -- 0–1 (AI-extracted)
  notes           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ti_tenant_model ON takeoff_items (tenant_id, model_id);
CREATE INDEX IF NOT EXISTS idx_ti_element      ON takeoff_items (element_id) WHERE element_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ti_csi          ON takeoff_items (csi_section, tenant_id);

ALTER TABLE takeoff_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON takeoff_items
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Estimates ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estimates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  project_id          UUID,                    -- → projects.id
  model_id            UUID,                    -- → bim_models.id (null = manual estimate)
  name                TEXT NOT NULL,
  description         TEXT,
  status              estimate_status NOT NULL DEFAULT 'draft',
  estimate_type       TEXT NOT NULL DEFAULT 'construction', -- 'construction' | 'design' | 'change_order' | 'budget'
  currency            TEXT NOT NULL DEFAULT 'USD',
  contingency_pct     NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  -- Rolled-up totals (computed by service, stored for fast reads)
  subtotal_material   NUMERIC(16,2) NOT NULL DEFAULT 0,
  subtotal_labor      NUMERIC(16,2) NOT NULL DEFAULT 0,
  subtotal_equipment  NUMERIC(16,2) NOT NULL DEFAULT 0,
  subtotal_cost       NUMERIC(16,2) NOT NULL DEFAULT 0,
  contingency_amount  NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_cost          NUMERIC(16,2) NOT NULL DEFAULT 0,
  -- Metadata
  region              TEXT,
  generated_by        TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'ava' | 'import'
  approved_by         TEXT,
  approved_at         TIMESTAMPTZ,
  notes               TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_est_tenant_project ON estimates (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_est_model          ON estimates (model_id) WHERE model_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_est_status         ON estimates (status, tenant_id);
CREATE INDEX IF NOT EXISTS idx_est_created        ON estimates (created_at);

ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON estimates
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Estimate Lines ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS estimate_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  estimate_id     UUID NOT NULL,               -- → estimates.id
  takeoff_id      UUID,                        -- → takeoff_items.id (null = manual line)
  cost_item_id    UUID,                        -- → cost_items.id (null = custom rate)
  csi_section     TEXT,
  description     TEXT NOT NULL,
  quantity        NUMERIC(16,4) NOT NULL,
  unit            TEXT NOT NULL,
  unit_material   NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit_labor      NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit_equipment  NUMERIC(12,4) NOT NULL DEFAULT 0,
  extended_material NUMERIC(16,2) GENERATED ALWAYS AS (quantity * unit_material) STORED,
  extended_labor    NUMERIC(16,2) GENERATED ALWAYS AS (quantity * unit_labor)    STORED,
  extended_equipment NUMERIC(16,2) GENERATED ALWAYS AS (quantity * unit_equipment) STORED,
  line_total      NUMERIC(16,2) GENERATED ALWAYS AS (quantity * (unit_material + unit_labor + unit_equipment)) STORED,
  notes           TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_el_estimate ON estimate_lines (estimate_id);
CREATE INDEX IF NOT EXISTS idx_el_takeoff  ON estimate_lines (takeoff_id) WHERE takeoff_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_el_csi      ON estimate_lines (csi_section, tenant_id);

ALTER TABLE estimate_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON estimate_lines
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
