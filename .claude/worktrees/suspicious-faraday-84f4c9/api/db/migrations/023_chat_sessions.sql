-- ============================================================
-- JARVIS EPC — Migration 023: Ask Jarvis chat persistence
-- v4.31.0 | Conversation + message log for the grounded RAG chat
--
-- Two tables:
--   chat_sessions  — one conversation, tenant+user scoped
--   chat_messages  — turns within a session, structured answer + citations
--
-- Design decisions:
--  * resolved_flag on sessions — signal for the learning loop. When a
--    user confirms an answer resolved their problem, we set this and
--    the message (+ its citations) become supervised-learning candidates.
--  * linked_work_order_id — reserved for the Ava→Work-Order automation
--    step. When a chat leads to a commissioning action, we can trace
--    the connection for audit / fine-tune dataset curation.
--  * structured_answer JSONB — the full schema-enforced reply from
--    Claude (answer, procedure, possible_causes, confidence, citations).
--    Keeping it raw rather than exploded so schema evolution is a non-
--    migration change.
-- ============================================================

CREATE TABLE chat_sessions (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,

  title                  VARCHAR(255),                -- derived from first question
  project_id             UUID REFERENCES projects(id)         ON DELETE SET NULL,

  -- Learning-loop signals
  resolved_flag          BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at            TIMESTAMPTZ,
  resolved_by            UUID REFERENCES users(id)            ON DELETE SET NULL,
  linked_work_order_id   UUID,            -- reserved; FK deferred until work_orders table lands

  message_count          INTEGER NOT NULL DEFAULT 0,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_sessions_tenant_user
  ON chat_sessions(tenant_id, user_id, updated_at DESC);

CREATE INDEX idx_chat_sessions_project
  ON chat_sessions(tenant_id, project_id)
  WHERE project_id IS NOT NULL;

CREATE INDEX idx_chat_sessions_resolved
  ON chat_sessions(tenant_id, resolved_flag, resolved_at DESC)
  WHERE resolved_flag = TRUE;

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_chat_sessions ON chat_sessions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE TRIGGER trg_chat_sessions_updated_at BEFORE UPDATE ON chat_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────
-- MESSAGES
-- Ordered turns. role='user' stores the raw question. role='assistant'
-- stores the structured JSON answer + citations + retrieved chunks.
-- ──────────────────────────────────────────────────────────────

CREATE TABLE chat_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id          UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  tenant_id           UUID NOT NULL REFERENCES tenants(id)        ON DELETE CASCADE,

  ordinal             INTEGER NOT NULL,          -- 0-based turn index in session
  role                VARCHAR(16) NOT NULL CHECK (role IN ('user','assistant','system')),
  content             TEXT NOT NULL,              -- raw text (user input OR assistant summary)

  -- Assistant-only: full structured reply (answer, procedure, possible_causes,
  -- confidence, citations). NULL for user/system messages.
  structured_answer   JSONB,

  -- Assistant-only: retrieved chunk IDs + scores, in the order they
  -- were shown to Claude. Enables "replay" of a session and cheap
  -- re-grounding if the corpus changes.
  retrieved_chunk_ids JSONB DEFAULT '[]'::jsonb,

  -- Tokens billed by the model call. Useful for cost accounting +
  -- per-user rate limiting.
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  model               VARCHAR(64),

  -- Error carry-back — if the model call failed mid-turn we still
  -- record the attempt so the UI can show a retry-able state.
  error_text          TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chat_messages_ordinal_unique UNIQUE (session_id, ordinal)
);

CREATE INDEX idx_chat_messages_session
  ON chat_messages(session_id, ordinal);

CREATE INDEX idx_chat_messages_tenant_time
  ON chat_messages(tenant_id, created_at DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_chat_messages ON chat_messages
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
