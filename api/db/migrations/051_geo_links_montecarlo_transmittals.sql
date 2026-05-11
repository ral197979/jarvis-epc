-- Migration 051: Geometry-Linked Defects + Monte Carlo Risk Simulation + Transmittals
-- Denver Engineering — Phase 10 (v10.1.0)

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 1: GEOMETRY-LINKED DEFECTS
-- Adds bim_element_id to punch_items, deficiencies, bim_issues, and actions.
-- Uses the polymorphic bim_element_links table (migration 050) as the join
-- layer — no hard FKs on legacy tables, so zero downtime on existing rows.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Nullable BIM element reference on punch_items (soft link — no FK cascade)
ALTER TABLE punch_items
  ADD COLUMN IF NOT EXISTS bim_element_id UUID,
  ADD COLUMN IF NOT EXISTS bim_model_id   UUID,
  ADD COLUMN IF NOT EXISTS ifc_guid       TEXT;

CREATE INDEX IF NOT EXISTS idx_punch_items_bim_element
  ON punch_items (bim_element_id) WHERE bim_element_id IS NOT NULL;

-- Same on deficiencies
ALTER TABLE deficiencies
  ADD COLUMN IF NOT EXISTS bim_element_id UUID,
  ADD COLUMN IF NOT EXISTS bim_model_id   UUID,
  ADD COLUMN IF NOT EXISTS ifc_guid       TEXT;

CREATE INDEX IF NOT EXISTS idx_deficiencies_bim_element
  ON deficiencies (bim_element_id) WHERE bim_element_id IS NOT NULL;

-- Same on bim_issues (element_ids was JSONB; now also a direct scalar link)
ALTER TABLE bim_issues
  ADD COLUMN IF NOT EXISTS primary_element_id UUID,
  ADD COLUMN IF NOT EXISTS ifc_guid           TEXT;

CREATE INDEX IF NOT EXISTS idx_bim_issues_element
  ON bim_issues (primary_element_id) WHERE primary_element_id IS NOT NULL;

-- Same on actions (source_id already polymorphic; add BIM element context)
ALTER TABLE actions
  ADD COLUMN IF NOT EXISTS bim_element_id UUID,
  ADD COLUMN IF NOT EXISTS bim_model_id   UUID;

CREATE INDEX IF NOT EXISTS idx_actions_bim_element
  ON actions (bim_element_id) WHERE bim_element_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 2: MONTE CARLO RISK SIMULATION
