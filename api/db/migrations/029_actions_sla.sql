-- ============================================================
-- Denver Engineering — Migration 029: Unified Action & SLA Engine (v4.33.0)
-- LUNA Phase 1A — Global Action Center, SLA Engine, Approval Delegation
--
-- NEW tables:
--   actions              — unified action model across all modules
--   sla_rules            — per action_type escalation config
--   action_escalations   — append-only escalation event log
--   approval_delegations — time-bound approval delegation rules
--
-- Design notes:
--   - Tenant RLS on all tables (matches existing repo pattern).
--   - source_module + source_id UNIQUE per tenant to enforce idempotency.
--   - escalation_levels stored as JSONB array for flexibility without schema churn.
--   - set_updated_at() and uuid-ossp already loaded in migration 001.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- ACTIONS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE actions (
  id                   UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID          NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  project_id           UUID          REFERENCES projects(id)           ON DELETE SET NULL,

  -- Classification
  title                VARCHAR(500)  NOT NULL,
  description          TEXT,
  action_type          VARCHAR(100)  NOT NULL,   -- RFI, SUBMITTAL, PUNCH_ITEM, WORK_ORDER, ALARM, TEMPLATE_ASSIGNMENT, COMPLIANCE_TASK, INSPECTION, BIM_ISSUE, DAILY_LOG
  source_module        VARCHAR(100)  NOT NULL,   -- rfis, submittals, punch_items, daily_logs, compliance_tasks, inspections, bim_issues
  source_id            UUID          NOT NULL,   -- FK to the originating record (not enforced via DB FK for cross-table flexibility)
  system_type          VARCHAR(100),             -- PWTP, WWTP, HVAC, EPC, etc. — for cross-system isolation

  -- Priority & Status
  priority             VARCHAR(20)   NOT NULL DEFAULT 'medium'
                       CHECK (priority IN ('low','medium','high','critical')),
  status               VARCHAR(30)   NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','in_progress','completed','cancelled')),

  -- Assignment (resolved after delegation check)
  assigned_to_user_id  UUID          REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_role     VARCHAR(50),             -- fallback role if no specific user

  -- SLA
  due_at               TIMESTAMPTZ,             -- computed from sla_rules.default_duration_hours at creation
  sla_rule_id          UUID,                    -- nullable; FK populated if rule matched

  -- Lifecycle
  completed_at         TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  created_by           UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Idempotency: one action per source record per tenant
  UNIQUE (tenant_id, source_module, source_id)
);

CREATE INDEX idx_actions_tenant_status      ON actions(tenant_id, status);
CREATE INDEX idx_actions_tenant_assigned    ON actions(tenant_id, assigned_to_user_id);
CREATE INDEX idx_actions_tenant_due         ON actions(tenant_id, due_at) WHERE status = 'open';
CREATE INDEX idx_actions_tenant_type        ON actions(tenant_id, action_type);
CREATE INDEX idx_actions_tenant_project     ON actions(tenant_id, project_id);
CREATE INDEX idx_actions_tenant_system_type ON actions(tenant_id, system_type);
CREATE INDEX idx_actions_source             ON actions(tenant_id, source_module, source_id);

ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_actions ON actions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_actions_updated_at BEFORE UPDATE ON actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- SLA RULES
-- ──────────────────────────────────────────────────────────────

CREATE TABLE sla_rules (
  id                     UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  action_type            VARCHAR(100)  NOT NULL,  -- matches actions.action_type
  system_type            VARCHAR(100),            -- NULL = applies to all system types
  default_duration_hours INTEGER       NOT NULL DEFAULT 72,  -- hours from creation to due_at
  is_active              BOOLEAN       NOT NULL DEFAULT TRUE,

  -- Escalation ladder as JSON array of objects:
  -- [{ "level": 1, "after_hours": 0,  "notify_role": "assigned_user"  },
  --  { "level": 2, "after_hours": 24, "notify_role": "supervisor"      },
  --  { "level": 3, "after_hours": 48, "notify_role": "admin"           }]
  escalation_levels      JSONB         NOT NULL DEFAULT '[]'::jsonb,

  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, action_type, system_type)  -- one rule per type+system combo
);

CREATE INDEX idx_sla_rules_tenant_type ON sla_rules(tenant_id, action_type);

ALTER TABLE sla_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sla_rules ON sla_rules
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_sla_rules_updated_at BEFORE UPDATE ON sla_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- ACTION ESCALATIONS  (append-only event log)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE action_escalations (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  action_id        UUID         NOT NULL REFERENCES actions(id)  ON DELETE CASCADE,
  escalation_level INTEGER      NOT NULL,         -- 1, 2, 3 matching sla_rules.escalation_levels
  triggered_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  notified_users   JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- array of user_ids notified
  notify_role      VARCHAR(50),                   -- role notified at this level
  hours_overdue    NUMERIC(8,2)                   -- how many hours past due_at at trigger time
);

CREATE INDEX idx_action_escalations_action   ON action_escalations(action_id);
CREATE INDEX idx_action_escalations_tenant   ON action_escalations(tenant_id, triggered_at DESC);

ALTER TABLE action_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_action_escalations ON action_escalations
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- No UPDATE trigger — escalations are append-only (no updated_at needed)

-- ──────────────────────────────────────────────────────────────
-- APPROVAL DELEGATIONS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE approval_delegations (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id          UUID          NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  delegate_user_id UUID          NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  start_date       TIMESTAMPTZ   NOT NULL,
  end_date         TIMESTAMPTZ   NOT NULL,

  -- Scope: which modules and action_types this delegation applies to.
  -- NULL = applies to all. Example: {"modules": ["rfis","submittals"], "action_types": ["RFI","SUBMITTAL"]}
  scope            JSONB         NOT NULL DEFAULT '{}'::jsonb,

  is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by       UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Prevent circular delegation at DB level
  CHECK (user_id <> delegate_user_id),
  -- Prevent duplicate active delegation for same delegator+delegate+period
  UNIQUE (tenant_id, user_id, delegate_user_id, start_date, end_date)
);

CREATE INDEX idx_delegations_tenant_user   ON approval_delegations(tenant_id, user_id);
CREATE INDEX idx_delegations_active        ON approval_delegations(tenant_id, user_id, is_active, start_date, end_date);
CREATE INDEX idx_delegations_delegate      ON approval_delegations(tenant_id, delegate_user_id);

ALTER TABLE approval_delegations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_approval_delegations ON approval_delegations
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_delegations_updated_at BEFORE UPDATE ON approval_delegations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- SEED: DEFAULT SLA RULES (platform-wide defaults, tenant_id = system tenant)
-- Applied per-tenant at app boot if no tenant-specific rule exists.
-- These are reference defaults only — actual rows inserted via API or seed script.
-- ──────────────────────────────────────────────────────────────

COMMENT ON TABLE actions IS
  'Unified action model — every module emits actions here. One row per source record per tenant (idempotent via UNIQUE on tenant_id+source_module+source_id).';

COMMENT ON TABLE sla_rules IS
  'Per-action-type SLA configuration. Defines due_at offset and escalation ladder per tenant. system_type nullable = applies to all systems.';

COMMENT ON TABLE action_escalations IS
  'Append-only log of SLA escalation events. One row per escalation level fired per action.';

COMMENT ON TABLE approval_delegations IS
  'Time-bound approval delegation rules. When an action is assigned to user_id and an active delegation exists, it is re-routed to delegate_user_id.';
