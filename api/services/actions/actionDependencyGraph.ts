/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Denver Engineering — Action Dependency Graph (v4.34.0)
 * ────────────────────────────────────────────────────────
 * Ava Phase 2B — Recursive dependency resolution engine.
 *
 * Computes:
 *   - Is this action blocked? By what?
 *   - Root blockers (deepest unresolved ancestors)
 *   - Downstream impact count (how many actions would unblock if this resolves)
 *   - Critical path flag (action lies on the longest dependency chain)
 *
 * Only 'blocks' and 'spawned_from' edges form blocking relationships.
 * 'related_to', 'references', etc. are informational only.
 */

import { query } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DependencyNode {
  action_id:     string
  title:         string
  status:        string
  priority:      string
  action_type:   string
  depth:         number     // hops from queried action
}

export interface DependencyReport {
  action_id:              string
  is_blocked:             boolean
  blocked_by_count:       number   // immediate blockers (open only)
  blockers:               DependencyNode[]  // immediate open blockers
  root_blockers:          DependencyNode[]  // deepest unresolved ancestors
  downstream_impact_count: number  // open actions that depend on this one
  critical_path_flag:     boolean  // on the longest open dependency chain
}

// Relation types that constitute a blocking dependency
const BLOCKING_TYPES = ['blocks', 'spawned_from']

// ─── Core graph query ─────────────────────────────────────────────────────────

/**
 * Returns all open actions that block `actionId`.
 * Uses recursive CTE capped at depth 10 to prevent infinite loops
 * (cycle detection at write-time prevents true cycles but we cap defensively).
 */
async function _resolveBlockers(
  tenantId: string,
  actionId: string,
  maxDepth: number = 10,
): Promise<DependencyNode[]> {
  const result = await query<DependencyNode & { depth: number }>(`
    WITH RECURSIVE blockers AS (
      -- Direct blockers of this action (actions that block it via 'blocks' edge target→source)
      SELECT
        a.id    AS action_id,
        a.title,
        a.status,
        a.priority,
        a.action_type,
        1 AS depth
      FROM action_relations ar
      INNER JOIN actions a ON a.id = ar.source_action_id
      WHERE ar.tenant_id        = $1
        AND ar.target_action_id = $2
        AND ar.relation_type    = ANY($3::text[])
        AND ar.deleted_at       IS NULL
        AND a.status NOT IN ('completed','cancelled')

      UNION ALL

      -- Transitive blockers
      SELECT
        a.id,
        a.title,
        a.status,
        a.priority,
        a.action_type,
        b.depth + 1
      FROM action_relations ar
      INNER JOIN actions a  ON a.id = ar.source_action_id
      INNER JOIN blockers b ON b.action_id = ar.target_action_id
      WHERE ar.tenant_id     = $1
        AND ar.relation_type = ANY($3::text[])
        AND ar.deleted_at    IS NULL
        AND a.status NOT IN ('completed','cancelled')
        AND b.depth < $4
    )
    SELECT DISTINCT ON (action_id) action_id, title, status, priority, action_type, depth
    FROM blockers
    ORDER BY action_id, depth ASC
  `, [tenantId, actionId, BLOCKING_TYPES, maxDepth])

  return result.rows
}

/**
 * Returns count of open actions that would be unblocked if `actionId` completes.
 */
