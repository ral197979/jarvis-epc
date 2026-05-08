/**
 * JARVIS EPC — Webhook Dispatch Handler
 * ──────────────────────────────────────────
 * v4.31.0 | Durable, retryable webhook emission on top of the scheduler.
 *
 * Two pieces:
 *   1. registerWebhookDispatchHandler() — binds the 'webhook_dispatch'
 *      job_type to the existing dispatchWebhookEvent() dispatcher in
 *      routes/integrations.ts. Call once at boot.
 *
 *   2. emitEvent(tenantId, eventType, payload) — the recommended
 *      way for routes, middleware, or workers to signal domain
 *      events. Inserts one row into background_jobs and returns
 *      immediately; actual HTTP delivery happens on the scheduler tick.
 *
 * Why route events through the queue instead of calling dispatch directly?
 *   - Survives restart: a pending job resumes on the next scheduler instance
 *   - Non-blocking: request latency doesn't include webhook HTTP round-trips
 *   - Observable: background_jobs table shows exactly what fired and when
 *   - Retryable: exponential backoff handled by the scheduler
 *
 * Event naming convention:
 *   `<resource>.<action>` e.g. 'projects.create', 'rfis.update', 'auth.login'
 *   Subscribers store this string in webhooks.events[] (TEXT[]).
 */

import {
  registerHandler,
  enqueue,
  type BackgroundJob,
  type EnqueueOptions,
} from './scheduler'
import { dispatchWebhookEvent } from '../routes/integrations'
import { slog } from '../../src/modules/observability/index'

interface WebhookDispatchPayload {
  eventType: string
  payload:   Record<string, unknown>
}

/**
 * Register the 'webhook_dispatch' handler with the scheduler.
 * Idempotent — safe to call more than once (re-registration overwrites).
 */
export function registerWebhookDispatchHandler(): void {
  registerHandler('webhook_dispatch', async (job: BackgroundJob) => {
    const { eventType, payload } = job.payload_json as unknown as WebhookDispatchPayload
    if (!eventType) throw new Error('webhook_dispatch payload missing eventType')
    await dispatchWebhookEvent(job.tenant_id, eventType, payload ?? {})
    return { eventType, dispatched: true }
  })
}

/**
 * Enqueue a webhook event for durable, retryable delivery.
 *
 * Errors are logged but never thrown — event emission must not
 * break the primary request path. If the DB is unavailable, the
 * request still succeeds; the event is simply lost (observable
 * via the error log).
 */
export async function emitEvent(
  tenantId:  string,
  eventType: string,
  payload:   Record<string, unknown> = {},
  opts?:     EnqueueOptions,
): Promise<void> {
  try {
    await enqueue(tenantId, 'webhook_dispatch', { eventType, payload }, opts)
  } catch (err) {
    slog('ERROR', 'webhooks', '[emit] Failed to enqueue webhook event', {
      tenantId, eventType,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
