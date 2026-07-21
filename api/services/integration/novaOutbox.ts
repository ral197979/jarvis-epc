/**
 * Denver Engineering — Nova transactional outbox (ADR-001, v1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Durable Denver → Nova event delivery. Producers insert nova_outbox rows —
 * inside the SAME transaction as the state change where one exists — and the
 * worker drains due rows, POSTing HMAC-signed envelopes to Nova's ingestion
 * endpoint with the connector-framework backoff ladder [30s, 60s, 5m, 15m, 1h]
 * and dead-letter after 6 attempts. This deliberately does NOT reuse
 * dispatchWebhookEvent's in-process setTimeout retry (lost on restart).
 *
 * Envelope shape is the frozen contract (docs/integration/nova-denver/
 * contracts/v1/progress-event.schema.json / turnover-event.schema.json).
 * `sequence` is the outbox row's monotonic seq — Nova's stale guard orders on
 * (occurredAt, sequence).
 *
 * Scheduling mirrors integrationSync.ts: a promoter (throttled to ~30s) scans
 * for tenants with due rows and enqueues one 'nova_outbox_drain' background job
 * per tenant; the handler claims rows with FOR UPDATE SKIP LOCKED.
 */
import { createHmac } from 'node:crypto'
import type { PoolClient } from 'pg'
import { query, pool } from '../../db/pool'
import { registerHandler, registerPromoter, enqueue, type BackgroundJob } from '../scheduler'
import {
  isNovaExternalEnabled,
  isNovaEventDeliveryConfigured,
  novaBaseUrl,
  novaWebhookSecret,
  novaTimeoutMs,
} from './novaConfig'
import { slog } from '../../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export type NovaEventType =
  | 'denver.project.created'
  | 'denver.project.progress.updated'
  | 'denver.turnover.package.updated'
  | 'denver.integration.test'

/** Context stored in nova_outbox.payload; envelope is composed at drain time. */
export interface NovaEventPayload {
  connectionId:    string
  novaTenantId:    string
  novaProjectId:   string
  denverProjectId: string
  summary?:        Record<string, unknown>
  package?:        Record<string, unknown>
}

export interface OutboxRow {
  id:              string
  seq:             string | number
  tenant_id:       string
  event_id:        string
  event_type:      string
  payload:         NovaEventPayload
  attempts:        number
  correlation_id:  string | null
  created_at:      Date | string
}

/** Discriminated result: callers branch on `enabled` (commissioningGateway style). */
export type EnqueueResult = { enabled: true; outboxId: string } | { enabled: false }

// ─── Backoff (pure) ───────────────────────────────────────────────────────────

/** Connector-framework ladder (connectorFramework.ts): 30s, 60s, 5m, 15m, 1h. */
export const BACKOFF_LADDER_MS = [30_000, 60_000, 300_000, 900_000, 3_600_000] as const

export const MAX_ATTEMPTS = 6

/**
 * Pure: delay before the next attempt, given how many attempts have now been
 * made. Attempt 1 → 30s, 2 → 60s, 3 → 5m, 4 → 15m, 5+ → 1h.
 */
export function nextAttemptDelayMs(attemptsMade: number): number {
  const idx = Math.min(Math.max(attemptsMade - 1, 0), BACKOFF_LADDER_MS.length - 1)
  return BACKOFF_LADDER_MS[idx]!
}

/** Pure: disposition after a failed delivery attempt. */
export function failureDisposition(attemptsMade: number): { status: 'queued' | 'dead'; delayMs: number | null } {
  if (attemptsMade >= MAX_ATTEMPTS) return { status: 'dead', delayMs: null }
  return { status: 'queued', delayMs: nextAttemptDelayMs(attemptsMade) }
}

// ─── Envelope (pure) ──────────────────────────────────────────────────────────

/**
 * Pure: compose the contract event envelope from an outbox row. Fields the
 * producer omitted stay omitted (honesty rule — never zero-filled).
 */
