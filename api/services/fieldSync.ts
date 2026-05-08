/**
 * Denver Engineering — Field Sync Batch Processor
 * ───────────────────────────────────────────
 * v4.31.0 | Idempotent replay of offline-captured mutations
 *
 * Designed for offline-first field workflows (PWA, mobile). The client
 * captures mutations locally while disconnected, each stamped with a
 * client-generated UUID (client_op_id). When connectivity returns the
 * client POSTs a batch here. Each operation is either:
 *
 *   - processed for the first time (idempotency row inserted + resource
 *     mutated in a single transaction) and returns { status: 'success' }
 *   - a duplicate of a previous attempt — we return the cached result
 *     from field_sync_operations without touching the resource
 *   - a conflict because the client's base_updated_at doesn't match the
 *     current row — we return the current row so the client can merge
 *
 * The transaction guarantee means a server crash mid-processing leaves
 * nothing committed, so the retry on the client will find no idempotency
 * record and re-execute cleanly.
 *
 * Adding a resource:
 *   1. Add a case to _dispatchCreate / _dispatchUpdate
 *   2. Add the allowed resource to RESOURCE_ALLOWLIST
 */

import type { PoolClient } from 'pg'
import { tenantTransaction, tenantQuery } from '../db/pool'
import { slog } from '../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export type FieldSyncOp = 'create' | 'update'

export interface FieldSyncOperation {
  client_op_id:      string                 // UUID from the client
  resource:          string                 // 'action_items' | 'daily_logs'
  op:                FieldSyncOp
  data:              Record<string, unknown>
  id?:               string                 // required for 'update'
  base_updated_at?:  string                 // required for 'update' (optimistic lock)
}

export type FieldSyncResultStatus = 'success' | 'conflict' | 'error' | 'replay'

export interface FieldSyncResult {
  client_op_id:   string
  status:         FieldSyncResultStatus
  resource_id?:   string
  resource?:      Record<string, unknown>   // server-authoritative row
  current?:       Record<string, unknown>   // for conflicts — the winning row
  error?:         string
}

const RESOURCE_ALLOWLIST = new Set([
  'action_items', 'daily_logs', 'wirs', 'inspections', 'punch_items',
])

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Process a batch of operations for a tenant. Each operation is
 * committed (or rolled back) in its own transaction so a bad op
 * doesn't block the rest. The order of the results matches the order
 * of the operations input.
 */
export async function processFieldSyncBatch(
  tenantId:  string,
  userId:    string | null,
  operations: FieldSyncOperation[],
): Promise<FieldSyncResult[]> {
  const results: FieldSyncResult[] = []
  for (const op of operations) {
    results.push(await _processOne(tenantId, userId, op))
  }
  return results
}

// ─── One operation ────────────────────────────────────────────────────────────

