-- ============================================================
-- Denver Engineering — Migration 030: Action Relations (v4.34.0)
-- LUNA Phase 2A — Cross-module dependency orchestration
--
-- NEW tables:
--   action_relations   — directed relationship graph between actions
--
-- Relation types:
--   blocks | related_to | caused_by | duplicates | escalated_from
--   spawned_from | references
--
-- Design notes:
--   - directed edge: source_action_id → [relation_type] → target_action_id
--   - soft delete via deleted_at (append-safe, audit trail preserved)
--   - UNIQUE constraint prevents duplicate edges of same type
--   - cycle detection enforced at service layer (not DB)
--   - RLS on tenant_id
-- ============================================================

CREATE TABLE action_relations (
  id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID          NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  source_action_id   UUID          NOT NULL REFERENCES actions(id)  ON DELETE CASCADE,
  target_action_id   UUID          NOT NULL REFERENCES actions(id)  ON DELETE CASCADE,

  relation_type      VARCHAR(30)   NOT NULL
                     CHECK (relation_type IN (
                       'blocks', 'related_to', 'caused_by',
                       'duplicates', 'escalated_from', 'spawned_from', 'references'
                     )),

  notes              TEXT,

  -- Soft delete
  deleted_at         TIMESTAMPTZ,
  deleted_by         UUID          REFERENCES users(id) ON DELETE SET NULL,

  -- Audit
  created_by         UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Prevent self-relations
  CHECK (source_action_id <> target_action_id),

  -- Prevent duplicate active edges of the same type
  UNIQUE (tenant_id, source_action_id, target_action_id, relation_type)
);

CREATE INDEX idx_action_relations_source   ON action_relations(source_action_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_action_relations_target   ON action_relations(target_action_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_action_relations_tenant   ON action_relations(tenant_id, relation_type) WHERE deleted_at IS NULL;

ALTER TABLE action_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_action_relations ON action_relations
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

COMMENT ON TABLE action_relations IS
  'Directed relationship graph between actions. blocks/caused_by/spawned_from model dependency chains. Soft-deleted for audit preservation.';
