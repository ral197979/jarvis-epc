/**
 * Denver Engineering — Notification Queue (v4.34.0)
 * ────────────────────────────────────────────────────
 * Ava Phase 2E — Durable, dedup-safe notification enqueueing.
 *
 * Enqueues notifications into notification_jobs with:
 *   - Deduplication key: prevents duplicate delivery for same event
 *   - Exponential backoff scheduling (handled by notificationWorker)
 *   - Channel-agnostic: in_app | email | webhook | slack
 *
 * Does NOT send notifications directly — all delivery happens in
 * notificationWorker.ts to keep request handlers non-blocking.
 */

import { query } from '../../db/pool'
import { slog } from '../../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationChannel = 'in_app' | 'email' | 'webhook' | 'slack'

export interface EnqueueNotificationInput {
  tenantId:        string
  channel:         NotificationChannel
  templateKey:     string             // e.g. 'action.escalated.level1'
  recipientIds:    string[]           // user UUIDs
  recipientEmails: string[]           // for email channel
  payload:         Record<string, unknown>
  dedupKey?:       string | null      // null = no dedup
  actionId?:       string | null
  eventType?:      string | null
  runAfter?:       Date               // delay delivery (default: now)
  maxAttempts?:    number             // default 5
}

export interface NotificationJob {
  id:              string
  tenant_id:       string
  channel:         NotificationChannel
  template_key:    string
  recipient_ids:   string[]
  payload:         Record<string, unknown>
  status:          'pending' | 'processing' | 'delivered' | 'failed' | 'dead'
  attempts:        number
  max_attempts:    number
  run_after:       string
  created_at:      string
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * Enqueue a notification. Idempotent when dedupKey is provided:
 * if a pending/processing job with the same dedup key already exists,
 * silently returns without inserting a duplicate.
 */
export async function enqueueNotification(
  input: EnqueueNotificationInput,
): Promise<string | null> {
  try {
    const result = await query<{ id: string }>(`
      INSERT INTO notification_jobs (
        tenant_id, channel, template_key,
        recipient_ids, recipient_emails, payload,
        dedup_key, action_id, event_type,
        run_after, max_attempts
      ) VALUES (
        $1, $2, $3,
        $4::jsonb, $5::jsonb, $6::jsonb,
        $7, $8, $9,
        COALESCE($10::timestamptz, NOW()), $11
      )
      ON CONFLICT (tenant_id, dedup_key)
        WHERE dedup_key IS NOT NULL
        AND   status NOT IN ('delivered','dead')
      DO NOTHING
      RETURNING id
    `, [
      input.tenantId,
      input.channel,
      input.templateKey,
      JSON.stringify(input.recipientIds),
      JSON.stringify(input.recipientEmails),
      JSON.stringify(input.payload),
      input.dedupKey       ?? null,
      input.actionId       ?? null,
      input.eventType      ?? null,
      input.runAfter?.toISOString() ?? null,
      input.maxAttempts    ?? 5,
    ])

    const id = result.rows[0]?.id ?? null

    if (id) {
      slog('INFO', 'notificationQueue', '[enqueue]', {
        jobId: id, channel: input.channel, templateKey: input.templateKey,
        recipients: input.recipientIds.length, dedupKey: input.dedupKey,
      })
    }

    return id

  } catch (err) {
    slog('ERROR', 'notificationQueue', '[enqueue] Failed', {
      error: String(err), templateKey: input.templateKey,
    })
    return null
  }
}

/**
 * Convenience: enqueue the same notification on multiple channels at once.
 * Returns array of job IDs (null entries = dedup skip or error).
 */
export async function enqueueMultiChannel(
  base: Omit<EnqueueNotificationInput, 'channel'>,
  channels: NotificationChannel[],
): Promise<(string | null)[]> {
  return Promise.all(
    channels.map(ch => enqueueNotification({ ...base, channel: ch,
      dedupKey: base.dedupKey ? `${base.dedupKey}:${ch}` : null,
    }))
  )
}

// ─── Escalation notification helper ──────────────────────────────────────────

/**
 * Enqueue escalation notifications for all configured channels.
 * dedupKey: 'action:{id}:escalation:{level}:{channel}' — prevents
 * re-delivery if the SLA engine fires twice for the same level.
 */
export async function enqueueEscalationNotification(opts: {
  tenantId:      string
  actionId:      string
  actionTitle:   string
  level:         number
  notifyRole:    string
  recipientIds:  string[]
  hoursOverdue:  number
}): Promise<void> {
  const payload = {
    action_id:    opts.actionId,
    action_title: opts.actionTitle,
    level:        opts.level,
    notify_role:  opts.notifyRole,
    hours_overdue: opts.hoursOverdue,
  }

  await enqueueMultiChannel(
    {
      tenantId:        opts.tenantId,
      templateKey:     `action.escalated.level${opts.level}`,
      recipientIds:    opts.recipientIds,
      recipientEmails: [],
      payload,
      actionId:        opts.actionId,
      eventType:       'action.escalated',
      dedupKey:        `action:${opts.actionId}:escalation:${opts.level}`,
    },
    ['in_app', 'email'],
  )
}
