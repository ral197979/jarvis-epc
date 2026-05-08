-- Denver Engineering — Migration 045: Multi-Agent Operational Intelligence (v5.0.0)
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates tables for the agent registry, task queue, execution ledger,
-- decision traces, handoff protocol, agent memory, and approval workflow.

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE agent_task_status AS ENUM (
  'queued', 'assigned', 'running', 'completed', 'failed',
  'cancelled', 'pending_approval', 'blocked'
);

CREATE TYPE agent_execution_status AS ENUM (
  'running', 'completed', 'failed', 'cancelled', 'paused'
);

CREATE TYPE agent_handoff_status AS ENUM (
  'pending', 'accepted', 'rejected', 'completed', 'timed_out'
);

CREATE TYPE agent_approval_status AS ENUM (
  'pending', 'approved', 'rejected', 'expired'
);

-- ─── Agent task queue ────────────────────────────────────────────────────────

CREATE TABLE agent_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  agent_type      text NOT NULL,
  task_type       text NOT NULL,
  priority        int NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  status          agent_task_status NOT NULL DEFAULT 'queued',
  payload         jsonb NOT NULL DEFAULT '{}',
  context         jsonb NOT NULL DEFAULT '{}',
  result          jsonb,
  error           text,
  parent_task_id  uuid REFERENCES agent_tasks(id),
  execution_id    uuid,   -- set when assigned to an execution
  claimed_by      text,   -- worker ID
  claimed_at      timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  max_retries     int NOT NULL DEFAULT 3,
  retry_count     int NOT NULL DEFAULT 0,
  scheduled_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  idempotency_key text UNIQUE,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── Agent task steps ────────────────────────────────────────────────────────

CREATE TABLE agent_task_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  task_id      uuid NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  step_index   int NOT NULL,
  step_type    text NOT NULL,
  description  text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  input        jsonb NOT NULL DEFAULT '{}',
  output       jsonb,
  error        text,
  started_at   timestamptz,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id, step_index)
);

-- ─── Agent execution records (immutable ledger) ──────────────────────────────

CREATE TABLE agent_executions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  task_id         uuid NOT NULL REFERENCES agent_tasks(id),
  agent_type      text NOT NULL,
  agent_version   text NOT NULL DEFAULT '1.0.0',
  status          agent_execution_status NOT NULL DEFAULT 'running',
  input_snapshot  jsonb NOT NULL DEFAULT '{}',   -- immutable copy of task payload at start
  output          jsonb,
  policy_checks   jsonb NOT NULL DEFAULT '[]',   -- array of policy evaluation results
  duration_ms     int,
  tokens_used     int,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  worker_id       text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Immutable: block UPDATE and DELETE
CREATE RULE no_update_agent_executions AS
  ON UPDATE TO agent_executions DO INSTEAD NOTHING;
CREATE RULE no_delete_agent_executions AS
  ON DELETE TO agent_executions DO INSTEAD NOTHING;

-- ─── Agent execution event log ────────────────────────────────────────────────

CREATE TABLE agent_execution_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  execution_id uuid NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  event_type   text NOT NULL,
  sequence_num int NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}',
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(execution_id, sequence_num)
);

-- ─── Agent decision traces ───────────────────────────────────────────────────

