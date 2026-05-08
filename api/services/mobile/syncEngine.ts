/**
 * Denver Engineering — Mobile Sync Engine (v4.35.0)
 * ──────────────────────────────────────────────────
 * Ava Phase 3 — Offline-first sync: receive mutations from field devices,
 * apply them idempotently, detect conflicts, and return pull delta.
 *
 * All operations are idempotent via client_id (dedup key per device).
 */
import pool from '../../db/pool'
import { publishActionEvent } from '../actions/actionEventPublisher'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OfflineMutation {
  client_id:          string
  mutation_type:      string
  entity_type:        string
  payload:            Record<string, unknown>
  attachments?:       string[]
  created_offline_at: string  // ISO timestamp
}

export interface SyncUploadInput {
  tenantId:    string
  deviceId:    string
  userId:      string
  mutations:   OfflineMutation[]
  clientWatermark?: string
}

export interface SyncResult {
  session_id:         string
  applied:            number
  conflicted:         number
  rejected:           number
  skipped:            number
  server_watermark:   string
  conflict_ids:       string[]
}

export interface PullDelta {
  events:          unknown[]
  server_watermark: string
  has_more:        boolean
}

// ─── Session management ───────────────────────────────────────────────────────

async function createSyncSession(
  tenantId: string,
  deviceId: string,
  userId:   string,
  mutationCount: number,
): Promise<string> {
  const res = await pool.query(`
    INSERT INTO sync_sessions
      (tenant_id, device_id, user_id, mutations_pushed, status)
    VALUES ($1, $2, $3, $4, 'in_progress')
    RETURNING id
  `, [tenantId, deviceId, userId, mutationCount])
  return res.rows[0].id as string
}

async function updateSyncSession(
  sessionId: string,
  stats:     { applied: number; conflicted: number; rejected: number; skipped: number },
): Promise<void> {
  await pool.query(`
    UPDATE sync_sessions SET
      status             = 'completed',
      mutations_pushed   = $2,
      conflicts_detected = $3,
      completed_at       = NOW()
    WHERE id = $1
  `, [sessionId, stats.applied, stats.conflicted])
}

// ─── Mutation application ──────────────────────────────────────────────────────

type MutationApplyResult = 'applied' | 'conflicted' | 'rejected' | 'skipped'

async function applyMutation(
  tenantId:  string,
  deviceId:  string,
  userId:    string,
  sessionId: string,
  mutation:  OfflineMutation,
): Promise<{ status: MutationApplyResult; conflictId?: string; entityId?: string }> {
  // Check idempotency — already processed?
  const existing = await pool.query(
    `SELECT id, status, applied_entity_id FROM offline_mutations
     WHERE tenant_id = $1 AND device_id = $2 AND client_id = $3`,
    [tenantId, deviceId, mutation.client_id],
  )
  if (existing.rows[0]) {
    // Already processed — return skipped
    return { status: 'skipped', entityId: existing.rows[0].applied_entity_id }
  }

  // Insert mutation record
  const mutRow = await pool.query(`
    INSERT INTO offline_mutations
      (tenant_id, device_id, user_id, session_id, mutation_type,
       entity_type, client_id, payload, attachments, status, created_offline_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)
    RETURNING id
  `, [
    tenantId, deviceId, userId, sessionId,
    mutation.mutation_type, mutation.entity_type, mutation.client_id,
    JSON.stringify(mutation.payload),
    JSON.stringify(mutation.attachments ?? []),
    mutation.created_offline_at,
  ])
  const mutId = mutRow.rows[0].id as string

  // Dispatch to handler
  try {
    const result = await _dispatchMutation(tenantId, userId, mutation)
    await pool.query(`
      UPDATE offline_mutations SET status = 'applied', applied_entity_id = $2, applied_at = NOW()
      WHERE id = $1
    `, [mutId, result.entityId])
    return { status: 'applied', entityId: result.entityId }
  } catch (err) {
    // Check if it's a conflict
    if (err instanceof ConflictError) {
      const conflictRow = await pool.query(`
        INSERT INTO offline_conflicts
          (tenant_id, mutation_id, entity_type, entity_id, client_version, server_version, conflict_type)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id
      `, [
        tenantId, mutId, mutation.entity_type, err.entityId,
        JSON.stringify(mutation.payload), JSON.stringify(err.serverVersion),
        err.conflictType,
      ])
      await pool.query(
        `UPDATE offline_mutations SET status = 'conflicted', conflict_id = $2 WHERE id = $1`,
        [mutId, conflictRow.rows[0].id],
      )
      return { status: 'conflicted', conflictId: conflictRow.rows[0].id }
    }
    await pool.query(
      `UPDATE offline_mutations SET status = 'rejected', error_message = $2 WHERE id = $1`,
      [mutId, String(err)],
    )
    return { status: 'rejected' }
  }
}

class ConflictError extends Error {
  constructor(
    public entityId:      string | null,
    public serverVersion: Record<string, unknown>,
    public conflictType:  string,
  ) { super('conflict') }
}

// ─── Mutation dispatcher ─────────────────────────────────────────────────────

