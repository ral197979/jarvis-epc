-- ============================================================
-- JARVIS EPC — Migration 017: Agent Action Log
-- v4.31.0 | Structured "why I did this" trail for every agent decision
--
-- Every automated decision (arbitration, digest draft, auto-open punch,
-- RFI response draft, etc.) writes one row here. The rationale field is
-- required and must be human-readable; evidence is JSONB for measurements,
-- history counts, z-scores, rule ids, whatever supports the call.
--
-- The reviewed_* columns capture human confirmation/override after the
-- fact, so the log serves both real-time audit and retrospective review.
-- ============================================================

CREATE TABLE agent_actions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,

  agent_name        VARCHAR(64)  NOT NULL,       -- 'ci_arbiter','morning_digest',...
  action_type       VARCHAR(64)  NOT NULL,       -- 'auto_pass_test','draft_email',...
  target_type       VARCHAR(64),                 -- 'test_result','pack','rfi','punch_item'
  target_id         UUID,

  decision          VARCHAR(32)  NOT NULL,       -- 'auto_pass'|'auto_fail'|'queued'|'sent'|'suppressed'
  rationale         TEXT         NOT NULL,       -- required; the durable "why"
  rule_id           UUID REFERENCES commissioning_autosign_rules(id) ON DELETE SET NULL,
  evidence          JSONB NOT NULL DEFAULT '{}',
  confidence        NUMERIC(4,3),                -- 0.000-1.000, nullable

  -- Whether a human should eyeball this even if auto-approved. Set by
  -- the emitting agent based on its confidence/novelty/context.
  human_reviewable  BOOLEAN NOT NULL DEFAULT TRUE,

  reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  review_outcome    VARCHAR(16),                 -- 'confirmed'|'overridden'|'reversed'
  review_notes      TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT agent_actions_review_outcome_valid CHECK (
    review_outcome IS NULL
    OR review_outcome IN ('confirmed','overridden','reversed')
  )
);

CREATE INDEX idx_agent_actions_tenant_time
  ON agent_actions(tenant_id, created_at DESC);

CREATE INDEX idx_agent_actions_project
  ON agent_actions(tenant_id, project_id, created_at DESC);

-- The "needs your call" queue: fast lookup of unreviewed reviewable actions.
CREATE INDEX idx_agent_actions_review_queue
  ON agent_actions(tenant_id, created_at DESC)
  WHERE reviewed_at IS NULL AND human_reviewable = TRUE;

CREATE INDEX idx_agent_actions_agent
  ON agent_actions(tenant_id, agent_name, created_at DESC);

ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_agent_actions ON agent_actions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
