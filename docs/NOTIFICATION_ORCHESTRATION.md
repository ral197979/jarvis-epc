# Notification Orchestration Engine

**Ava Phase 2 | Denver Engineering v4.34.0**

---

## Overview

The Notification Orchestration Engine provides a persistent, retryable, deduplicated message queue for delivering action-related notifications across multiple channels. It is fully decoupled from request handlers — notifications are enqueued synchronously but delivered asynchronously by a background worker.

---

## Database Schema

### `notification_jobs`

The primary work queue:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Owning tenant |
| `action_id` | UUID | Associated action (nullable) |
| `channel` | VARCHAR | `in_app`, `email`, `webhook`, `slack` |
| `recipient_id` | UUID | Target user or endpoint |
| `payload` | JSONB | Channel-specific message content |
| `dedup_key` | VARCHAR | Idempotency key (nullable) |
| `status` | VARCHAR | `pending`, `processing`, `delivered`, `failed`, `dead` |
| `attempts` | INTEGER | Delivery attempt count |
| `max_attempts` | INTEGER | Ceiling before dead-lettering (default: 5) |
| `run_after` | TIMESTAMPTZ | Earliest time to attempt delivery (backoff scheduling) |
| `locked_until` | TIMESTAMPTZ | Worker lease expiry (distributed locking) |
| `locked_by` | VARCHAR | Worker instance ID |
| `last_error` | TEXT | Error message from most recent failed attempt |
| `created_at` | TIMESTAMPTZ | |
| `delivered_at` | TIMESTAMPTZ | When successfully delivered |

**Deduplication index:**
```sql
CREATE UNIQUE INDEX notification_jobs_dedup_key_uidx
  ON notification_jobs (tenant_id, dedup_key)
  WHERE dedup_key IS NOT NULL
    AND status NOT IN ('delivered', 'dead');
```

This prevents re-enqueue of the same logical notification while a pending or failed delivery is in flight, but allows re-enqueue after a job is delivered or dead-lettered.

### `notification_delivery_attempts`

Append-only log of each delivery attempt:

| Column | Description |
|--------|-------------|
| `job_id` | FK to notification_jobs |
| `attempt_number` | Sequential attempt index |
| `attempted_at` | When the attempt ran |
| `success` | Boolean outcome |
| `error_message` | Failure reason if unsuccessful |
| `duration_ms` | How long delivery took |

### `notification_dead_letters`

Exhausted jobs moved here after exceeding `max_attempts`:

| Column | Description |
|--------|-------------|
| `original_job_id` | FK to the failed notification_jobs row |
| `dead_at` | When the job was dead-lettered |
| `failure_reason` | Summary of terminal failure |
| `replay_job_id` | UUID of re-enqueued job (if manually replayed) |

---

## Notification Queue API

### `enqueueNotification(input)`

Enqueues a single notification job. Returns the new job ID, or `null` if deduplicated (no-op).

```typescript
await enqueueNotification({
  tenantId:    'tenant-uuid',
  actionId:    'action-uuid',
  channel:     'email',
  recipientId: 'user-uuid',
  payload:     { subject: 'Action overdue', body: '...' },
  dedupKey:    'action:abc:overdue:email',   // optional
  maxAttempts: 5,
  runAfter:    new Date(),
})
```

### `enqueueMultiChannel(base, channels)`

Enqueues the same notification across multiple channels in a single call. Dedup keys are channel-scoped (`${baseDedupKey}:${channel}`) to prevent cross-channel collisions while still deduplicating per channel:

```typescript
await enqueueMultiChannel(
  { tenantId, actionId, recipientId, payload, dedupKey: 'action:abc:escalated' },
  ['in_app', 'email']
)
// Creates dedup keys: 'action:abc:escalated:in_app', 'action:abc:escalated:email'
```

### `enqueueEscalationNotification(opts)`

Convenience wrapper for escalation events. Enqueues `in_app` + `email` channels with a pre-formatted escalation payload:

```typescript
await enqueueEscalationNotification({
  tenantId,
  actionId,
  actionTitle,
  escalationLevel,
  assigneeId,
  dedupKey: `action:${actionId}:escalated:l${escalationLevel}`,
})
```

---

## Notification Worker

### Claim Pattern

The worker uses `FOR UPDATE SKIP LOCKED` to claim a batch of jobs without blocking other worker instances:

