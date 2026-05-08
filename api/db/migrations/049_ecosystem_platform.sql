-- Denver Engineering — Phase 9: Ecosystem Platform Migration (v9.0.0)
-- Federated intelligence, playbook marketplace, plugin framework,
-- external agents, automation adapters, knowledge graph, edge nodes,
-- air-gap mode, compliance certification, workflow composition.

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE federated_contribution_status AS ENUM (
    'pending', 'privacy_checked', 'published', 'rejected', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE playbook_status AS ENUM (
    'draft', 'review', 'approved', 'published', 'deprecated', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plugin_status AS ENUM (
    'draft', 'review', 'approved', 'published', 'suspended', 'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE plugin_type AS ENUM (
    'data_connector', 'dashboard_widget', 'runbook_step', 'agent_capability',
    'notification_channel', 'export_format', 'validation_rule', 'policy_rule'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE external_agent_status AS ENUM (
    'registered', 'active', 'suspended', 'revoked'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE edge_node_status AS ENUM (
    'provisioning', 'active', 'degraded', 'offline', 'decommissioned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE workflow_status AS ENUM (
    'draft', 'testing', 'published', 'paused', 'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE workflow_trigger_type AS ENUM (
    'event', 'schedule', 'webhook', 'manual', 'ai_recommended'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE automation_adapter_type AS ENUM (
    'zapier', 'make', 'n8n', 'power_automate', 'slack_workflow',
    'teams_workflow', 'custom_webhook'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE edge_sync_status AS ENUM (
    'pending', 'syncing', 'completed', 'conflict', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Federated Intelligence ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS federated_contributions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  contribution_type TEXT NOT NULL,  -- 'recommendation_outcome', 'anomaly_signature', etc.
  anonymized_data   JSONB NOT NULL DEFAULT '{}',
  privacy_hash      TEXT NOT NULL,  -- SHA-256 of raw data for dedup without storing raw
  k_count           INTEGER NOT NULL DEFAULT 1,  -- number of contributing tenants in aggregate
  status            federated_contribution_status NOT NULL DEFAULT 'pending',
  opt_in_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  rejected_reason   TEXT,
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON federated_contributions (tenant_id, privacy_hash)
  WHERE status != 'withdrawn';

CREATE TABLE IF NOT EXISTS federated_patterns (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type      TEXT NOT NULL,
  industry_segment  TEXT,
  region            TEXT,
  project_type      TEXT,
  pattern_data      JSONB NOT NULL DEFAULT '{}',
  confidence_score  NUMERIC(5,4) NOT NULL DEFAULT 0.0000,
  contributor_count INTEGER NOT NULL DEFAULT 0,
  k_anonymity_met   BOOLEAN NOT NULL DEFAULT FALSE,
  version           INTEGER NOT NULL DEFAULT 1,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS federated_model_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type      TEXT NOT NULL,
  version           INTEGER NOT NULL,
  model_checksum    TEXT NOT NULL,
  contributor_count INTEGER NOT NULL,
  training_window   TSTZRANGE,
  release_notes     TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON federated_model_versions (pattern_type, version);

CREATE TABLE IF NOT EXISTS federated_privacy_audits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contribution_id   UUID REFERENCES federated_contributions(id),
  audit_type        TEXT NOT NULL,  -- 'k_anonymity_check', 'dp_noise_check', 'opt_in_check'
  passed            BOOLEAN NOT NULL,
  details           JSONB NOT NULL DEFAULT '{}',
  audited_by        TEXT NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Benchmarking ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS benchmark_cohorts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name       TEXT NOT NULL,
  industry_segment  TEXT,
  region            TEXT,
  project_type      TEXT,
  cohort_size       INTEGER NOT NULL,
  p25               NUMERIC(10,4),
  p50               NUMERIC(10,4),
  p75               NUMERIC(10,4),
  p90               NUMERIC(10,4),
  suppressed        BOOLEAN NOT NULL DEFAULT FALSE,  -- cohort_size < MIN_COHORT_SIZE
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_start      TIMESTAMPTZ,
  period_end        TIMESTAMPTZ
);

CREATE UNIQUE INDEX ON benchmark_cohorts (metric_name, industry_segment, region, project_type)
  WHERE suppressed = FALSE;

-- ─── Playbook Marketplace ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marketplace_playbooks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  playbook_type     TEXT NOT NULL,
  industry_tags     TEXT[] NOT NULL DEFAULT '{}',
  author_tenant_id  UUID,
  publisher         TEXT NOT NULL DEFAULT 'ava',
  status            playbook_status NOT NULL DEFAULT 'draft',
  current_version   TEXT NOT NULL DEFAULT '1.0.0',
  sandbox_validated BOOLEAN NOT NULL DEFAULT FALSE,
  policy_compatible BOOLEAN NOT NULL DEFAULT TRUE,
  install_count     INTEGER NOT NULL DEFAULT 0,
  avg_rating        NUMERIC(3,2),
  metadata          JSONB NOT NULL DEFAULT '{}',
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playbook_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id       UUID NOT NULL REFERENCES marketplace_playbooks(id),
  version           TEXT NOT NULL,
  definition        JSONB NOT NULL DEFAULT '{}',
  changelog         TEXT,
  checksum          TEXT NOT NULL,  -- SHA-256 of definition
  is_immutable      BOOLEAN NOT NULL DEFAULT FALSE,  -- set true on publish
  created_by        TEXT NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON playbook_versions (playbook_id, version);

CREATE TABLE IF NOT EXISTS tenant_playbook_installs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  playbook_id       UUID NOT NULL REFERENCES marketplace_playbooks(id),
  version           TEXT NOT NULL,
  installed_by      TEXT NOT NULL DEFAULT 'system',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  sandbox_run_id    UUID,
  installed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  uninstalled_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX ON tenant_playbook_installs (tenant_id, playbook_id)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS playbook_reviews (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id       UUID NOT NULL REFERENCES marketplace_playbooks(id),
  tenant_id         UUID NOT NULL,
  rating            SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playbook_outcomes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  playbook_id       UUID NOT NULL REFERENCES marketplace_playbooks(id),
  install_id        UUID NOT NULL REFERENCES tenant_playbook_installs(id),
  outcome_type      TEXT NOT NULL,
  outcome_value     JSONB NOT NULL DEFAULT '{}',
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Plugin Framework ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plugins (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  plugin_type       plugin_type NOT NULL,
  author            TEXT NOT NULL,
  status            plugin_status NOT NULL DEFAULT 'draft',
  current_version   TEXT NOT NULL DEFAULT '1.0.0',
  manifest          JSONB NOT NULL DEFAULT '{}',
  required_scopes   TEXT[] NOT NULL DEFAULT '{}',
  kill_switch       BOOLEAN NOT NULL DEFAULT FALSE,  -- platform-level disable
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plugin_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plugin_id         UUID NOT NULL REFERENCES plugins(id),
  version           TEXT NOT NULL,
  bundle_checksum   TEXT NOT NULL,
  manifest          JSONB NOT NULL DEFAULT '{}',
  changelog         TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT FALSE,
  released_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON plugin_versions (plugin_id, version);

CREATE TABLE IF NOT EXISTS tenant_plugin_installs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  plugin_id         UUID NOT NULL REFERENCES plugins(id),
  version           TEXT NOT NULL,
  granted_scopes    TEXT[] NOT NULL DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  installed_by      TEXT NOT NULL DEFAULT 'system',
  installed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at       TIMESTAMPTZ,
  rollback_version  TEXT  -- previous version for rollback support
);

CREATE UNIQUE INDEX ON tenant_plugin_installs (tenant_id, plugin_id)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS plugin_permissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  plugin_id         UUID NOT NULL REFERENCES plugins(id),
  scope             TEXT NOT NULL,
  granted           BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by        TEXT,
  granted_at        TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS plugin_audit_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID,
  plugin_id         UUID NOT NULL REFERENCES plugins(id),
  event_type        TEXT NOT NULL,
  actor             TEXT NOT NULL DEFAULT 'system',
  details           JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── External Agent SDK ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS external_agents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  description       TEXT,
  owner_tenant_id   UUID,
  status            external_agent_status NOT NULL DEFAULT 'registered',
  capabilities      TEXT[] NOT NULL DEFAULT '{}',
  allowed_scopes    TEXT[] NOT NULL DEFAULT '{}',
  public_key        TEXT,  -- for signed request verification
  endpoint_url      TEXT,
  api_key_hash      TEXT,  -- SHA-256 of registration key
  last_executed_at  TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS external_agent_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID NOT NULL REFERENCES external_agents(id),
  tenant_id         UUID NOT NULL,
  request_payload   JSONB NOT NULL DEFAULT '{}',
  response_payload  JSONB,
  validation_passed BOOLEAN NOT NULL DEFAULT FALSE,
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  approval_id       UUID,
  execution_ms      INTEGER,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Automation Adapters ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS automation_adapters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  adapter_type      automation_adapter_type NOT NULL,
  name              TEXT NOT NULL,
  endpoint_url      TEXT,
  signing_secret    TEXT,  -- HMAC secret (stored encrypted)
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limit_rpm    INTEGER NOT NULL DEFAULT 60,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adapter_id        UUID NOT NULL REFERENCES automation_adapters(id),
  tenant_id         UUID NOT NULL,
  direction         TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  event_type        TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}',
  idempotency_key   TEXT,
  signature_valid   BOOLEAN,
  processed         BOOLEAN NOT NULL DEFAULT FALSE,
  error             TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX ON automation_events (adapter_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─── Knowledge Graph ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kg_entities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  entity_type       TEXT NOT NULL,
  entity_ref        TEXT NOT NULL,  -- reference to source table/record
  label             TEXT NOT NULL,
  properties        JSONB NOT NULL DEFAULT '{}',
  embedding_id      TEXT,  -- reference to vector store
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON kg_entities (tenant_id, entity_type, entity_ref);

CREATE TABLE IF NOT EXISTS kg_relationships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  from_entity_id    UUID NOT NULL REFERENCES kg_entities(id),
  to_entity_id      UUID NOT NULL REFERENCES kg_entities(id),
  relationship_type TEXT NOT NULL,
  weight            NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
  confidence        NUMERIC(5,4) NOT NULL DEFAULT 1.0000,
  source            TEXT,  -- 'inferred', 'explicit', 'federated'
  properties        JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON kg_relationships (tenant_id, from_entity_id);
CREATE INDEX ON kg_relationships (tenant_id, to_entity_id);

-- ─── Edge Nodes ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS edge_nodes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  node_name         TEXT NOT NULL,
  site_ref          TEXT,
  status            edge_node_status NOT NULL DEFAULT 'provisioning',
  public_key        TEXT NOT NULL,
  last_seen_at      TIMESTAMPTZ,
  version           TEXT NOT NULL DEFAULT '1.0.0',
  capabilities      TEXT[] NOT NULL DEFAULT '{}',
  metadata          JSONB NOT NULL DEFAULT '{}',
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edge_sync_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_node_id      UUID NOT NULL REFERENCES edge_nodes(id),
  tenant_id         UUID NOT NULL,
  status            edge_sync_status NOT NULL DEFAULT 'pending',
  events_sent       INTEGER NOT NULL DEFAULT 0,
  events_received   INTEGER NOT NULL DEFAULT 0,
  conflicts_detected INTEGER NOT NULL DEFAULT 0,
  conflicts_resolved INTEGER NOT NULL DEFAULT 0,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS edge_command_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_node_id      UUID NOT NULL REFERENCES edge_nodes(id),
  tenant_id         UUID NOT NULL,
  command_type      TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}',
  priority          SMALLINT NOT NULL DEFAULT 5,
  delivered         BOOLEAN NOT NULL DEFAULT FALSE,
  delivered_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS edge_audit_buffers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_node_id      UUID NOT NULL REFERENCES edge_nodes(id),
  tenant_id         UUID NOT NULL,
  event_type        TEXT NOT NULL,
  event_data        JSONB NOT NULL DEFAULT '{}',
  local_sequence    BIGINT NOT NULL,
  synced            BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON edge_audit_buffers (edge_node_id, local_sequence);

-- ─── Workflow Composition ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workflows (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  status            workflow_status NOT NULL DEFAULT 'draft',
  trigger_type      workflow_trigger_type NOT NULL,
  trigger_config    JSONB NOT NULL DEFAULT '{}',
  definition        JSONB NOT NULL DEFAULT '{}',
  policy_validated  BOOLEAN NOT NULL DEFAULT FALSE,
  dry_run_passed    BOOLEAN NOT NULL DEFAULT FALSE,
  current_version   INTEGER NOT NULL DEFAULT 1,
  published_by      TEXT,
  published_at      TIMESTAMPTZ,
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id       UUID NOT NULL REFERENCES workflows(id),
  version           INTEGER NOT NULL,
  definition        JSONB NOT NULL DEFAULT '{}',
  trigger_type      workflow_trigger_type NOT NULL,
  trigger_config    JSONB NOT NULL DEFAULT '{}',
  change_summary    TEXT,
  created_by        TEXT NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON workflow_versions (workflow_id, version);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id       UUID NOT NULL REFERENCES workflows(id),
  tenant_id         UUID NOT NULL,
  version           INTEGER NOT NULL,
  trigger_context   JSONB NOT NULL DEFAULT '{}',
  is_dry_run        BOOLEAN NOT NULL DEFAULT FALSE,
  status            TEXT NOT NULL DEFAULT 'running',
  steps_completed   INTEGER NOT NULL DEFAULT 0,
  steps_total       INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

-- ─── Air-Gap Mode ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS air_gap_licenses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  license_key_hash  TEXT NOT NULL UNIQUE,
  tier              TEXT NOT NULL,
  seat_limit        INTEGER NOT NULL,
  feature_set       TEXT[] NOT NULL DEFAULT '{}',
  valid_from        TIMESTAMPTZ NOT NULL,
  valid_until       TIMESTAMPTZ NOT NULL,
  issued_by         TEXT NOT NULL DEFAULT 'ava',
  signature         TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── RLS Policies ─────────────────────────────────────────────────────────────

ALTER TABLE federated_contributions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_playbook_installs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_reviews           ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbook_outcomes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_plugin_installs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_permissions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugin_audit_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_adapters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_entities                ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_relationships           ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_nodes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_sync_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_command_queue         ENABLE ROW LEVEL SECURITY;
ALTER TABLE edge_audit_buffers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE air_gap_licenses           ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON federated_contributions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON tenant_playbook_installs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON playbook_reviews
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON playbook_outcomes
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON tenant_plugin_installs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON plugin_permissions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON plugin_audit_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON automation_adapters
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON automation_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON kg_entities
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON kg_relationships
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON edge_nodes
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON edge_sync_sessions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON edge_command_queue
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON edge_audit_buffers
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON workflows
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON workflow_runs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON air_gap_licenses
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
