-- ════════════════════════════════════════════════════════════════════════════
-- 081_cx_status_mirror.sql — Commissioning extraction PR-1: external status mirror
-- ════════════════════════════════════════════════════════════════════════════
-- Denver is the ORCHESTRATION layer; commissioning EXECUTION runs in a separate
-- Commissioning platform (see COMMISSIONING_EXTRACTION_PLAN.md). These tables are
-- a READ-ONLY MIRROR of state owned by that external platform — they are written
-- ONLY by the inbound webhook receiver (routes/commissioningWebhook.ts) and the
-- outbound gateway seed (services/integration/commissioningGateway.ts). No UI or
-- user request writes here; Denver never authors commissioning truth.
--
-- This migration is ADDITIVE and behavior-neutral: nothing reads these tables
-- until the COMMISSIONING_EXTERNAL feature flag is enabled in a later PR.
--
-- Status/phase columns are intentionally un-CHECKed VARCHAR: they mirror an
-- external system's vocabulary, so we record whatever it reports rather than
-- rejecting a value the Commissioning platform considers valid.
-- Tenant-isolated via RLS.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── Status mirror: one row per external commissioning handoff ────────────────
CREATE TABLE IF NOT EXISTS cx_status_mirror (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  -- project_id is nullable: an inbound event may arrive before the row is linked
  -- to a Denver project (normally seeded by the outbound gateway with project_id).
  project_id           UUID         REFERENCES projects(id) ON DELETE CASCADE,
  turnover_package_id  UUID         REFERENCES turnover_packages(id) ON DELETE SET NULL,
  handoff_id           TEXT         NOT NULL,             -- external Commissioning handoff id
  workspace_url        TEXT,                              -- deep-link into the Commissioning workspace
  phase                VARCHAR(40)  NOT NULL DEFAULT 'not_started',
  fat_status           VARCHAR(20),
  fat_readiness_pct    INTEGER,
  sat_status           VARCHAR(20),
  sat_readiness_pct    INTEGER,
  deficiencies_open    INTEGER      NOT NULL DEFAULT 0,
  ncr_open             INTEGER      NOT NULL DEFAULT 0,
  punch_open           INTEGER      NOT NULL DEFAULT 0,
  references           JSONB        NOT NULL DEFAULT '{}', -- { deficiencies_url, ncr_url, punch_url, reports:[...] }
  last_event_id        TEXT,
  synced_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, handoff_id)
);

CREATE INDEX IF NOT EXISTS idx_cx_mirror_project ON cx_status_mirror(tenant_id, project_id);

-- ─── Inbound event idempotency ledger ─────────────────────────────────────────
-- Every webhook event is recorded once; replays/duplicates are no-ops. The
-- UNIQUE (tenant_id, event_id) constraint is the idempotency key.
CREATE TABLE IF NOT EXISTS cx_inbound_events (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id      TEXT         NOT NULL,             -- external event id
  event_type    TEXT         NOT NULL,
  handoff_id    TEXT,
  payload       JSONB        NOT NULL,
  received_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_cx_inbound_handoff ON cx_inbound_events(tenant_id, handoff_id);

-- ─── Row-Level Security ───────────────────────────────────────────────────────
ALTER TABLE cx_status_mirror  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cx_status_mirror  FORCE  ROW LEVEL SECURITY;
ALTER TABLE cx_inbound_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE cx_inbound_events FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON cx_status_mirror;
CREATE POLICY tenant_isolation ON cx_status_mirror
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON cx_inbound_events;
CREATE POLICY tenant_isolation ON cx_inbound_events
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON cx_status_mirror  TO jarvis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON cx_inbound_events TO jarvis_app;
