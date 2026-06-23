-- ════════════════════════════════════════════════════════════════════════════
-- 077_coordination_recommendations.sql — Phase 12: Autonomous Coordination
-- ════════════════════════════════════════════════════════════════════════════
-- Persists AI-generated coordination recommendations (monitor → detect →
-- recommend) and their human decision (execute-with-approval). On approval a
-- recommendation is executed by creating a tracked `action`, recorded here as
-- executed_action_id for a full audit trail. Tenant-isolated via RLS.
-- ════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rec_status') THEN
    CREATE TYPE rec_status AS ENUM ('proposed','approved','dismissed','executed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS coordination_recommendations (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID         NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id         UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dedupe_key         TEXT         NOT NULL,               -- stable id for a given detected issue
  category           VARCHAR(40)  NOT NULL,               -- missing_approval | blocker | schedule_clash | bim_clash | commercial_gate
  source             VARCHAR(40)  NOT NULL,               -- rfi | submittal | action | schedule | bim | change_order
  source_ref         TEXT,                                -- human ref, e.g. "RFI 14"
  source_record_id   UUID,                                -- originating record id, if any
  title              TEXT         NOT NULL,
  recommended_action TEXT         NOT NULL,
  rationale          TEXT,
  suggested_owner    UUID         REFERENCES users(id) ON DELETE SET NULL,
  priority           VARCHAR(20)  NOT NULL DEFAULT 'medium',
  severity           VARCHAR(20),
  status             rec_status   NOT NULL DEFAULT 'proposed',
  executed_action_id UUID,                                -- the action created on approval
  decided_by         UUID         REFERENCES users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_coord_recs_project ON coordination_recommendations(tenant_id, project_id, status);

ALTER TABLE coordination_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE coordination_recommendations FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON coordination_recommendations
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON coordination_recommendations TO jarvis_app;
