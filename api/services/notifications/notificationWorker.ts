/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Denver Engineering — Notification Worker (v4.34.0)
 * ────────────────────────────────────────────────────
 * Ava Phase 2E — Background worker that polls notification_jobs,
 * attempts delivery, applies exponential backoff, and routes
 * exhausted jobs to notification_dead_letters.
 *
 * Registered as a promoter (same pattern as slaEngine, complianceWatcher).
 * Polls on every scheduler tick. FOR UPDATE SKIP LOCKED for concurrent safety.
 *
 * Delivery stubs:
 *   - in_app:  stub (Phase 2 Sprint 4 — in-app notification store)
 *   - email:   stub (Phase 2 Sprint 4 — SES/SendGrid integration)
 *   - webhook: delegates to webhookDispatch emitEvent
 *   - slack:   stub (Phase 2 Sprint 5 — Slack SDK)
 */

import { query } from '../../db/pool'
import { registerPromoter } from '../scheduler'
import { slog } from '../../../src/modules/observability/index'

// ─── Config ───────────────────────────────────────────────────────────────────

const BATCH_SIZE         = Number(process.env['NOTIF_WORKER_BATCH'] ?? '20')
const MAX_LOCK_SECS      = 120
const BASE_BACKOFF_SECS  = 60      // base for exponential backoff
const MAX_BACKOFF_SECS   = 3600    // cap at 1 hour

// ─── Types ────────────────────────────────────────────────────────────────────

interface NotifJobRow {
  id:              string
  tenant_id:       string
  channel:         string
  template_key:    string
  recipient_ids:   string[]
  recipient_emails: string[]
  payload:         Record<string, unknown>
  attempts:        number
  max_attempts:    number
  action_id:       string | null
  event_type:      string | null
}

type DeliveryResult = { success: boolean; responseCode?: number; error?: string; durationMs: number }

// ─── Delivery stubs ───────────────────────────────────────────────────────────

async function _deliverInApp(job: NotifJobRow): Promise<DeliveryResult> {
  // TODO Phase 2 Sprint 4: write to user_notifications table / push via SSE
  slog('INFO', 'notificationWorker', '[in_app] stub delivery', {
    jobId: job.id, recipients: job.recipient_ids.length,
  })
  return { success: true, responseCode: 200, durationMs: 0 }
}

async function _deliverEmail(job: NotifJobRow): Promise<DeliveryResult> {
  // TODO Phase 2 Sprint 4: SES / SendGrid integration
  slog('INFO', 'notificationWorker', '[email] stub delivery', {
    jobId: job.id, emails: job.recipient_emails.length,
  })
  return { success: true, responseCode: 200, durationMs: 0 }
}

async function _deliverWebhook(job: NotifJobRow): Promise<DeliveryResult> {
  // TODO Phase 2 Sprint 4: route through webhookDispatch
  slog('INFO', 'notificationWorker', '[webhook] stub delivery', { jobId: job.id })
  return { success: true, responseCode: 200, durationMs: 0 }
}

async function _deliverSlack(job: NotifJobRow): Promise<DeliveryResult> {
  // TODO Phase 2 Sprint 5: Slack SDK integration
  slog('INFO', 'notificationWorker', '[slack] stub delivery', { jobId: job.id })
  return { success: true, responseCode: 200, durationMs: 0 }
}

async function _deliver(job: NotifJobRow): Promise<DeliveryResult> {
  switch (job.channel) {
    case 'in_app':  return _deliverInApp(job)
    case 'email':   return _deliverEmail(job)
    case 'webhook': return _deliverWebhook(job)
    case 'slack':   return _deliverSlack(job)
    default:
      return { success: false, error: `unknown_channel:${job.channel}`, durationMs: 0 }
  }
}

// ─── Backoff calculation ──────────────────────────────────────────────────────