-- Extends the simulation engine (migration 042) with probabilistic schedule
-- risk analysis. Adds three-point estimates per task, iteration results,
-- and distribution outputs (P10/P50/P80/P90).
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE risk_distribution AS ENUM (
    'triangular',   -- (optimistic, most_likely, pessimistic) — default
    'pert',         -- weighted triangular: (O + 4*ML + P) / 6
    'uniform',      -- equal probability between min and max
    'lognormal'     -- for cost/duration skew
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE monte_carlo_status AS ENUM (
    'pending', 'running', 'completed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Monte Carlo simulation runs (linked to a project + optional schedule)
CREATE TABLE IF NOT EXISTS monte_carlo_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  project_id        UUID,
  name              TEXT NOT NULL,
  description       TEXT,
  status            monte_carlo_status NOT NULL DEFAULT 'pending',
  iteration_count   INT NOT NULL DEFAULT 10000,
  seed              BIGINT,                        -- for reproducibility
  -- Output distribution for project completion date
  p10_days          NUMERIC(8,2),                  -- 10th percentile duration
  p50_days          NUMERIC(8,2),                  -- median
  p80_days          NUMERIC(8,2),                  -- 80th percentile
  p90_days          NUMERIC(8,2),                  -- 90th percentile
  deterministic_days NUMERIC(8,2),                 -- CPM baseline (no risk)
  schedule_risk_index NUMERIC(5,4),                -- (P80 - P50) / P50
  -- Cost outputs
  p10_cost          NUMERIC(16,2),
  p50_cost          NUMERIC(16,2),
  p80_cost          NUMERIC(16,2),
  p90_cost          NUMERIC(16,2),
  -- Critical path sensitivity
  criticality_index JSONB NOT NULL DEFAULT '{}',   -- task_id → % iterations on critical path
  cruciality_index  JSONB NOT NULL DEFAULT '{}',   -- task_id → correlation with project duration
  -- Metadata
  generated_by      TEXT NOT NULL DEFAULT 'ava',
  completed_at      TIMESTAMPTZ,
  error             TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcr_tenant_project ON monte_carlo_runs (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_mcr_status         ON monte_carlo_runs (status, tenant_id);
CREATE INDEX IF NOT EXISTS idx_mcr_created        ON monte_carlo_runs (created_at);

ALTER TABLE monte_carlo_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON monte_carlo_runs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Three-point estimates per task/activity for a Monte Carlo run
CREATE TABLE IF NOT EXISTS monte_carlo_inputs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL,                 -- → monte_carlo_runs.id
  tenant_id         UUID NOT NULL,
  task_id           UUID,                          -- → schedule tasks (optional)
  task_name         TEXT NOT NULL,
  -- Duration estimates (days)
  duration_optimistic   NUMERIC(8,2) NOT NULL,
  duration_most_likely  NUMERIC(8,2) NOT NULL,
  duration_pessimistic  NUMERIC(8,2) NOT NULL,
  duration_distribution risk_distribution NOT NULL DEFAULT 'triangular',
  -- Cost estimates (USD)
  cost_optimistic       NUMERIC(14,2),
  cost_most_likely      NUMERIC(14,2),
  cost_pessimistic      NUMERIC(14,2),
  cost_distribution     risk_distribution NOT NULL DEFAULT 'triangular',
  -- Risk drivers
  risk_factors      JSONB NOT NULL DEFAULT '[]',   -- [{ factor, impact_pct, probability }]
  -- Sequence
  predecessors      UUID[] NOT NULL DEFAULT '{}',  -- other input IDs
  is_critical       BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mci_run ON monte_carlo_inputs (run_id);

ALTER TABLE monte_carlo_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON monte_carlo_inputs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Iteration-level results (sampled — not every iteration stored, just percentile buckets)
CREATE TABLE IF NOT EXISTS monte_carlo_iterations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL,
  tenant_id         UUID NOT NULL,
  iteration_number  INT NOT NULL,
  total_days        NUMERIC(8,2) NOT NULL,
  total_cost        NUMERIC(16,2),
  critical_path_ids UUID[] NOT NULL DEFAULT '{}',  -- task IDs on critical path this iteration
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only store a sample (every 100th iteration) — P-values computed in service
CREATE INDEX IF NOT EXISTS idx_mci_run_iter ON monte_carlo_iterations (run_id, iteration_number);

ALTER TABLE monte_carlo_iterations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON monte_carlo_iterations
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Risk tornado chart data (top contributors to schedule variance)
CREATE TABLE IF NOT EXISTS monte_carlo_sensitivity (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID NOT NULL,
  tenant_id         UUID NOT NULL,
  task_id           UUID,
  task_name         TEXT NOT NULL,
  correlation_coeff NUMERIC(7,6) NOT NULL,         -- Spearman ρ with project duration
  criticality_pct   NUMERIC(5,2) NOT NULL,         -- % of iterations on critical path
  duration_variance NUMERIC(8,2) NOT NULL,         -- pessimistic - optimistic
  rank              INT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mcs_run ON monte_carlo_sensitivity (run_id, rank);

ALTER TABLE monte_carlo_sensitivity ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON monte_carlo_sensitivity
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 3: TRANSMITTALS / DOCUMENT CONTROL
-- Aconex/Procore-parity transmittal workflow on top of existing documents
-- and evidence_assets. Immutable send log with response tracking.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE transmittal_status AS ENUM (
    'draft', 'sent', 'received', 'under_review', 'actioned', 'closed', 'voided'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transmittal_purpose AS ENUM (
    'for_approval',
    'for_information',
    'for_construction',
    'for_record',
    'for_comment',
    'for_review',
    'as_built'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transmittal_response AS ENUM (
    'approved',
    'approved_with_comments',
    'revise_and_resubmit',
    'rejected',
    'received',
    'no_exception_taken',
    'pending'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Transmittal register
CREATE TABLE IF NOT EXISTS transmittals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  project_id        UUID,
  transmittal_number TEXT NOT NULL,                -- auto-generated: TRN-0001
  subject           TEXT NOT NULL,
  purpose           transmittal_purpose NOT NULL DEFAULT 'for_information',
  status            transmittal_status NOT NULL DEFAULT 'draft',
  from_party        TEXT NOT NULL,                 -- company / org name
  to_party          TEXT NOT NULL,
  from_user         TEXT,                          -- user id or name
  to_contacts       JSONB NOT NULL DEFAULT '[]',   -- [{ name, email, company }]
  cc_contacts       JSONB NOT NULL DEFAULT '[]',
  response_required BOOLEAN NOT NULL DEFAULT false,
  response_due_date DATE,
  response          transmittal_response NOT NULL DEFAULT 'pending',
  response_notes    TEXT,
  responded_by      TEXT,
  responded_at      TIMESTAMPTZ,
  sent_at           TIMESTAMPTZ,
  received_at       TIMESTAMPTZ,
  notes             TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_number ON transmittals (tenant_id, project_id, transmittal_number);
CREATE INDEX IF NOT EXISTS idx_tx_tenant_project ON transmittals (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS idx_tx_status         ON transmittals (status, tenant_id);
CREATE INDEX IF NOT EXISTS idx_tx_purpose        ON transmittals (purpose, tenant_id);
CREATE INDEX IF NOT EXISTS idx_tx_response_due   ON transmittals (response_due_date)
  WHERE response_due_date IS NOT NULL AND status NOT IN ('closed','voided');

ALTER TABLE transmittals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transmittals
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Documents attached to a transmittal (links to evidence_assets or documents table)
CREATE TABLE IF NOT EXISTS transmittal_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  transmittal_id    UUID NOT NULL,
  -- Polymorphic: one of these will be set
  evidence_id       UUID,                          -- → evidence_assets.id
  document_id       UUID,                          -- → documents.id
  -- Override metadata for transmittal context
  rev               TEXT,                          -- document revision
  description       TEXT,
  copies            INT NOT NULL DEFAULT 1,
  sequence          INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_txi_transmittal ON transmittal_items (transmittal_id);
CREATE INDEX IF NOT EXISTS idx_txi_evidence    ON transmittal_items (evidence_id) WHERE evidence_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_txi_document    ON transmittal_items (document_id) WHERE document_id IS NOT NULL;

ALTER TABLE transmittal_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transmittal_items
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Immutable transmittal event log
CREATE TABLE IF NOT EXISTS transmittal_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  transmittal_id    UUID NOT NULL,
  event_type        TEXT NOT NULL,                 -- 'sent' | 'received' | 'response' | 'voided' | 'note'
  from_status       transmittal_status,
  to_status         transmittal_status,
  actor             TEXT NOT NULL DEFAULT 'system',
  notes             TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_txe_transmittal ON transmittal_events (transmittal_id, created_at);

ALTER TABLE transmittal_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON transmittal_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Transmittal sequence counter per project (for auto-numbering TRN-0001 etc.)
CREATE TABLE IF NOT EXISTS transmittal_counters (
  tenant_id   UUID NOT NULL,
  project_id  UUID NOT NULL,
  next_seq    INT NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, project_id)
);
