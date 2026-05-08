/**
 * Denver Engineering — Action Relationship Service (v4.34.0)
 * ────────────────────────────────────────────────────────────
 * Ava Phase 2A — Cross-module dependency orchestration.
 *
 * Manages directed relationships between actions:
 *   blocks | related_to | caused_by | duplicates |
 *   escalated_from | spawned_from | references
 *
 * Cycle detection: before inserting a 'blocks' or 'spawned_from' edge,
 * a recursive CTE walks the existing graph to ensure no path from
 * target → source already exists (which would create a cycle).
 *
 * Idempotent: re-inserting the same (source, target, type) with a
 * previously soft-deleted row reactivates it instead of duplicating.
 */

import { query } from '../../db/pool'
import { slog } from '../../../src/modules/observability/index'
import { publishActionEvent } from './actionEventPublisher'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RelationType =
  | 'blocks' | 'related_to' | 'caused_by'
  | 'duplicates' | 'escalated_from' | 'spawned_from' | 'references'

export interface ActionRelation {
  id:               string
  tenant_id:        string
  source_action_id: string
  target_action_id: string
  relation_type:    RelationType
  notes:            string | null
  deleted_at:       string | null
  created_by:       string | null
  created_at:       string
}

export interface CreateRelationInput {
  sourceActionId: string
  targetActionId: string
  relationType:   RelationType
  notes?:         string | null
  actorId?:       string | null
}

// Relation types that form dependency chains (cycle-check required)
const DEPENDENCY_TYPES: RelationType[] = ['blocks', 'spawned_from', 'caused_by']

// ─── Cycle detection ──────────────────────────────────────────────────────────

/**
 * Returns true if adding edge source→target would create a cycle.
 * Uses recursive CTE to walk all existing edges reachable from target.
 * Only checks DEPENDENCY_TYPES — 'related_to' / 'references' etc. are acyclic-safe.
 */
async function _wouldCreateCycle(
  tenantId:       string,
  sourceActionId: string,
  targetActionId: string,
): Promise<boolean> {
  const result = await query<{ exists: boolean }>(`
    WITH RECURSIVE reachable AS (
      SELECT target_action_id AS action_id
      FROM   action_relations
      WHERE  tenant_id        = $1
        AND  source_action_id = $2
        AND  relation_type    = ANY($4::text[])
        AND  deleted_at       IS NULL

      UNION

      SELECT ar.target_action_id
      FROM   action_relations ar
      INNER JOIN reachable r ON r.action_id = ar.source_action_id
      WHERE  ar.tenant_id     = $1
        AND  ar.relation_type = ANY($4::text[])
        AND  ar.deleted_at    IS NULL
    )
    SELECT EXISTS (
      SELECT 1 FROM reachable WHERE action_id = $3
    ) AS exists
  `, [tenantId, targetActionId, sourceActionId, DEPENDENCY_TYPES])

  return result.rows[0]?.exists ?? false
}

// ─── Create relation ──────────────────────────────────────────────────────────

export async function createRelation(
  tenantId: string,
  input: CreateRelationInput,
): Promise<{ relation: ActionRelation | null; error?: string }> {
  const { sourceActionId, targetActionId, relationType, notes, actorId } = input

  if (sourceActionId === targetActionId) {
    return { relation: null, error: 'self_relation_not_allowed' }
  }

  // Validate both actions belong to this tenant
  const ownership = await query<{ count: string }>(`
    SELECT COUNT(*)::text AS count FROM actions
    WHERE tenant_id = $1 AND id = ANY($2::uuid[])
  `, [tenantId, [sourceActionId, targetActionId]])

  if (parseInt(ownership.rows[0]?.count ?? '0', 10) < 2) {
    return { relation: null, error: 'action_not_found' }
  }

  // Cycle check for dependency types
  if ((DEPENDENCY_TYPES as string[]).includes(relationType)) {
    const cycle = await _wouldCreateCycle(tenantId, sourceActionId, targetActionId)
    if (cycle) {
      return { relation: null, error: 'cycle_detected' }
    }
  }

  // Upsert: reactivate soft-deleted edge or insert new
  const result = await query<ActionRelation>(`
    INSERT INTO action_relations
      (tenant_id, source_action_id, target_action_id, relation_type, notes, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (tenant_id, source_action_id, target_action_id, relation_type) DO UPDATE
      SET deleted_at = NULL,
          deleted_by = NULL,
          notes      = EXCLUDED.notes
    RETURNING *
  `, [tenantId, sourceActionId, targetActionId, relationType, notes ?? null, actorId ?? null])

  const relation = result.rows[0] ?? null

  if (relation) {
    slog('INFO', 'actionRelationship', '[create]', {
      source: sourceActionId, target: targetActionId, type: relationType,
    })
    void publishActionEvent(tenantId, sourceActionId, 'relation_added', actorId ?? null, {
      relation_type: relationType, target_action_id: targetActionId,
    })
  }

  return { relation }
}

// ─── List relations ───────────────────────────────────────────────────────────

export async function listRelations(
  tenantId:  string,
  actionId:  string,
  direction: 'outbound' | 'inbound' | 'both' = 'both',
): Promise<ActionRelation[]> {
  const dirClause =
    direction === 'outbound' ? 'AND source_action_id = $2' :
    direction === 'inbound'  ? 'AND target_action_id = $2' :
    'AND (source_action_id = $2 OR target_action_id = $2)'

  const result = await query<ActionRelation>(`
    SELECT * FROM action_relations
    WHERE  tenant_id  = $1
      AND  deleted_at IS NULL
      ${dirClause}
    ORDER BY created_at ASC
  `, [tenantId, actionId])

  return result.rows
}

// ─── Soft-delete relation ─────────────────────────────────────────────────────

export async function deleteRelation(
  tenantId:   string,
  relationId: string,
  actorId:    string | null,
): Promise<boolean> {
  const result = await query<ActionRelation>(`
    UPDATE action_relations
    SET    deleted_at = NOW(),
           deleted_by = $3
    WHERE  id         = $1
      AND  tenant_id  = $2
      AND  deleted_at IS NULL
    RETURNING source_action_id
  `, [relationId, tenantId, actorId ?? null])

  if (result.rows[0]) {
    void publishActionEvent(tenantId, result.rows[0].source_action_id, 'relation_removed', actorId, {
      relation_id: relationId,
    })
  }
  return (result.rowCount ?? 0) > 0
}

/** Test-only */
export const __testHooks = { wouldCreateCycle: _wouldCreateCycle }