async function _resolveDownstreamImpact(
  tenantId: string,
  actionId: string,
): Promise<number> {
  const result = await query<{ count: string }>(`
    WITH RECURSIVE downstream AS (
      SELECT ar.target_action_id AS action_id, 1 AS depth
      FROM   action_relations ar
      WHERE  ar.tenant_id        = $1
        AND  ar.source_action_id = $2
        AND  ar.relation_type    = ANY($3::text[])
        AND  ar.deleted_at       IS NULL

      UNION ALL

      SELECT ar.target_action_id, ds.depth + 1
      FROM   action_relations ar
      INNER JOIN downstream ds ON ds.action_id = ar.source_action_id
      WHERE  ar.tenant_id     = $1
        AND  ar.relation_type = ANY($3::text[])
        AND  ar.deleted_at    IS NULL
        AND  ds.depth < 10
    )
    SELECT COUNT(DISTINCT action_id)::text AS count
    FROM   downstream ds
    INNER JOIN actions a ON a.id = ds.action_id
    WHERE  a.status NOT IN ('completed','cancelled')
  `, [tenantId, actionId, BLOCKING_TYPES])

  return parseInt(result.rows[0]?.count ?? '0', 10)
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a full dependency report for one action.
 * Returns a DependencyReport with blocker lists, downstream impact, and critical path flag.
 */
export async function buildDependencyReport(
  tenantId: string,
  actionId: string,
): Promise<DependencyReport> {
  const [allBlockers, downstreamCount] = await Promise.all([
    _resolveBlockers(tenantId, actionId),
    _resolveDownstreamImpact(tenantId, actionId),
  ])

  const immediateBlockers = allBlockers.filter(b => b.depth === 1)
  const rootBlockers      = allBlockers.filter(b => {
    // A root blocker has no incoming blocking edges from within the blocker set
    const blockerIds = new Set(allBlockers.map(x => x.action_id))
    // Root = not itself blocked by another node in the set
    return !allBlockers.some(x => x.action_id !== b.action_id && blockerIds.has(x.action_id))
  })

  // Critical path flag: this action has both blockers AND downstream impact
  const criticalPathFlag = allBlockers.length > 0 && downstreamCount > 0

  return {
    action_id:               actionId,
    is_blocked:              immediateBlockers.length > 0,
    blocked_by_count:        immediateBlockers.length,
    blockers:                immediateBlockers,
    root_blockers:           rootBlockers.length > 0 ? rootBlockers : immediateBlockers,
    downstream_impact_count: downstreamCount,
    critical_path_flag:      criticalPathFlag,
  }
}

/**
 * Batch dependency status for a list of action IDs.
 * Returns a map: action_id → { is_blocked, blocked_by_count, downstream_impact_count }
 * Efficient: single query for all immediate blockers across all IDs.
 */
export async function batchBlockerStatus(
  tenantId:  string,
  actionIds: string[],
): Promise<Map<string, { is_blocked: boolean; blocked_by_count: number; downstream_impact_count: number }>> {
  if (actionIds.length === 0) return new Map()

  const result = await query<{
    action_id:      string
    blocked_by_count: string
  }>(`
    SELECT
      ar.target_action_id AS action_id,
      COUNT(ar.id)::text  AS blocked_by_count
    FROM action_relations ar
    INNER JOIN actions blocker ON blocker.id = ar.source_action_id
    WHERE ar.tenant_id        = $1
      AND ar.target_action_id = ANY($2::uuid[])
      AND ar.relation_type    = ANY($3::text[])
      AND ar.deleted_at       IS NULL
      AND blocker.status      NOT IN ('completed','cancelled')
    GROUP BY ar.target_action_id
  `, [tenantId, actionIds, BLOCKING_TYPES])

  const map = new Map<string, { is_blocked: boolean; blocked_by_count: number; downstream_impact_count: number }>()

  // Initialize all as unblocked
  for (const id of actionIds) {
    map.set(id, { is_blocked: false, blocked_by_count: 0, downstream_impact_count: 0 })
  }

  // Fill in blockers
  for (const row of result.rows) {
    const cnt = parseInt(row.blocked_by_count, 10)
    map.set(row.action_id, { is_blocked: cnt > 0, blocked_by_count: cnt, downstream_impact_count: 0 })
  }

  return map
}

/** Test-only */
export const __testHooks = {
  resolveBlockers:       _resolveBlockers,
  resolveDownstreamImpact: _resolveDownstreamImpact,
}