CREATE TABLE agent_decision_traces (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  execution_id   uuid NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  decision_type  text NOT NULL,
  rationale      text NOT NULL,
  confidence     numeric(5,2) CHECK (confidence BETWEEN 0 AND 100),
  alternatives   jsonb NOT NULL DEFAULT '[]',   -- other options considered
  policy_context jsonb NOT NULL DEFAULT '{}',
  chosen_action  text NOT NULL,
  decided_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── Agent handoff protocol ──────────────────────────────────────────────────

CREATE TABLE agent_handoffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  from_agent      text NOT NULL,
  to_agent        text NOT NULL,
  task_id         uuid NOT NULL REFERENCES agent_tasks(id),
  execution_id    uuid REFERENCES agent_executions(id),
  status          agent_handoff_status NOT NULL DEFAULT 'pending',
  context_package jsonb NOT NULL DEFAULT '{}',   -- context passed to receiving agent
  reason          text NOT NULL,
  accepted_at     timestamptz,
  completed_at    timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── Agent approval queue ────────────────────────────────────────────────────

CREATE TABLE agent_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  task_id        uuid NOT NULL REFERENCES agent_tasks(id),
  execution_id   uuid REFERENCES agent_executions(id),
  agent_type     text NOT NULL,
  action_type    text NOT NULL,
  description    text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}',
  risk_level     text NOT NULL DEFAULT 'medium'
                   CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  status         agent_approval_status NOT NULL DEFAULT 'pending',
  requested_by   text NOT NULL,   -- agent ID
  reviewed_by    uuid,
  review_notes   text,
  reviewed_at    timestamptz,
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ─── Agent memory store ──────────────────────────────────────────────────────

CREATE TABLE agent_memory_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  agent_type   text,   -- null = shared across agents
  scope_type   text NOT NULL CHECK (scope_type IN ('project', 'workflow', 'action', 'global')),
  scope_id     text,
  memory_type  text NOT NULL CHECK (memory_type IN ('fact', 'pattern', 'preference', 'outcome')),
  key          text NOT NULL,
  value        jsonb NOT NULL,
  confidence   numeric(5,2) CHECK (confidence BETWEEN 0 AND 100),
  source_execution_id uuid REFERENCES agent_executions(id),
  times_accessed int NOT NULL DEFAULT 0,
  last_accessed  timestamptz,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, agent_type, scope_type, scope_id, key)
);

-- ─── Agent memory links (associative graph) ──────────────────────────────────

CREATE TABLE agent_memory_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  from_entry  uuid NOT NULL REFERENCES agent_memory_entries(id) ON DELETE CASCADE,
  to_entry    uuid NOT NULL REFERENCES agent_memory_entries(id) ON DELETE CASCADE,
  link_type   text NOT NULL CHECK (link_type IN ('related', 'caused_by', 'contradicts', 'supports')),
  strength    numeric(5,2) NOT NULL DEFAULT 1.0 CHECK (strength BETWEEN 0 AND 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(from_entry, to_entry, link_type)
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX idx_agent_tasks_tenant_status   ON agent_tasks(tenant_id, status);
CREATE INDEX idx_agent_tasks_agent_type      ON agent_tasks(agent_type, status);
CREATE INDEX idx_agent_tasks_scheduled       ON agent_tasks(scheduled_at) WHERE status = 'queued';
CREATE INDEX idx_agent_task_steps_task       ON agent_task_steps(task_id);
CREATE INDEX idx_agent_executions_tenant     ON agent_executions(tenant_id);
CREATE INDEX idx_agent_executions_task       ON agent_executions(task_id);
CREATE INDEX idx_agent_exec_events_exec      ON agent_execution_events(execution_id, sequence_num);
CREATE INDEX idx_agent_decision_traces_exec  ON agent_decision_traces(execution_id);
CREATE INDEX idx_agent_handoffs_task         ON agent_handoffs(task_id);
CREATE INDEX idx_agent_handoffs_to_agent     ON agent_handoffs(to_agent, status);
CREATE INDEX idx_agent_approvals_tenant      ON agent_approvals(tenant_id, status);
CREATE INDEX idx_agent_approvals_task        ON agent_approvals(task_id);
CREATE INDEX idx_agent_memory_lookup         ON agent_memory_entries(tenant_id, agent_type, scope_type, scope_id);
CREATE INDEX idx_agent_memory_links_from     ON agent_memory_links(from_entry);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE agent_tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_task_steps        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_executions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_execution_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_decision_traces   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_handoffs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_approvals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory_entries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory_links      ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON agent_tasks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON agent_task_steps
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON agent_executions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON agent_execution_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON agent_decision_traces
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON agent_handoffs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON agent_approvals
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON agent_memory_entries
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_isolation ON agent_memory_links
  USING (
    from_entry IN (
      SELECT id FROM agent_memory_entries
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid
    )
  );