async function _processOne(
  tenantId: string,
  userId:   string | null,
  op:       FieldSyncOperation,
): Promise<FieldSyncResult> {
  // Input validation — fail fast before opening a transaction.
  if (!op.client_op_id || !/^[0-9a-f-]{36}$/i.test(op.client_op_id)) {
    return { client_op_id: op.client_op_id, status: 'error', error: 'client_op_id must be a UUID' }
  }
  if (!RESOURCE_ALLOWLIST.has(op.resource)) {
    return { client_op_id: op.client_op_id, status: 'error', error: `unsupported resource: ${op.resource}` }
  }
  if (op.op !== 'create' && op.op !== 'update') {
    return { client_op_id: op.client_op_id, status: 'error', error: `unsupported op: ${op.op}` }
  }
  if (op.op === 'update' && !op.id) {
    return { client_op_id: op.client_op_id, status: 'error', error: 'update requires id' }
  }

  // Fast path — if this client_op_id was already processed, skip the
  // transaction entirely and return the cached result. The UNIQUE
  // constraint covers the race; this SELECT is just an optimization.
  const cachedRes = await tenantQuery<{
    status: FieldSyncResultStatus; resource_id: string | null; response_body: Record<string, unknown> | null
  }>(tenantId, `
    SELECT status, resource_id, response_body
    FROM   field_sync_operations
    WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid
      AND  client_op_id = $1
  `, [op.client_op_id])

  const cached = cachedRes.rows[0]
  if (cached) {
    return {
      client_op_id: op.client_op_id,
      status:       'replay',
      resource_id:  cached.resource_id ?? undefined,
      resource:     cached.response_body ?? undefined,
    }
  }

  try {
    return await tenantTransaction(tenantId, async (client) => {
      // Reserve the slot. ON CONFLICT DO NOTHING covers races — if we
      // can't insert, someone else did, and we look up + return their
      // cached result (rare; covers concurrent re-submits).
      const reserve = await client.query<{ id: string }>(`
        INSERT INTO field_sync_operations
          (tenant_id, client_op_id, resource, op, status, request_body, created_by)
        VALUES
          (current_setting('app.current_tenant_id',true)::uuid,
           $1, $2, $3, 'pending', $4::jsonb, $5)
        ON CONFLICT (tenant_id, client_op_id) DO NOTHING
        RETURNING id
      `, [op.client_op_id, op.resource, op.op, JSON.stringify(op), userId])

      if (reserve.rows.length === 0) {
        // Race with a sibling request — pick up their committed result.
        const existing = await client.query<{
          status: FieldSyncResultStatus; resource_id: string | null
          response_body: Record<string, unknown> | null
        }>(`
          SELECT status, resource_id, response_body
          FROM   field_sync_operations
          WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid
            AND  client_op_id = $1
        `, [op.client_op_id])
        const r = existing.rows[0]
        return {
          client_op_id: op.client_op_id,
          status:       'replay',
          resource_id:  r?.resource_id ?? undefined,
          resource:     r?.response_body ?? undefined,
        }
      }

      const reservationId = reserve.rows[0]!.id

      // Execute the mutation.
      const outcome = op.op === 'create'
        ? await _dispatchCreate(client, op, userId)
        : await _dispatchUpdate(client, op)

      // Record final status in the idempotency row so future retries
      // short-circuit with the cached result.
      await client.query(`
        UPDATE field_sync_operations
        SET    status        = $1,
               resource_id   = $2,
               response_body = $3::jsonb,
               error_text    = $4
        WHERE  id = $5
      `, [outcome.status, outcome.resource_id ?? null,
          outcome.resource ? JSON.stringify(outcome.resource)
            : outcome.current ? JSON.stringify(outcome.current)
            : null,
          outcome.error ?? null,
          reservationId])

      return { client_op_id: op.client_op_id, ...outcome }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    slog('ERROR', 'fieldSync', '[op] Unhandled failure', {
      tenantId, resource: op.resource, op: op.op, message: msg,
    })
    return { client_op_id: op.client_op_id, status: 'error', error: msg }
  }
}

// ─── Resource dispatch ───────────────────────────────────────────────────────

interface DispatchOutcome {
  status:       Exclude<FieldSyncResultStatus, 'replay'>
  resource_id?: string
  resource?:    Record<string, unknown>
  current?:     Record<string, unknown>
  error?:       string
}

async function _dispatchCreate(
  client: PoolClient,
  op:     FieldSyncOperation,
  userId: string | null,
): Promise<DispatchOutcome> {
  switch (op.resource) {
    case 'action_items':   return _createActionItem(client, op.data, userId)
    case 'daily_logs':     return _createDailyLog  (client, op.data, userId)
    case 'wirs':           return _createWir       (client, op.data)
    case 'inspections':    return _createInspection(client, op.data)
    case 'punch_items':    return _createPunchItem (client, op.data)
    default:               return { status: 'error', error: `unsupported resource for create: ${op.resource}` }
  }
}

async function _dispatchUpdate(
  client: PoolClient,
  op:     FieldSyncOperation,
): Promise<DispatchOutcome> {
  switch (op.resource) {
    case 'action_items':   return _updateActionItem(client, op.id!, op.data, op.base_updated_at)
    case 'daily_logs':     return _updateDailyLog  (client, op.id!, op.data, op.base_updated_at)
    case 'wirs':           return _updateWir       (client, op.id!, op.data, op.base_updated_at)
    case 'inspections':    return _updateInspection(client, op.id!, op.data, op.base_updated_at)
    case 'punch_items':    return _updatePunchItem (client, op.id!, op.data, op.base_updated_at)
    default:               return { status: 'error', error: `unsupported resource for update: ${op.resource}` }
  }
}

// ─── action_items ─────────────────────────────────────────────────────────────

async function _createActionItem(
  client: PoolClient,
  d:      Record<string, unknown>,
  userId: string | null,
): Promise<DispatchOutcome> {
  if (!d['title']) return { status: 'error', error: 'title required' }

  const res = await client.query<Record<string, unknown>>(`
    INSERT INTO action_items
      (tenant_id, project_id, title, description, status, priority,
       assigned_to, created_by, due_date, source_type, source_id, metadata)
    VALUES
      (current_setting('app.current_tenant_id',true)::uuid,
       $1, $2, $3, COALESCE($4, 'open')::action_status, COALESCE($5, 'medium')::priority_level,
       $6, $7, $8, $9, $10, $11::jsonb)
    RETURNING *
  `, [
    d['project_id']  ?? null, d['title'],      d['description'] ?? null,
    d['status']      ?? null, d['priority']    ?? null,
    d['assigned_to'] ?? null, userId,           d['due_date']   ?? null,
    d['source_type'] ?? null, d['source_id']   ?? null,
    JSON.stringify(d['metadata'] ?? {}),
  ])
  const row = res.rows[0]!
  return { status: 'success', resource_id: row['id'] as string, resource: row }
}

async function _updateActionItem(
  client:          PoolClient,
  id:              string,
  d:               Record<string, unknown>,
  baseUpdatedAt?:  string,
): Promise<DispatchOutcome> {
  return _optimisticUpdate(client, 'action_items', id, baseUpdatedAt, {
    allowed: ['title','description','status','priority','assigned_to','due_date','completed_at','metadata'],
    casts:   { status: 'action_status', priority: 'priority_level', metadata: 'jsonb' },
    data:    d,
  })
}

// ─── daily_logs ───────────────────────────────────────────────────────────────

async function _createDailyLog(
  client: PoolClient,
  d:      Record<string, unknown>,
  userId: string | null,
): Promise<DispatchOutcome> {
  if (!d['project_id'] || !d['log_date']) {
    return { status: 'error', error: 'project_id and log_date required' }
  }

  const res = await client.query<Record<string, unknown>>(`
    INSERT INTO daily_logs
      (tenant_id, project_id, log_date, weather, temp_f, wind_mph, humidity_pct,
       manpower, equipment, visitors, deliveries,
       work_performed, delays, safety_notes, incidents,
       quality_notes, photos, status, created_by)
    VALUES
      (current_setting('app.current_tenant_id',true)::uuid,
       $1, $2::date, $3, $4, $5, $6,
       $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb,
       $11, $12, $13, $14::jsonb,
       $15, $16::jsonb, COALESCE($17, 'draft'), $18)
    RETURNING *
  `, [
    d['project_id'],   d['log_date'],
    d['weather']   ?? null, d['temp_f'] ?? null, d['wind_mph'] ?? null, d['humidity_pct'] ?? null,
    JSON.stringify(d['manpower']   ?? []),
    JSON.stringify(d['equipment']  ?? []),
    JSON.stringify(d['visitors']   ?? []),
    JSON.stringify(d['deliveries'] ?? []),
    d['work_performed'] ?? null, d['delays'] ?? null, d['safety_notes'] ?? null,
    JSON.stringify(d['incidents']  ?? []),
    d['quality_notes']  ?? null,
    JSON.stringify(d['photos']     ?? []),
    d['status']      ?? null,
    userId,
  ])
  const row = res.rows[0]!
  return { status: 'success', resource_id: row['id'] as string, resource: row }
}

async function _updateDailyLog(
  client:         PoolClient,
  id:             string,
  d:              Record<string, unknown>,
  baseUpdatedAt?: string,
): Promise<DispatchOutcome> {
  return _optimisticUpdate(client, 'daily_logs', id, baseUpdatedAt, {
    allowed: ['weather','temp_f','wind_mph','humidity_pct','manpower','equipment',
              'visitors','deliveries','work_performed','delays','safety_notes',
              'incidents','quality_notes','photos','status'],
    casts:   { manpower: 'jsonb', equipment: 'jsonb', visitors: 'jsonb', deliveries: 'jsonb',
               incidents: 'jsonb', photos: 'jsonb' },
    data:    d,
  })
}

// ─── wirs (Work Inspection Requests) ─────────────────────────────────────────

async function _createWir(
  client: PoolClient,
  d:      Record<string, unknown>,
): Promise<DispatchOutcome> {
  if (!d['project_id'] || !d['wir_number'] || !d['title']) {
    return { status: 'error', error: 'project_id, wir_number, and title required' }
  }
  const res = await client.query<Record<string, unknown>>(`
    INSERT INTO wirs
      (tenant_id, project_id, wir_number, title, discipline, system_tag,
       status, inspection_type, required_by, scheduled_at, inspector, witness,
       punch_items, test_data, result_notes, metadata)
    VALUES
      (current_setting('app.current_tenant_id',true)::uuid,
       $1, $2, $3, $4, $5,
       COALESCE($6, 'open')::wir_status, $7, $8, $9, $10, $11,
       $12::jsonb, $13::jsonb, $14, $15::jsonb)
    RETURNING *
  `, [
    d['project_id'], d['wir_number'], d['title'],
    d['discipline']      ?? null, d['system_tag']      ?? null,
    d['status']          ?? null, d['inspection_type'] ?? null,
    d['required_by']     ?? null, d['scheduled_at']    ?? null,
    d['inspector']       ?? null, d['witness']         ?? null,
    JSON.stringify(d['punch_items'] ?? []),
    JSON.stringify(d['test_data']   ?? {}),
    d['result_notes']    ?? null,
    JSON.stringify(d['metadata']    ?? {}),
  ])
  const row = res.rows[0]!
  return { status: 'success', resource_id: row['id'] as string, resource: row }
}

async function _updateWir(
  client: PoolClient, id: string, d: Record<string, unknown>, baseUpdatedAt?: string,
): Promise<DispatchOutcome> {
  return _optimisticUpdate(client, 'wirs', id, baseUpdatedAt, {
    allowed: ['title','discipline','system_tag','status','inspection_type',
              'required_by','scheduled_at','completed_at','inspector','witness',
              'punch_items','test_data','result_notes','metadata'],
    casts:   { status: 'wir_status', punch_items: 'jsonb', test_data: 'jsonb', metadata: 'jsonb' },
    data:    d,
  })
}

// ─── inspections ─────────────────────────────────────────────────────────────

async function _createInspection(
  client: PoolClient,
  d:      Record<string, unknown>,
): Promise<DispatchOutcome> {
  if (!d['project_id'] || !d['inspection_number'] || !d['title']) {
    return { status: 'error', error: 'project_id, inspection_number, and title required' }
  }
  const res = await client.query<Record<string, unknown>>(`
    INSERT INTO inspections
      (tenant_id, project_id, template_id, inspection_number, title, type,
       location, discipline, status, scheduled_date, completed_date, inspector_id,
       results, pass_count, fail_count, na_count, overall_result)
    VALUES
      (current_setting('app.current_tenant_id',true)::uuid,
       $1, $2, $3, $4, $5, $6, $7,
       COALESCE($8, 'scheduled'), $9, $10, $11,
       $12::jsonb, $13, $14, $15, $16)
    RETURNING *
  `, [
    d['project_id'], d['template_id'] ?? null, d['inspection_number'],
    d['title'], d['type'] ?? null, d['location'] ?? null, d['discipline'] ?? null,
    d['status'] ?? null, d['scheduled_date'] ?? null, d['completed_date'] ?? null,
    d['inspector_id'] ?? null,
    JSON.stringify(d['results'] ?? []),
    Number(d['pass_count'] ?? 0),
    Number(d['fail_count'] ?? 0),
    Number(d['na_count']   ?? 0),
    d['overall_result'] ?? null,
  ])
  const row = res.rows[0]!
  return { status: 'success', resource_id: row['id'] as string, resource: row }
}

async function _updateInspection(
  client: PoolClient, id: string, d: Record<string, unknown>, baseUpdatedAt?: string,
): Promise<DispatchOutcome> {
  return _optimisticUpdate(client, 'inspections', id, baseUpdatedAt, {
    allowed: ['title','type','location','discipline','status','scheduled_date',
              'completed_date','inspector_id','results','pass_count','fail_count',
              'na_count','overall_result'],
    casts:   { results: 'jsonb' },
    data:    d,
  })
}

// ─── punch_items ──────────────────────────────────────────────────────────────

async function _createPunchItem(
  client: PoolClient,
  d:      Record<string, unknown>,
): Promise<DispatchOutcome> {
  if (!d['punch_list_id'] || !d['project_id'] || !d['title']) {
    return { status: 'error', error: 'punch_list_id, project_id, and title required' }
  }
  const res = await client.query<Record<string, unknown>>(`
    INSERT INTO punch_items
      (tenant_id, punch_list_id, project_id, item_number, title, description,
       location, discipline, priority, status, assigned_to, due_date,
       drawing_id, pin_x, pin_y, photos)
    VALUES
      (current_setting('app.current_tenant_id',true)::uuid,
       $1, $2, $3, $4, $5, $6, $7,
       COALESCE($8, 'medium'), COALESCE($9, 'open'), $10, $11,
       $12, $13, $14, $15::jsonb)
    RETURNING *
  `, [
    d['punch_list_id'], d['project_id'],
    Number(d['item_number'] ?? 0),
    d['title'], d['description'] ?? null, d['location'] ?? null, d['discipline'] ?? null,
    d['priority'] ?? null, d['status'] ?? null, d['assigned_to'] ?? null, d['due_date'] ?? null,
    d['drawing_id'] ?? null, d['pin_x'] ?? null, d['pin_y'] ?? null,
    JSON.stringify(d['photos'] ?? []),
  ])
  const row = res.rows[0]!
  return { status: 'success', resource_id: row['id'] as string, resource: row }
}

async function _updatePunchItem(
  client: PoolClient, id: string, d: Record<string, unknown>, baseUpdatedAt?: string,
): Promise<DispatchOutcome> {
  return _optimisticUpdate(client, 'punch_items', id, baseUpdatedAt, {
    allowed: ['title','description','location','discipline','priority','status',
              'assigned_to','due_date','drawing_id','pin_x','pin_y','photos'],
    casts:   { photos: 'jsonb' },
    data:    d,
  })
}

// ─── Shared optimistic-update helper ─────────────────────────────────────────

interface UpdateSpec {
  allowed: string[]
  casts:   Record<string, string>
  data:    Record<string, unknown>
}

async function _optimisticUpdate(
  client:        PoolClient,
  table:         string,
  id:            string,
  baseUpdatedAt: string | undefined,
  spec:          UpdateSpec,
): Promise<DispatchOutcome> {
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const field of spec.allowed) {
    if (Object.prototype.hasOwnProperty.call(spec.data, field)) {
      const cast = spec.casts[field]
      if (cast === 'jsonb') {
        sets.push(`${field} = $${i++}::jsonb`)
        vals.push(JSON.stringify(spec.data[field]))
      } else if (cast) {
        sets.push(`${field} = $${i++}::${cast}`)
        vals.push(spec.data[field])
      } else {
        sets.push(`${field} = $${i++}`)
        vals.push(spec.data[field])
      }
    }
  }
  if (sets.length === 0) return { status: 'error', error: 'no valid fields to update' }

  // Optimistic lock: if base_updated_at is supplied, the UPDATE only matches
  // when the row's current updated_at equals it. Mismatch → 0 rows → conflict.
  // If omitted, the update is unconditional (client acknowledges the risk).
  vals.push(id)
  let whereClause = `id = $${i++}
                     AND tenant_id = current_setting('app.current_tenant_id',true)::uuid`
  if (baseUpdatedAt) {
    vals.push(baseUpdatedAt)
    whereClause += ` AND updated_at = $${i++}::timestamptz`
  }

  const res = await client.query<Record<string, unknown>>(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE ${whereClause} RETURNING *`,
    vals,
  )

  if (res.rows[0]) {
    const row = res.rows[0]
    return { status: 'success', resource_id: row['id'] as string, resource: row }
  }

  // Zero rows → either the row doesn't exist, or optimistic lock failed.
  // Fetch current state so the client can decide how to merge.
  const currentRes = await client.query<Record<string, unknown>>(
    `SELECT * FROM ${table}
     WHERE id = $1
       AND tenant_id = current_setting('app.current_tenant_id',true)::uuid`,
    [id],
  )
  const current = currentRes.rows[0]
  if (!current) return { status: 'error', error: `${table} not found: ${id}` }
  return { status: 'conflict', resource_id: id, current }
}