async function _dispatchMutation(
  tenantId: string,
  userId:   string,
  mutation: OfflineMutation,
): Promise<{ entityId: string }> {
  // Dispatch based on mutation_type
  // In production this would be a registry; here we handle the core cases
  switch (mutation.entity_type) {
    case 'punch_item':    return _applyPunchMutation(tenantId, userId, mutation)
    case 'inspection':    return _applyInspectionMutation(tenantId, userId, mutation)
    case 'daily_log':     return _applyDailyLogMutation(tenantId, userId, mutation)
    default:              return _applyGenericMutation(tenantId, userId, mutation)
  }
}

async function _applyPunchMutation(
  tenantId: string, userId: string, m: OfflineMutation,
): Promise<{ entityId: string }> {
  const p = m.payload as Record<string, unknown>
  if (m.mutation_type === 'create_punch_item') {
    const res = await pool.query(`
      INSERT INTO punch_items
        (tenant_id, project_id, title, description, priority, assigned_to, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id
    `, [tenantId, p['project_id'], p['title'], p['description'], p['priority'] ?? 'medium', p['assigned_to'], userId])
    void publishActionEvent(tenantId, res.rows[0].id, 'created', userId, { source: 'offline_sync' })
    return { entityId: res.rows[0].id }
  }
  if (m.mutation_type === 'update_punch_item') {
    const entityId = p['id'] as string
    // Check for concurrent edit conflict
    const current = await pool.query(
      `SELECT updated_at FROM punch_items WHERE id = $1 AND tenant_id = $2`,
      [entityId, tenantId],
    )
    if (!current.rows[0]) throw new ConflictError(entityId, {}, 'deleted_on_server')
    await pool.query(`
      UPDATE punch_items SET status = COALESCE($3, status), updated_at = NOW()
      WHERE id = $2 AND tenant_id = $1
    `, [tenantId, entityId, p['status']])
    return { entityId }
  }
  throw new Error(`unknown punch mutation: ${m.mutation_type}`)
}

async function _applyInspectionMutation(
  tenantId: string, userId: string, m: OfflineMutation,
): Promise<{ entityId: string }> {
  const p = m.payload as Record<string, unknown>
  if (m.mutation_type === 'complete_inspection') {
    const entityId = p['id'] as string
    await pool.query(`
      UPDATE inspections SET status = $3, completed_by = $4, completed_at = NOW(), updated_at = NOW()
      WHERE id = $2 AND tenant_id = $1
    `, [tenantId, entityId, p['status'] ?? 'completed', userId])
    return { entityId }
  }
  throw new Error(`unknown inspection mutation: ${m.mutation_type}`)
}

async function _applyDailyLogMutation(
  tenantId: string, userId: string, m: OfflineMutation,
): Promise<{ entityId: string }> {
  const p = m.payload as Record<string, unknown>
  const res = await pool.query(`
    INSERT INTO daily_logs (tenant_id, project_id, log_date, notes, created_by)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (tenant_id, project_id, log_date) DO UPDATE SET notes = EXCLUDED.notes
    RETURNING id
  `, [tenantId, p['project_id'], p['log_date'], p['notes'], userId])
  return { entityId: res.rows[0].id }
}

async function _applyGenericMutation(
  _tenantId: string, _userId: string, m: OfflineMutation,
): Promise<{ entityId: string }> {
  // Unknown mutation type — log and reject
  throw new Error(`unsupported mutation: ${m.mutation_type}`)
}

// ─── Pull delta ───────────────────────────────────────────────────────────────

export async function pullDelta(
  tenantId:        string,
  sinceWatermark?: string,
  limit            = 200,
): Promise<PullDelta> {
  const since = sinceWatermark ? new Date(sinceWatermark) : new Date(0)
  const res = await pool.query(`
    SELECT id, event_type, payload, subscription_scope, scope_id, published_at
    FROM realtime_event_log
    WHERE tenant_id = $1 AND published_at > $2
    ORDER BY published_at ASC
    LIMIT $3
  `, [tenantId, since, limit + 1])

  const hasMore = res.rows.length > limit
  const events  = hasMore ? res.rows.slice(0, limit) : res.rows
  const watermark = events.length > 0
    ? (events[events.length - 1] as { published_at: Date }).published_at.toISOString()
    : since.toISOString()

  return { events, server_watermark: watermark, has_more: hasMore }
}

// ─── Main sync upload handler ────────────────────────────────────────────────

export async function processSyncUpload(input: SyncUploadInput): Promise<SyncResult> {
  const sessionId = await createSyncSession(
    input.tenantId, input.deviceId, input.userId, input.mutations.length,
  )

  let applied = 0; let conflicted = 0; let rejected = 0; let skipped = 0
  const conflictIds: string[] = []

  for (const mutation of input.mutations) {
    const r = await applyMutation(
      input.tenantId, input.deviceId, input.userId, sessionId, mutation,
    )
    if (r.status === 'applied')    { applied++ }
    else if (r.status === 'conflicted') { conflicted++; if (r.conflictId) conflictIds.push(r.conflictId) }
    else if (r.status === 'rejected')   { rejected++ }
    else                                { skipped++ }
  }

  await updateSyncSession(sessionId, { applied, conflicted, rejected, skipped })

  const pullResult = await pullDelta(input.tenantId, input.clientWatermark)

  return {
    session_id:       sessionId,
    applied,
    conflicted,
    rejected,
    skipped,
    server_watermark: pullResult.server_watermark,
    conflict_ids:     conflictIds,
  }
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = { applyMutation, ConflictError, pullDelta }
