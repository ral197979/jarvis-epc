-- Denver Engineering — Migration 041: AI Execution Governance (v4.40.0)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates tables for human-in-the-loop AI recommendation approval,
-- execution preview, and immutable approval audit chain.

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE ai_rec_status AS ENUM (
  'pending', 'approved', 'rejected', 'executed', 'expired', 'cancelled'
);

-- ─── AI recommendation approval queue ────────────────────────────────────────

CREATE TABLE ai_recommendation_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  action_id          uuid,                        -- optional target action
  recommended_action text NOT NULL,               -- escalate / reassign / etc.
  category           text NOT NULL,
  confidence_score   numeric(5,2) NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  impact_score       numeric(5,2) NOT NULL CHECK (impact_score BETWEEN 0 AND 100),
  urgency_score      numeric(5,2) NOT NULL CHECK (urgency_score BETWEEN 0 AND 100),
  reason             text NOT NULL,
  data_signals       jsonb NOT NULL DEFAULT '[]',
  affected_entities  jsonb NOT NULL DEFAULT '[]', -- [{entity_type, entity_id, impact}]
  rollback_plan      jsonb NOT NULL DEFAULT '{}', -- how to undo the action
  approval_required  boolean NOT NULL DEFAULT true,
  status             ai_rec_status NOT NULL DEFAULT 'pending',
  generated_by       text NOT NULL DEFAULT 'rule_engine',
  min_confidence_threshold numeric(5,2) NOT NULL DEFAULT 70,
  reviewed_by        uuid,
  approved_by        uuid,
  executed_by        uuid,
  rejection_reason   text,
  preview_data       jsonb NOT NULL DEFAULT '{}', -- projected outcome data
  expires_at         timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  generated_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at        timestamptz,
  executed_at        timestamptz
);

-- ─── Immutable approval audit chain ──────────────────────────────────────────
-- Every approval, rejection, and execution is a permanent record.
-- Records may not be updated or deleted.

CREATE TABLE ai_approval_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  recommendation_id uuid NOT NULL REFERENCES ai_recommendation_queue(id) ON DELETE CASCADE,
  event_type        text NOT NULL
                      CHECK (event_type IN ('queued', 'previewed', 'approved', 'rejected', 'executed', 'expired', 'cancelled')),
  actor_id          uuid NOT NULL,
  reason            text,
  metadata          jsonb NOT NULL DEFAULT '{}',
  occurred_at       timestamptz NOT NULL DEFAULT now()
);

-- Make ai_approval_events immutable
CREATE RULE no_update_ai_approval_events AS
  ON UPDATE TO ai_approval_events DO INSTEAD NOTHING;
CREATE RULE no_delete_ai_approval_events AS
  ON DELETE TO ai_approval_events DO INSTEAD NOTHING;

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_ai_rec_tenant_status  ON ai_recommendation_queue(tenant_id, status);
CREATE INDEX idx_ai_rec_expires        ON ai_recommendation_queue(expires_at) WHERE status = 'pending';
CREATE INDEX idx_ai_approval_rec       ON ai_approval_events(recommendation_id);
CREATE INDEX idx_ai_approval_tenant    ON ai_approval_events(tenant_id, occurred_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE ai_recommendation_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_approval_events      ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ai_recommendation_queue
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON ai_approval_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
