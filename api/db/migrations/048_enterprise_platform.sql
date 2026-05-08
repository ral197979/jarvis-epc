-- Migration 048: Enterprise Deployment + Customer Operations Platform
-- Denver Engineering — Ava Phase 8 (v8.0.0)

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE tenant_lifecycle_status AS ENUM (
  'trial',
  'onboarding',
  'active',
  'suspended',
  'cancelled',
  'archived'
);

CREATE TYPE subscription_tier AS ENUM (
  'starter',
  'professional',
  'enterprise',
  'custom'
);

CREATE TYPE subscription_status AS ENUM (
  'trialing',
  'active',
  'past_due',
  'cancelled',
  'paused'
);

CREATE TYPE billing_event_type AS ENUM (
  'usage',
  'seat',
  'storage',
  'ai_tokens',
  'api_calls',
  'simulation',
  'adjustment',
  'credit'
);

CREATE TYPE onboarding_stage AS ENUM (
  'organization_setup',
  'project_import',
  'role_assignment',
  'integrations',
  'feature_activation',
  'training_completion',
  'completed'
);

CREATE TYPE onboarding_task_status AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'skipped',
  'failed'
);

CREATE TYPE support_ticket_status AS ENUM (
  'open',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed'
);

CREATE TYPE support_ticket_priority AS ENUM (
  'low',
  'medium',
  'high',
  'critical'
);

CREATE TYPE export_format AS ENUM (
  'csv',
  'json',
  'pdf',
  'parquet'
);

CREATE TYPE export_status AS ENUM (
  'pending',
  'running',
  'completed',
  'failed',
  'expired'
);

CREATE TYPE api_key_status AS ENUM (
  'active',
  'revoked',
  'expired',
  'suspended'
);

-- ─── Tenant Subscriptions ─────────────────────────────────────────────────────

CREATE TABLE tenant_subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL UNIQUE,
  tier                 subscription_tier NOT NULL DEFAULT 'starter',
  status               subscription_status NOT NULL DEFAULT 'trialing',
  lifecycle_status     tenant_lifecycle_status NOT NULL DEFAULT 'trial',
  stripe_customer_id   TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at        TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  seat_count           INT NOT NULL DEFAULT 1,
  seat_limit           INT NOT NULL DEFAULT 5,
  ai_budget_monthly    NUMERIC(10,2),             -- USD, NULL = unlimited
  ai_spend_current     NUMERIC(10,2) NOT NULL DEFAULT 0,
  storage_limit_gb     INT NOT NULL DEFAULT 10,
  api_quota_monthly    INT NOT NULL DEFAULT 10000,
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ts_tenant          ON tenant_subscriptions (tenant_id);
CREATE INDEX idx_ts_status          ON tenant_subscriptions (status);
CREATE INDEX idx_ts_lifecycle       ON tenant_subscriptions (lifecycle_status);
CREATE INDEX idx_ts_tier            ON tenant_subscriptions (tier);

-- ─── Tenant Usage ─────────────────────────────────────────────────────────────

CREATE TABLE tenant_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  event_type      billing_event_type NOT NULL,
  quantity        NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit            TEXT NOT NULL,           -- 'tokens', 'seats', 'gb', 'calls', etc.
  unit_cost       NUMERIC(10,6),           -- cost per unit in USD
  total_cost      NUMERIC(10,4),           -- quantity * unit_cost
  metadata        JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT,                    -- prevents double-counting
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_tu_idempotency  ON tenant_usage (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_tu_tenant_period   ON tenant_usage (tenant_id, period_start, period_end);
CREATE INDEX idx_tu_event_type      ON tenant_usage (event_type, tenant_id);
CREATE INDEX idx_tu_created         ON tenant_usage (created_at);

ALTER TABLE tenant_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_usage
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Tenant Feature Flags ─────────────────────────────────────────────────────

CREATE TABLE tenant_feature_flags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  feature_key     TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT false,
  config          JSONB NOT NULL DEFAULT '{}',  -- feature-specific config (limits, etc.)
  granted_by      TEXT,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_key)
);

CREATE INDEX idx_tff_tenant         ON tenant_feature_flags (tenant_id);
CREATE INDEX idx_tff_feature_key    ON tenant_feature_flags (feature_key, enabled);

ALTER TABLE tenant_feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_feature_flags
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Tenant Lifecycle Events (immutable audit) ────────────────────────────────

CREATE TABLE tenant_lifecycle_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  event_type      TEXT NOT NULL,       -- 'provisioned' | 'suspended' | 'reactivated' | 'archived' | etc.
  from_status     tenant_lifecycle_status,
  to_status       tenant_lifecycle_status NOT NULL,
  actor           TEXT,                -- who triggered this
  reason          TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tle_tenant         ON tenant_lifecycle_events (tenant_id);
CREATE INDEX idx_tle_event_type     ON tenant_lifecycle_events (event_type, tenant_id);
CREATE INDEX idx_tle_created        ON tenant_lifecycle_events (created_at);

-- No RLS — lifecycle events are internal; accessible only via service layer

-- ─── Tenant Onboarding Tasks ──────────────────────────────────────────────────

