/**
 * Denver Engineering — Offline Conflict Resolver (v4.35.0)
 * ──────────────────────────────────────────────────────────
 * Ava Phase 3 — Strategies for resolving offline sync conflicts.
 *
 * Strategies:
 *   client_wins  — apply client payload, ignore server state
 *   server_wins  — discard client change, keep server state
 *   merged       — field-level merge (non-destructive fields prefer client)
 *   rejected     — mark unresolvable, require human intervention
 */
import { pool } from '../../db/pool'

export type ResolutionStrategy = 'client_wins' | 'server_wins' | 'merged' | 'rejected'

export interface ConflictResolutionInput {
  tenantId:    string
  conflictId:  string
  strategy:    ResolutionStrategy
  resolvedBy:  string
  mergeFields?: Record<string, unknown>  // for 'merged' strategy
}

// ─── Auto-resolution rules ───────────────────────────────────────────────────

/** Automatically select a resolution strategy based on conflict type */
export function selectAutoStrategy(conflictType: string): ResolutionStrategy {
  switch (conflictType) {
    case 'deleted_on_server':  return 'server_wins'    // entity was deleted remotely
    case 'schema_mismatch':    return 'rejected'        // incompatible versions
    case 'concurrent_edit':    return 'merged'          // attempt merge
    default:                   return 'server_wins'
  }
}

// ─── Field-level merge ───────────────────────────────────────────────────────

/** Merge client and server states at the field level.
 *  Client wins for non-critical fields (title, notes, description).
 *  Server wins for status, priority (authoritative fields). */
export function mergePayloads(
  clientVersion: Record<string, unknown>,
  serverVersion: Record<string, unknown>,
): Record<string, unknown> {
  const CLIENT_WINS_FIELDS = new Set(['title', 'notes', 'description', 'attachments'])
  const merged: Record<string, unknown> = { ...serverVersion }

  for (const [key, clientVal] of Object.entries(clientVersion)) {
    if (CLIENT_WINS_FIELDS.has(key)) {
      merged[key] = clientVal
    }
    // All other fields: server wins (status, priority, assigned_to, etc.)
  }

  return merged
}

// ─── Apply resolution ─────────────────────────────────────────────────────────

export async function resolveConflict(input: ConflictResolutionInput): Promise<boolean> {
  const conflictRes = await pool.query(
    `SELECT * FROM offline_conflicts WHERE id = $1 AND tenant_id = $2`,
    [input.conflictId, input.tenantId],
  )
  if (!conflictRes.rows[0]) return false

  const conflict = conflictRes.rows[0]

  let mergeResult: Record<string, unknown> | null = null

  if (input.strategy === 'merged') {
    mergeResult = input.mergeFields
      ?? mergePayloads(
           conflict.client_version as Record<string, unknown>,
           conflict.server_version as Record<string, unknown>,
         )
  }

  await pool.query(`
    UPDATE offline_conflicts SET
      resolution  = $3,
      resolved_by = $4,
      resolved_at = NOW(),
      merge_result = $5
    WHERE id = $1 AND tenant_id = $2
  `, [
    input.conflictId, input.tenantId,
    input.strategy, input.resolvedBy,
    mergeResult ? JSON.stringify(mergeResult) : null,
  ])

  // Update the parent mutation status
  await pool.query(`
    UPDATE offline_mutations SET
      status = CASE WHEN $3 = 'rejected' THEN 'rejected' ELSE 'applied' END
    WHERE id = $2 AND tenant_id = $1
  `, [input.tenantId, conflict.mutation_id, input.strategy])

  return true
}

// ─── List unresolved conflicts ────────────────────────────────────────────────

export async function listUnresolvedConflicts(
  tenantId: string,
  limit = 50,
): Promise<unknown[]> {
  const res = await pool.query(`
    SELECT c.*, m.mutation_type, m.entity_type, m.created_offline_at
    FROM offline_conflicts c
    JOIN offline_mutations m ON m.id = c.mutation_id
    WHERE c.tenant_id = $1 AND c.resolution IS NULL
    ORDER BY c.created_at DESC
    LIMIT $2
  `, [tenantId, limit])
  return res.rows
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = { selectAutoStrategy, mergePayloads }
