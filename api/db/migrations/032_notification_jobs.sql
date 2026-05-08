-- ============================================================
-- Denver Engineering — Migration 032: Notification Jobs (v4.34.0)
-- LUNA Phase 2E — Durable notification queue with retry, DLQ,
--                 delivery tracking, and deduplication.
--
-- NEW tables:
--   notification_jobs              — primary queue
--   notification_delivery_attempts — per-attempt audit log
--   notification_dead_letters      — poison messages
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- NOTIFICATION JOBS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE notification_jobs (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- What to send
  channel           VARCHAR(20)   NOT NULL
                    CHECK (channel IN ('in_app','email','webhook','slack')),
  template_key      VARCHAR(100)  NOT NULL,   -- e.g. 'action.escalated.level1'
  recipient_ids     JSONB         NOT NULL DEFAULT '[]'::jsonb,  -- array of user UUIDs
  recipient_emails  JSONB         NOT NULL DEFAULT '[]'::jsonb,  -- fallback for email channel
  payload           JSONB         NOT NULL DEFAULT '{}'::jsonb,  -- template variables

  -- Deduplication
  dedup_key         VARCHAR(200),             -- e.g. 'action:{id}:escalation:1'
                                              -- NULL = no dedup
  -- Source
  action_id         UUID          REFERENCES actions(id) ON DELETE SET NULL,
  event_type        VARCHAR(100),             -- action.escalated | action.assigned | etc.

  -- Queue state
  status            VARCHAR(20)   NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','delivered','failed','dead')),
  attempts          INTEGER       NOT NULL DEFAULT 0,
  max_attempts      INTEGER       NOT NULL DEFAULT 5,
  run_after         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  locked_until      TIMESTAMPTZ,
  locked_by         VARCHAR(200),

  -- Result
  last_error        TEXT,
  delivered_at      TIMESTAMPTZ,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Queue polling index: pending jobs ready to run
CREATE INDEX idx_notif_jobs_queue
  ON notification_jobs(status, run_after, locked_until)
  WHERE status IN ('pending','failed');

-- Deduplication lookup
CREATE UNIQUE INDEX idx_notif_jobs_dedup
  ON notification_jobs(tenant_id, dedup_key)
  WHERE dedup_key IS NOT NULL AND status NOT IN ('delivered','dead');

CREATE INDEX idx_notif_jobs_action    ON notification_jobs(action_id) WHERE action_id IS NOT NULL;
CREATE INDEX idx_notif_jobs_tenant    ON notification_jobs(tenant_id, created_at DESC);

ALTER TABLE notification_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_notification_jobs ON notification_jobs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_notification_jobs_updated_at BEFORE UPDATE ON notification_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- NOTIFICATION DELIVERY ATTEMPTS  (append-only audit)
-- ──────────────────────────────────────────────────────────────

CREATE TABLE notification_delivery_attempts (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id          UUID          NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,

  attempt_number  INTEGER       NOT NULL,
  attempted_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  channel         VARCHAR(20)   NOT NULL,
  success         BOOLEAN       NOT NULL,
  response_code   INTEGER,
  error_message   TEXT,
  duration_ms     INTEGER
);

CREATE INDEX idx_notif_attempts_job    ON notification_delivery_attempts(job_id);
CREATE INDEX idx_notif_attempts_tenant ON notification_delivery_attempts(tenant_id, attempted_at DESC);

ALTER TABLE notification_delivery_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_notification_delivery_attempts ON notification_delivery_attempts
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- No updated_at — append-only

-- ──────────────────────────────────────────────────────────────
-- NOTIFICATION DEAD LETTERS
-- ──────────────────────────────────────────────────────────────

CREATE TABLE notification_dead_letters (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id          UUID          NOT NULL REFERENCES notification_jobs(id) ON DELETE CASCADE,

  original_payload JSONB        NOT NULL,
  failure_reason   TEXT         NOT NULL,
  total_attempts   INTEGER      NOT NULL,
  last_attempted_at TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- Manual review / replay
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
  replay_job_id   UUID          REFERENCES notification_jobs(id) ON DELETE SET NULL
);

CREATE INDEX idx_notif_dlq_tenant  ON notification_dead_letters(tenant_id, created_at DESC);
CREATE INDEX idx_notif_dlq_job     ON notification_dead_letters(job_id);

ALTER TABLE notification_dead_letters ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_notification_dead_letters ON notification_dead_letters
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

COMMENT ON TABLE notification_jobs IS
  'Durable notification queue across in_app/email/webhook/slack channels. Dedup key prevents duplicate delivery for same escalation event.';
COMMENT ON TABLE notification_delivery_attempts IS
  'Append-only delivery attempt log. One row per attempt per job.';
COMMENT ON TABLE notification_dead_letters IS
  'Poison messages that exhausted max_attempts. Support manual review and replay.';
