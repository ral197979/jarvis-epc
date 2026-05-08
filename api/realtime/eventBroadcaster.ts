/**
 * Denver Engineering — Real-time Event Broadcaster (v4.35.0)
 * ───────────────────────────────────────────────────────────
 * Ava Phase 3 — Persists events to realtime_event_log and fans out
 * to all active WebSocket subscribers.
 *
 * Architecture:
 *   - Events are persisted FIRST (durability guarantee)
 *   - Then broadcast to active connections in-process
 *   - Late-joining clients can replay missed events from the log
 *   - No direct module → broadcaster coupling; always via publishRealtimeEvent()
 */
import { pool } from '../db/pool'
import { getSubscriptionManager } from './subscriptionManager'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RealtimeEventType =
  | 'action_created'       | 'action_updated'      | 'escalation_triggered'
  | 'blocker_added'        | 'blocker_removed'      | 'readiness_changed'
  | 'incident_reported'    | 'inspection_failed'    | 'notification_failed'
  | 'sync_completed'       | 'command_issued'       | 'evidence_uploaded'
  | 'breach_predicted'     | 'recommendation_ready'

export type SubscriptionScope =
  | 'tenant' | 'project' | 'module' | 'assignee' | 'escalation' | 'action' | 'readiness'

export interface RealtimeEvent {
  id?:                 string
  event_type:          RealtimeEventType
  tenant_id:           string
  payload:             Record<string, unknown>
  subscription_scope:  SubscriptionScope
  scope_id?:           string
  sequence_number?:    number
  correlation_id?:     string
  published_at?:       string
}

// ─── Event deduplication window ───────────────────────────────────────────────

const _recentEvents = new Map<string, number>()
const DEDUP_WINDOW_MS = 5_000

function _isDuplicate(key: string): boolean {
  const last = _recentEvents.get(key)
  const now  = Date.now()
  if (last && now - last < DEDUP_WINDOW_MS) return true
  _recentEvents.set(key, now)
  // Cleanup old entries periodically
  if (_recentEvents.size > 1000) {
    for (const [k, t] of _recentEvents) {
      if (now - t > DEDUP_WINDOW_MS * 2) _recentEvents.delete(k)
    }
  }
  return false
}

// ─── Persist to log ───────────────────────────────────────────────────────────

async function _persistEvent(event: RealtimeEvent): Promise<{ id: number; seq: number }> {
  const seqRes = await pool.query(`SELECT nextval('realtime_event_seq') AS seq`)
  const seq    = Number(seqRes.rows[0].seq)

  const res = await pool.query(`
    INSERT INTO realtime_event_log
      (tenant_id, event_type, payload, subscription_scope, scope_id,
       sequence_number, correlation_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id
  `, [
    event.tenant_id,
    event.event_type,
    JSON.stringify(event.payload),
    event.subscription_scope,
    event.scope_id ?? null,
    seq,
    event.correlation_id ?? null,
  ])

  return { id: res.rows[0].id, seq }
}

// ─── Main publish function ────────────────────────────────────────────────────

export async function publishRealtimeEvent(event: RealtimeEvent): Promise<void> {
  // Dedup check
  const dedupKey = `${event.tenant_id}:${event.event_type}:${event.scope_id ?? ''}:${JSON.stringify(event.payload).slice(0, 100)}`
  if (_isDuplicate(dedupKey)) return

  let seq = 0
  try {
    const result = await _persistEvent(event)
    seq = result.seq
  } catch (err) {
    // Persistence failure should not block broadcast
    console.error('[broadcaster] persist failed', err)
  }

  // Fan out to active WebSocket subscribers
  const enriched = {
    ...event,
    sequence_number: seq,
    published_at:    new Date().toISOString(),
  }

  try {
    const manager = getSubscriptionManager()
    manager.broadcast(enriched)
  } catch {
    // No active manager (test context) — silently skip
  }
}

// ─── Fire-and-forget convenience ─────────────────────────────────────────────

export function broadcastEvent(event: RealtimeEvent): void {
  void publishRealtimeEvent(event)
}

// ─── Replay events ────────────────────────────────────────────────────────────

export async function replayEvents(
  tenantId:         string,
  scope:            SubscriptionScope,
  scopeId:          string | undefined,
  sinceSequence:    number,
  limit             = 100,
): Promise<RealtimeEvent[]> {
  const res = await pool.query(`
    SELECT id, event_type, payload, subscription_scope, scope_id,
           sequence_number, correlation_id, published_at
    FROM realtime_event_log
    WHERE tenant_id = $1
      AND subscription_scope = $2
      AND ($3::varchar IS NULL OR scope_id = $3)
      AND sequence_number > $4
    ORDER BY sequence_number ASC
    LIMIT $5
  `, [tenantId, scope, scopeId ?? null, sinceSequence, limit])

  return res.rows.map(r => ({
    id:                 String(r.id),
    event_type:         r.event_type as RealtimeEventType,
    tenant_id:          tenantId,
    payload:            r.payload as Record<string, unknown>,
    subscription_scope: r.subscription_scope as SubscriptionScope,
    scope_id:           r.scope_id as string | undefined,
    sequence_number:    Number(r.sequence_number),
    correlation_id:     r.correlation_id as string | undefined,
    published_at:       r.published_at instanceof Date
                          ? r.published_at.toISOString()
                          : r.published_at as string,
  }))
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = { _isDuplicate, _recentEvents }
