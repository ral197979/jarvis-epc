-- ============================================================
-- Denver Engineering — Migration 031: SLA Policy Profiles (v4.34.0)
-- LUNA Phase 2D — Configurable SLA profiles with business hours,
--                 holidays, timezone awareness, pause/resume.
--
-- NEW tables:
--   sla_profiles     — named profile (tenant-level; can be default)
--   sla_profile_rules — profile-scoped rules (extends sla_rules)
--   action_sla_state  — per-action SLA lifecycle tracking
--
-- sla_rules (Phase 1) remains unchanged. sla_profile_rules mirrors
-- its structure but is keyed to an sla_profile_id, enabling profiles
-- that override the global defaults for specific tenant configurations.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- SLA PROFILES
-- ──────────────────────────────────────────────────────────────

CREATE TABLE sla_profiles (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               VARCHAR(200)  NOT NULL,
  description        TEXT,
  is_default         BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active          BOOLEAN       NOT NULL DEFAULT TRUE,

  -- Business hours config
  business_hours_start TIME,                    -- e.g. '08:00'
  business_hours_end   TIME,                    -- e.g. '17:00'
  business_days        INTEGER[]  DEFAULT ARRAY[1,2,3,4,5],  -- 0=Sun, 1=Mon...6=Sat
  timezone             VARCHAR(100) DEFAULT 'UTC',
  holiday_dates        DATE[]     DEFAULT '{}',  -- excluded calendar dates

  -- Escalation config
  grace_period_minutes INTEGER    NOT NULL DEFAULT 0,   -- extra minutes before L1 fires
  escalation_cooldown_minutes INTEGER NOT NULL DEFAULT 60, -- min gap between escalations

  created_by         UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, name)
);

-- Only one default profile per tenant
CREATE UNIQUE INDEX idx_sla_profiles_default
  ON sla_profiles(tenant_id) WHERE is_default = TRUE AND is_active = TRUE;

CREATE INDEX idx_sla_profiles_tenant ON sla_profiles(tenant_id, is_active);

ALTER TABLE sla_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sla_profiles ON sla_profiles
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_sla_profiles_updated_at BEFORE UPDATE ON sla_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- SLA PROFILE RULES (profile-scoped override of sla_rules)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE sla_profile_rules (
  id                     UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID          NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  profile_id             UUID          NOT NULL REFERENCES sla_profiles(id) ON DELETE CASCADE,

  action_type            VARCHAR(100)  NOT NULL,
  system_type            VARCHAR(100),   -- NULL = applies to all
  priority               VARCHAR(20),    -- NULL = applies to all priorities
  default_duration_hours INTEGER       NOT NULL DEFAULT 72,
  is_active              BOOLEAN       NOT NULL DEFAULT TRUE,

  escalation_levels      JSONB         NOT NULL DEFAULT '[]'::jsonb,

  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, profile_id, action_type, system_type, priority)
);

CREATE INDEX idx_sla_profile_rules_profile ON sla_profile_rules(profile_id, action_type);

ALTER TABLE sla_profile_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sla_profile_rules ON sla_profile_rules
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_sla_profile_rules_updated_at BEFORE UPDATE ON sla_profile_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- ACTION SLA STATE  (per-action SLA lifecycle tracking)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE action_sla_state (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  action_id             UUID          NOT NULL REFERENCES actions(id)  ON DELETE CASCADE,
  sla_profile_id        UUID          REFERENCES sla_profiles(id)      ON DELETE SET NULL,

  computed_due_at       TIMESTAMPTZ,             -- business-hours-adjusted due_at
  sla_started_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  sla_paused_at         TIMESTAMPTZ,             -- set when paused
  sla_resumed_at        TIMESTAMPTZ,             -- set when resumed
  paused_duration_mins  INTEGER       NOT NULL DEFAULT 0,  -- cumulative pause time

  -- Current state
  sla_status            VARCHAR(20)   NOT NULL DEFAULT 'active'
                        CHECK (sla_status IN ('active','paused','breached','met')),

  -- Metrics (updated on each escalation check)
  remaining_minutes     INTEGER,                 -- minutes until due_at (negative = overdue)
  breach_count          INTEGER       NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, action_id)
);

CREATE INDEX idx_action_sla_state_action  ON action_sla_state(action_id);
CREATE INDEX idx_action_sla_state_tenant  ON action_sla_state(tenant_id, sla_status);
CREATE INDEX idx_action_sla_state_due     ON action_sla_state(tenant_id, computed_due_at) WHERE sla_status = 'active';

ALTER TABLE action_sla_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_action_sla_state ON action_sla_state
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_action_sla_state_updated_at BEFORE UPDATE ON action_sla_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE sla_profiles IS
  'Named SLA profiles with business hours, holidays, and timezone awareness. One default per tenant.';
COMMENT ON TABLE sla_profile_rules IS
  'Profile-scoped SLA rules, keyed to sla_profiles. Override global sla_rules for specific tenant configurations.';
COMMENT ON TABLE action_sla_state IS
  'Per-action SLA lifecycle: computed due date (business-hours adjusted), pause/resume tracking, breach count.';