export function buildEventEnvelope(row: {
  event_id: string
  seq: string | number
  event_type: string
  payload: NovaEventPayload
  correlation_id?: string | null
  created_at: Date | string
}): Record<string, unknown> {
  const occurredAt = row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString()
  const envelope: Record<string, unknown> = {
    schemaVersion:   '1.0',
    eventId:         row.event_id,
    eventType:       row.event_type,
    occurredAt,
    connectionId:    row.payload.connectionId,
    novaTenantId:    row.payload.novaTenantId,
    novaProjectId:   row.payload.novaProjectId,
    denverProjectId: row.payload.denverProjectId,
    sequence:        Number(row.seq),
  }
  if (row.correlation_id) envelope['correlationId'] = row.correlation_id
  if (row.payload.summary !== undefined) envelope['summary'] = row.payload.summary
  if (row.payload.package !== undefined) envelope['package'] = row.payload.package
  return envelope
}

// ─── Producers ────────────────────────────────────────────────────────────────

/**
 * Insert an outbox row on an existing transaction client — used when the event
 * must be atomic with the state change it describes (e.g. project.create).
 */
export async function insertOutboxEvent(
  client: PoolClient,
  tenantId: string,
  eventType: NovaEventType,
  payload: NovaEventPayload,
  correlationId?: string,
): Promise<string> {
  const res = await client.query<{ id: string }>(`
    INSERT INTO nova_outbox (tenant_id, event_type, payload, correlation_id)
    VALUES ($1, $2, $3::jsonb, $4)
    RETURNING id
  `, [tenantId, eventType, JSON.stringify(payload), correlationId ?? null])
  return res.rows[0]!.id
}

/**
 * Enqueue a Denver → Nova event for durable delivery. NO-OP returning
 * { enabled:false } when NOVA_EXTERNAL is off (commissioningGateway pattern).
 */
