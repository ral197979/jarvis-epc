-- ============================================================
-- Denver Engineering — Migration 034: Action Events (v4.34.0)
-- LUNA Phase 2G — Immutable event timeline / audit stream
--
-- NEW table:
--   action_events   — append-only, immutable event log per action
--
-- Event types (action_event_type):
--   created | assigned | delegated | reassigned |
--   escalated | commented | blocked | unblocked |
--   status_changed | priority_changed | resolved | reopened |
--   cancelled | sla_paused | sla_resumed | relation_added | relation_removed
--
-- Design:
--   - NO update or delete triggers — append-only by convention + constraint
--   - before_snapshot / after_snapshot for diff replay
--   - correlation_id for cross-service tracing
--   - actor_id for human attribution; system_actor for background jobs
-- ============================================================

CREATE TYPE action_event_type AS ENUM (
  'created',
  'assigned',
  'delegated',
  'reassigned',
  'escalated',
  'commented',
  'blocked',
  'unblocked',
  'status_changed',
  'priority_changed',
  'resolved',
  'reopened',
  'cancelled',
  'sla_paused',
  'sla_resumed',
  'relation_added',
  'relation_removed'
);

CREATE TABLE action_events (
  id                UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID              NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  action_id         UUID              NOT NULL REFERENCES actions(id)  ON DELETE CASCADE,
  correlation_id    UUID,                          -- request / job correlation

  event_type        action_event_type NOT NULL,
  event_version     INTEGER           NOT NULL DEFAULT 1,  -- schema version for replay

  -- Actor attribution
  actor_id          UUID              REFERENCES users(id) ON DELETE SET NULL,
  actor_type        VARCHAR(20)       NOT NULL DEFAULT 'user'
                    CHECK (actor_type IN ('user','system','worker','api')),
  actor_label       VARCHAR(200),                  -- display: 'SLA Engine' | user email

  -- Payload: what changed
  before_snapshot   JSONB,                         -- relevant fields before change
  after_snapshot    JSONB,                         -- relevant fields after change
  metadata          JSONB             NOT NULL DEFAULT '{}'::jsonb,  -- free-form extra context

  occurred_at       TIMESTAMPTZ       NOT NULL DEFAULT NOW()

  -- No updated_at — events are immutable
);

-- Primary access pattern: all events for an action, chronological
CREATE INDEX idx_action_events_action      ON action_events(action_id, occurred_at ASC);
CREATE INDEX idx_action_events_tenant      ON action_events(tenant_id, occurred_at DESC);
CREATE INDEX idx_action_events_correlation ON action_events(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX idx_action_events_type        ON action_events(tenant_id, event_type, occurred_at DESC);

-- RLS
ALTER TABLE action_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_action_events ON action_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Prevent UPDATE and DELETE — events are immutable
CREATE RULE action_events_no_update AS ON UPDATE TO action_events DO INSTEAD NOTHING;
CREATE RULE action_events_no_delete AS ON DELETE TO action_events DO INSTEAD NOTHING;

COMMENT ON TABLE action_events IS
  'Append-only, immutable event log per action. Supports audit replay, AI behavioral analysis, websocket streams, and Kafka migration. Events can never be updated or deleted.';