```sql
UPDATE notification_jobs
SET status = 'processing',
    locked_until = NOW() + INTERVAL '5 minutes',
    locked_by    = $worker_id
WHERE id IN (
  SELECT id FROM notification_jobs
  WHERE status IN ('pending', 'failed')
    AND run_after <= NOW()
    AND (locked_until IS NULL OR locked_until < NOW())
  ORDER BY run_after
  LIMIT 10
  FOR UPDATE SKIP LOCKED
)
RETURNING *
```

### Backoff Algorithm

Failed jobs are rescheduled using exponential backoff with ±30-second jitter:

```
next_run_after = NOW() + min(BASE_BACKOFF_SECS × 2^attempts, MAX_BACKOFF_SECS) + jitter

Constants:
  BASE_BACKOFF_SECS = 30
  MAX_BACKOFF_SECS  = 3600  (1 hour)
  JITTER_RANGE      = ±30s
```

| Attempt | Base delay | Max with jitter |
|---------|-----------|-----------------|
| 1 | 30s | 60s |
| 2 | 60s | 90s |
| 3 | 120s | 150s |
| 4 | 240s | 270s |
| 5 (final) | 480s | 510s → dead letter |

### Dead Letter Flow

When `attempts >= max_attempts`:
1. Update `notification_jobs.status = 'dead'`
2. Insert into `notification_dead_letters` with failure reason
3. Publish `notification_dead_lettered` metric (future: alert)

Dead-lettered jobs can be manually replayed by re-enqueueing and recording the new `replay_job_id` on the dead letter row.

### Channel Dispatch

The worker dispatches to channel-specific delivery functions:

| Channel | Delivery mechanism |
|---------|-------------------|
| `in_app` | INSERT into `in_app_notifications` (or equivalent table) |
| `email` | SMTP / transactional email provider (SendGrid, Postmark, etc.) |
| `webhook` | HTTP POST to registered tenant webhook URL |
| `slack` | Slack Incoming Webhook or Bot API |

Unknown channels return `{ success: false, error: 'unknown_channel:<channel>' }` and cause the job to be dead-lettered immediately without retrying.

---

## Worker Registration

```typescript
// In server.ts startup:
registerNotificationWorker()

// Internally calls:
registerPromoter(_scanNotificationJobs)
// _scanNotificationJobs runs every 30 seconds
```

---

## Deduplication Logic

The partial unique index on `(tenant_id, dedup_key) WHERE dedup_key IS NOT NULL AND status NOT IN ('delivered', 'dead')` provides at-most-once delivery semantics for keyed notifications:

| Scenario | Outcome |
|----------|---------|
| Enqueue with new dedup_key | INSERT succeeds, job created |
| Enqueue same key while job is `pending` | INSERT skipped (ON CONFLICT DO NOTHING), returns `null` |
| Enqueue same key while job is `failed` | INSERT skipped (still active) |
| Enqueue same key after job is `delivered` | INSERT succeeds (new job created — re-delivery allowed) |
| Enqueue same key after job is `dead` | INSERT succeeds (retry explicitly allowed) |

---

## Sequence: Escalation → Notification

```
SLA Engine tick
  └── _fireNextEscalation(action)
        ├── UPDATE actions.escalation_level = N
        ├── publishActionEvent('escalated', { level: N })
        └── enqueueEscalationNotification({
              actionId, assigneeId, escalationLevel: N,
              dedupKey: `action:${id}:escalated:l${N}`
            })
              ├── enqueueMultiChannel(base, ['in_app', 'email'])
              │     ├── INSERT notification_jobs (in_app)  ← dedup: ...l2:in_app
              │     └── INSERT notification_jobs (email)   ← dedup: ...l2:email
              └── Returns

Notification Worker tick (30s later)
  └── Claim batch (SKIP LOCKED)
        ├── Process in_app job → INSERT in_app_notifications → status='delivered'
        └── Process email job → SMTP send → status='delivered'
```

---

## Limitations

- Webhook and Slack channel delivery functions are stubs in Phase 2. They accept and claim jobs but require integration with external services to be implemented in Phase 3.
- There is no webhook signature verification in Phase 2. Phase 3 should add HMAC signing for outbound webhook payloads.
- The worker runs as a single `setInterval` promoter. High-volume tenants may require dedicated worker processes with configurable concurrency in Phase 3.
- No dead-letter alerting in Phase 2. Monitoring dead letter growth requires direct DB queries or an admin dashboard widget (Phase 3).