export async function enqueueNovaEvent(
  tenantId: string,
  eventType: NovaEventType,
  payload: NovaEventPayload,
  correlationId?: string,
): Promise<EnqueueResult> {
  if (!isNovaExternalEnabled()) return { enabled: false }
  const res = await query<{ id: string }>(`
    INSERT INTO nova_outbox (tenant_id, event_type, payload, correlation_id)
    VALUES ($1, $2, $3::jsonb, $4)
    RETURNING id
  `, [tenantId, eventType, JSON.stringify(payload), correlationId ?? null])
  return { enabled: true, outboxId: res.rows[0]!.id }
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

async function _deliver(row: OutboxRow): Promise<void> {
  const body = JSON.stringify(buildEventEnvelope(row))
  const timestamp = String(Math.floor(Date.now() / 1000))
  const signature = `v1=${createHmac('sha256', novaWebhookSecret()).update(`${timestamp}.${body}`).digest('hex')}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), novaTimeoutMs())
  try {
    const res = await fetch(`${novaBaseUrl()}/api/integrations/denver/events`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':       'application/json',
        'X-Denver-Delivery':  row.event_id,
        'X-Denver-Timestamp': timestamp,
        'X-Denver-Signature': signature,
      },
      body,
    })
    if (!res.ok) throw new Error(`nova events POST → ${res.status}`)
  } finally {
    clearTimeout(timer)
  }
}

async function _audit(tenantId: string, resource: string, resourceId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await query(`
      INSERT INTO audit_log (tenant_id, user_id, action, resource, resource_id, new_data)
      VALUES ($1, NULL, 'integrate_push', $2, $3, $4::jsonb)
    `, [tenantId, resource, resourceId, JSON.stringify(data)])
  } catch (err) {
    slog('ERROR', 'novaOutbox', '[audit] write failed', {
      tenantId, resource, message: err instanceof Error ? err.message : String(err),
    })
  }
}

// ─── Drain job ────────────────────────────────────────────────────────────────

const DRAIN_BATCH = 20
// Reclaim rows stuck 'delivering' (worker crash mid-delivery) after 10 min.
const DELIVERING_STALE_MS = 10 * 60_000

/** Claim due rows for one tenant with FOR UPDATE SKIP LOCKED. */
async function _claimDueRows(tenantId: string): Promise<OutboxRow[]> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const res = await client.query<OutboxRow>(`
      UPDATE nova_outbox
      SET    status = 'delivering', updated_at = NOW()
      WHERE  id IN (
        SELECT id FROM nova_outbox
        WHERE  tenant_id = $1
          AND  ((status = 'queued' AND next_attempt_at <= NOW())
                OR (status = 'delivering' AND updated_at < NOW() - INTERVAL '${DELIVERING_STALE_MS} milliseconds'))
        ORDER BY seq ASC
        LIMIT  ${DRAIN_BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, seq, tenant_id, event_id, event_type, payload, attempts, correlation_id, created_at
    `, [tenantId])
    await client.query('COMMIT')
    return res.rows
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* ignore */ }
    throw err
  } finally {
    client.release()
  }
}

async function _handleDrainJob(job: BackgroundJob): Promise<Record<string, unknown>> {
  if (!isNovaEventDeliveryConfigured()) {
    // Flag/base URL/secret withdrawn after enqueue — leave rows queued (fail closed).
    return { skipped: true, reason: 'nova event delivery not configured' }
  }

  const rows = await _claimDueRows(job.tenant_id)
  let delivered = 0, failed = 0, dead = 0

  for (const row of rows) {
    try {
      await _deliver(row)
      await query(`
        UPDATE nova_outbox
        SET status = 'delivered', delivered_at = NOW(), last_error = NULL, updated_at = NOW()
        WHERE id = $1
      `, [row.id])
      delivered++
      await _audit(row.tenant_id, 'nova_event_delivered', row.id, {
        eventType: row.event_type, eventId: row.event_id, attempts: row.attempts + 1,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const attemptsMade = row.attempts + 1
      const disposition = failureDisposition(attemptsMade)
      await query(`
        UPDATE nova_outbox
        SET status = $1, attempts = $2, last_error = $3,
            next_attempt_at = NOW() + ($4 || ' milliseconds')::INTERVAL,
            updated_at = NOW()
        WHERE id = $5
      `, [disposition.status, attemptsMade, message.slice(0, 1000), String(disposition.delayMs ?? 0), row.id])
      if (disposition.status === 'dead') {
        dead++
        await _audit(row.tenant_id, 'nova_event_dead', row.id, {
          eventType: row.event_type, eventId: row.event_id, attempts: attemptsMade, lastError: message.slice(0, 300),
        })
        slog('ERROR', 'novaOutbox', '[drain] event dead-lettered', {
          tenantId: row.tenant_id, outboxId: row.id, eventType: row.event_type, attempts: attemptsMade,
        })
      } else {
        failed++
        slog('WARN', 'novaOutbox', '[drain] delivery failed — will retry', {
          tenantId: row.tenant_id, outboxId: row.id, eventType: row.event_type, attempts: attemptsMade, message,
        })
      }
    }
  }

  return { claimed: rows.length, delivered, failed, dead }
}

// ─── Promoter: enqueue one drain job per tenant with due rows ─────────────────

const SCAN_MIN_INTERVAL_MS = Number(process.env['NOVA_OUTBOX_SCAN_INTERVAL_MS'] ?? '30000')
let _lastScanAt = 0

async function _promoteDueOutbox(): Promise<void> {
  if (!isNovaExternalEnabled()) return
  const now = Date.now()
  if (now - _lastScanAt < SCAN_MIN_INTERVAL_MS) return
  _lastScanAt = now

  // One drain job per tenant with due rows; skip tenants that already have a
  // queued/running drain job so the queue never piles up.
  const due = await query<{ tenant_id: string }>(`
    SELECT DISTINCT o.tenant_id
    FROM nova_outbox o
    WHERE o.status = 'queued' AND o.next_attempt_at <= NOW()
      AND NOT EXISTS (
        SELECT 1 FROM background_jobs bj
        WHERE bj.tenant_id = o.tenant_id
          AND bj.job_type = 'nova_outbox_drain'
          AND bj.status IN ('queued', 'running')
      )
    LIMIT 50
  `)
  for (const row of due.rows) {
    await enqueue(row.tenant_id, 'nova_outbox_drain', {})
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

/** Call once at boot from api/worker.ts, after startScheduler(). */
export function registerNovaOutboxHandler(): void {
  registerHandler('nova_outbox_drain', _handleDrainJob)
  registerPromoter(_promoteDueOutbox)
  slog('INFO', 'novaOutbox', '[boot] Registered handler + promoter')
}