function _nextRunAfter(attempts: number): Date {
  const backoffSecs = Math.min(
    BASE_BACKOFF_SECS * Math.pow(2, attempts),
    MAX_BACKOFF_SECS,
  )
  const jitter = Math.floor(Math.random() * 30)  // ±30s jitter
  const d = new Date()
  d.setSeconds(d.getSeconds() + backoffSecs + jitter)
  return d
}

// ─── Process one job ──────────────────────────────────────────────────────────

async function _processJob(job: NotifJobRow, workerId: string): Promise<void> {
  const start = Date.now()
  let result: DeliveryResult

  try {
    result = await _deliver(job)
  } catch (err) {
    result = { success: false, error: String(err), durationMs: Date.now() - start }
  }

  const newAttempts = job.attempts + 1
  const durationMs  = Date.now() - start

  // Record attempt (append-only)
  await query(`
    INSERT INTO notification_delivery_attempts
      (tenant_id, job_id, attempt_number, channel, success, response_code, error_message, duration_ms)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    job.tenant_id, job.id, newAttempts, job.channel,
    result.success, result.responseCode ?? null, result.error ?? null, durationMs,
  ])

  if (result.success) {
    // Mark delivered
    await query(`
      UPDATE notification_jobs
      SET status = 'delivered', attempts = $2, delivered_at = NOW(),
          locked_until = NULL, locked_by = NULL, updated_at = NOW()
      WHERE id = $1
    `, [job.id, newAttempts])

  } else if (newAttempts >= job.max_attempts) {
    // Exhausted — move to dead letter
    await query(`
      UPDATE notification_jobs
      SET status = 'dead', attempts = $2, last_error = $3,
          locked_until = NULL, locked_by = NULL, updated_at = NOW()
      WHERE id = $1
    `, [job.id, newAttempts, result.error ?? 'unknown'])

    await query(`
      INSERT INTO notification_dead_letters
        (tenant_id, job_id, original_payload, failure_reason, total_attempts, last_attempted_at)
      VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
    `, [
      job.tenant_id, job.id,
      JSON.stringify(job.payload), result.error ?? 'max_attempts_reached', newAttempts,
    ])

    slog('WARN', 'notificationWorker', '[dead-letter] Job exhausted', {
      jobId: job.id, channel: job.channel, attempts: newAttempts,
    })

  } else {
    // Retry with backoff
    const nextRun = _nextRunAfter(newAttempts)
    await query(`
      UPDATE notification_jobs
      SET status = 'failed', attempts = $2, last_error = $3,
          run_after = $4, locked_until = NULL, locked_by = NULL, updated_at = NOW()
      WHERE id = $1
    `, [job.id, newAttempts, result.error ?? 'delivery_failed', nextRun.toISOString()])
  }
}

// ─── Main scan ────────────────────────────────────────────────────────────────

async function _scanNotificationJobs(): Promise<void> {
  const workerId = `notif:${process.pid}`

  // Claim a batch of ready jobs
  const claimed = await query<NotifJobRow>(`
    UPDATE notification_jobs
    SET    status       = 'processing',
           locked_until = NOW() + INTERVAL '${MAX_LOCK_SECS} seconds',
           locked_by    = $2,
           updated_at   = NOW()
    WHERE  id IN (
      SELECT id FROM notification_jobs
      WHERE  status IN ('pending','failed')
        AND  run_after <= NOW()
        AND  (locked_until IS NULL OR locked_until < NOW())
      ORDER BY run_after ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `, [BATCH_SIZE, workerId])

  if (claimed.rows.length === 0) return

  for (const job of claimed.rows) {
    await _processJob(job, workerId)
  }

  slog('INFO', 'notificationWorker', '[scan] Processed batch', { count: claimed.rows.length })
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerNotificationWorker(): void {
  registerPromoter(_scanNotificationJobs)
  slog('INFO', 'notificationWorker', '[boot] Registered notification worker')
}

/** Test-only */
export const __testHooks = {
  processJob:    _processJob,
  nextRunAfter:  _nextRunAfter,
  deliver:       _deliver,
}
