-- ============================================================
-- JARVIS EPC — Migration 011: Compliance Tasks
-- v4.31.0 | Due-date watcher with webhook notifications
--
-- A lightweight task register for time-bound compliance items
-- (JHA renewals, SDS reviews, permits, training certifications,
-- scheduled inspections). The complianceWatcher service polls
-- this table each scheduler tick and emits webhook events when
-- a task crosses its notification or overdue threshold.
--
-- State machine (status column):
--   pending    — initial; still outside the notification window
--   notified   — inside notification window; due-soon event fired
--   overdue    — past due_date; overdue event fired
--   completed  — marked done by a user (terminal)
--   waived     — explicitly waived by admin (terminal)
--
-- Transitions emitted as webhook events:
--   pending  → notified   emits 'compliance.task_due'
--   notified → overdue    emits 'compliance.task_overdue'
--   pending  → overdue    emits 'compliance.task_overdue'  (if never notified)
--
-- Subscribers register a webhook against those event names to
-- receive Slack / email / Teams notifications.
-- ============================================================

CREATE TYPE compliance_task_status AS ENUM (
  'pending',
  'notified',
  'overdue',
  'completed',
  'waived'
);

CREATE TABLE compliance_tasks (
  id                  UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id          UUID                  REFERENCES projects(id) ON DELETE CASCADE,

  -- Identity
  title               VARCHAR(255) NOT NULL,
  description         TEXT,
  category            VARCHAR(64)  NOT NULL DEFAULT 'general',
                      -- suggested values: jha, sds, permit, training, inspection, audit

  -- Schedule
  due_date            DATE         NOT NULL,
  notify_days_before  INTEGER      NOT NULL DEFAULT 7
                      CHECK (notify_days_before >= 0),

  -- State
  status              compliance_task_status NOT NULL DEFAULT 'pending',
  last_notified_at    TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,

  -- People
  assigned_to         UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_by          UUID         REFERENCES users(id) ON DELETE SET NULL,

  metadata            JSONB        NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Primary watcher index: the promoter's two UPDATE queries both
-- filter by status + due_date, so this compound index serves both.
CREATE INDEX idx_compliance_status_due
  ON compliance_tasks(status, due_date)
  WHERE status IN ('pending','notified');

CREATE INDEX idx_compliance_tenant
  ON compliance_tasks(tenant_id, due_date);

CREATE INDEX idx_compliance_assigned
  ON compliance_tasks(assigned_to, status) WHERE assigned_to IS NOT NULL;

ALTER TABLE compliance_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_compliance_tasks ON compliance_tasks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_compliance_tasks_updated_at BEFORE UPDATE ON compliance_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