CREATE TABLE tenant_onboarding_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  stage           onboarding_stage NOT NULL,
  task_key        TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  status          onboarding_task_status NOT NULL DEFAULT 'pending',
  sequence        INT NOT NULL DEFAULT 0,
  required        BOOLEAN NOT NULL DEFAULT true,
  completed_at    TIMESTAMPTZ,
  skipped_at      TIMESTAMPTZ,
  error           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, task_key)
);

CREATE INDEX idx_tot_tenant         ON tenant_onboarding_tasks (tenant_id);
CREATE INDEX idx_tot_stage          ON tenant_onboarding_tasks (stage, tenant_id);
CREATE INDEX idx_tot_status         ON tenant_onboarding_tasks (status, tenant_id);

ALTER TABLE tenant_onboarding_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_onboarding_tasks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Support Tickets ──────────────────────────────────────────────────────────

CREATE TABLE support_tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  ticket_number   TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  description     TEXT,
  status          support_ticket_status NOT NULL DEFAULT 'open',
  priority        support_ticket_priority NOT NULL DEFAULT 'medium',
  reporter        TEXT,
  assignee        TEXT,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  escalated_at    TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  sla_deadline    TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_st_tenant          ON support_tickets (tenant_id);
CREATE INDEX idx_st_status          ON support_tickets (status, priority);
CREATE INDEX idx_st_created         ON support_tickets (created_at);
CREATE INDEX idx_st_assignee        ON support_tickets (assignee, status);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON support_tickets
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── AI Usage Records ─────────────────────────────────────────────────────────

CREATE TABLE ai_usage_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  agent_type      TEXT,
  model           TEXT NOT NULL,
  provider        TEXT NOT NULL DEFAULT 'anthropic',
  operation       TEXT NOT NULL,        -- 'inference' | 'embedding' | 'simulation' | 'recommendation'
  prompt_tokens   INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens    INT NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10,6) NOT NULL DEFAULT 0,
  latency_ms      INT,
  idempotency_key TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_aur_idempotency ON ai_usage_records (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_aur_tenant         ON ai_usage_records (tenant_id);
CREATE INDEX idx_aur_model          ON ai_usage_records (model, tenant_id);
CREATE INDEX idx_aur_created        ON ai_usage_records (created_at);
CREATE INDEX idx_aur_agent          ON ai_usage_records (agent_type, tenant_id);

ALTER TABLE ai_usage_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_usage_records
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Compliance Exports ───────────────────────────────────────────────────────

CREATE TABLE compliance_exports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  export_type     TEXT NOT NULL,        -- 'audit' | 'usage' | 'twin_state' | 'full_tenant'
  format          export_format NOT NULL DEFAULT 'json',
  status          export_status NOT NULL DEFAULT 'pending',
  requested_by    TEXT,
  filter_from     TIMESTAMPTZ,
  filter_to       TIMESTAMPTZ,
  record_count    INT,
  file_size_bytes BIGINT,
  storage_path    TEXT,
  checksum        TEXT,                 -- sha256 of export file
  manifest        JSONB NOT NULL DEFAULT '{}',
  expires_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ce_tenant          ON compliance_exports (tenant_id);
CREATE INDEX idx_ce_status          ON compliance_exports (status, tenant_id);
CREATE INDEX idx_ce_created         ON compliance_exports (created_at);

ALTER TABLE compliance_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON compliance_exports
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── API Keys ─────────────────────────────────────────────────────────────────

CREATE TABLE api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE, -- SHA-256 of the actual key
  key_prefix      TEXT NOT NULL,        -- first 8 chars for display
  name            TEXT NOT NULL,
  status          api_key_status NOT NULL DEFAULT 'active',
  scopes          TEXT[] NOT NULL DEFAULT '{}',
  quota_monthly   INT,                  -- NULL = inherit from subscription
  usage_this_month INT NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  revoked_by      TEXT,
  created_by      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ak_tenant          ON api_keys (tenant_id);
CREATE INDEX idx_ak_status          ON api_keys (status, tenant_id);
CREATE INDEX idx_ak_key_hash        ON api_keys (key_hash);
CREATE INDEX idx_ak_expires         ON api_keys (expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_keys
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ─── Deployment Health Checks ─────────────────────────────────────────────────

CREATE TABLE deployment_health_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_name      TEXT NOT NULL,
  status          TEXT NOT NULL,        -- 'passing' | 'warning' | 'failing'
  message         TEXT,
  value           NUMERIC,
  threshold       NUMERIC,
  metadata        JSONB NOT NULL DEFAULT '{}',
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dhc_check_name     ON deployment_health_checks (check_name, checked_at DESC);
CREATE INDEX idx_dhc_status         ON deployment_health_checks (status, checked_at DESC);

-- ─── Demo Tenants ─────────────────────────────────────────────────────────────

CREATE TABLE demo_tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL UNIQUE,
  industry        TEXT NOT NULL,        -- 'construction' | 'manufacturing' | etc.
  template_key    TEXT NOT NULL,
  label           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'reset_pending' | 'expired'
  seeded_at       TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  last_reset_at   TIMESTAMPTZ,
  created_by      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dt_industry        ON demo_tenants (industry, status);
CREATE INDEX idx_dt_template        ON demo_tenants (template_key);
CREATE INDEX idx_dt_expires         ON demo_tenants (expires_at) WHERE expires_at IS NOT NULL;
