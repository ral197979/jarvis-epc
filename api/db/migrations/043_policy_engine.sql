-- Denver Engineering — Migration 043: Enterprise Policy Engine (v4.40.0)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates tables for tenant-configurable governance policies with inheritance,
-- versioning, override precedence, and immutable audit logging.

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE policy_scope AS ENUM (
  'tenant', 'project', 'module', 'role', 'workflow', 'severity'
);

CREATE TYPE policy_status AS ENUM (
  'active', 'inactive', 'draft'
);

-- ─── Policy definitions ───────────────────────────────────────────────────────

CREATE TABLE governance_policies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  name         text NOT NULL,
  description  text,
  scope        policy_scope NOT NULL DEFAULT 'tenant',
  scope_id     text,          -- project_id, module_name, role_name, etc.
  policy_type  text NOT NULL, -- escalation_rule | approval_requirement |
                              -- freeze_condition | evidence_requirement |
                              -- ai_confidence_minimum | assignment_restriction |
                              -- after_hours_restriction
  rules        jsonb NOT NULL DEFAULT '[]',    -- array of rule objects
  priority     int NOT NULL DEFAULT 100,       -- lower number = higher precedence
  status       policy_status NOT NULL DEFAULT 'active',
  version      int NOT NULL DEFAULT 1,
  created_by   uuid NOT NULL,

  -- Version chain: when a policy is updated, old record is archived
  -- and new record is created with supersedes pointing to the old one
  supersedes   uuid REFERENCES governance_policies(id),

  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,   -- null = never expires
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── Immutable policy enforcement audit log ───────────────────────────────────

CREATE TABLE policy_audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  policy_id    uuid NOT NULL REFERENCES governance_policies(id),
  event_type   text NOT NULL
                 CHECK (event_type IN ('evaluated', 'enforced', 'bypassed', 'overridden', 'expired')),
  context      jsonb NOT NULL DEFAULT '{}',  -- evaluation inputs
  actor_id     uuid,
  resource     text,            -- 'action' | 'runbook' | 'ai_recommendation' etc.
  resource_id  uuid,
  outcome      text NOT NULL
                 CHECK (outcome IN ('allowed', 'blocked', 'warned', 'overridden')),
  override_reason text,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

-- Make policy_audit_log immutable
CREATE RULE no_update_policy_audit AS
  ON UPDATE TO policy_audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_policy_audit AS
  ON DELETE TO policy_audit_log DO INSTEAD NOTHING;

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_policies_tenant_scope ON governance_policies(tenant_id, scope, status);
CREATE INDEX idx_policies_type         ON governance_policies(tenant_id, policy_type) WHERE status = 'active';
CREATE INDEX idx_policy_audit_tenant   ON policy_audit_log(tenant_id, occurred_at DESC);
CREATE INDEX idx_policy_audit_policy   ON policy_audit_log(policy_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE governance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_audit_log    ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON governance_policies
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON policy_audit_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
