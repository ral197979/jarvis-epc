# Action Event Stream

**Ava Phase 2 | Denver Engineering v4.34.0**

---

## Overview

The Action Event Stream is an immutable, append-only audit log of every meaningful state change to an action. It enables full timeline reconstruction, compliance auditing, and — in Phase 3 — ML feature extraction. Immutability is enforced at the PostgreSQL rule level, not just the application layer.

---

## Database Schema

### `action_event_type` ENUM

```sql
CREATE TYPE action_event_type AS ENUM (
  'created', 'assigned', 'delegated', 'reassigned',
  'escalated', 'commented', 'blocked', 'unblocked',
  'status_changed', 'priority_changed', 'resolved',
  'reopened', 'cancelled', 'sla_paused', 'sla_resumed',
  'relation_added', 'relation_removed'
);
```

17 event types covering the full action lifecycle.

### `action_events`

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Owning tenant |
| `action_id` | UUID | FK to actions |
| `event_type` | `action_event_type` | Enum value |
| `actor_id` | UUID | User or worker ID (nullable for system events) |
| `actor_type` | VARCHAR | `user`, `system`, `worker`, `api` |
| `actor_label` | VARCHAR | Human-readable actor name (denormalized for display) |
| `before_snapshot` | JSONB | Action fields before the change (nullable) |
| `after_snapshot` | JSONB | Action fields after the change (nullable) |
| `metadata` | JSONB | Event-specific extras (level, relation_type, etc.) |
| `correlation_id` | VARCHAR | Tracing ID threaded from request header |
| `occurred_at` | TIMESTAMPTZ | Event time (defaults to `NOW()`) |

**Indexes:**
- `(tenant_id, action_id, occurred_at DESC)` — timeline queries
- `(tenant_id, event_type, occurred_at DESC)` — event-type filtering
- `(correlation_id)` WHERE NOT NULL — distributed trace lookups

### Immutability Rules

```sql
CREATE RULE action_events_no_update AS
  ON UPDATE TO action_events DO INSTEAD NOTHING;

CREATE RULE action_events_no_delete AS
  ON DELETE TO action_events DO INSTEAD NOTHING;
```

These rules intercept UPDATE and DELETE statements at the PostgreSQL rule rewrite level — they succeed silently (no error, no rows affected) rather than raising an exception. This means misconfigured application code that attempts to update or delete events will silently no-op rather than erroring in production.

**Note:** `TRUNCATE` is not covered by these rules. Access to `TRUNCATE` on `action_events` must be restricted via PostgreSQL GRANT controls (the table owner should not be the application role).

---

## Event Publisher API

### `publishEvent(input)`

Async, throws on DB error (use for critical paths where you need to know if publication succeeded):

```typescript
await publishEvent({
  tenantId:       'tenant-uuid',
  actionId:       'action-uuid',
  eventType:      'status_changed',
  actorId:        'user-uuid',
  actorType:      'user',
  actorLabel:     'Alice Smith',
  beforeSnapshot: { status: 'open' },
  afterSnapshot:  { status: 'in_progress' },
  metadata:       {},
  correlationId:  req.correlationId,
})
```

### `publishActionEvent()` (fire-and-forget)

The preferred call pattern for most use cases. Never throws — errors are swallowed internally:

```typescript
publishActionEvent(tenantId, actionId, 'escalated', actorId, { level: 2 }, { correlationId })
// void prefix — caller does not await
```

### `getActionTimeline(tenantId, actionId, limit, beforeDate?)`

Returns events in reverse chronological order (most recent first):

```typescript
const events = await getActionTimeline(tenantId, actionId, 50)
// Returns: ActionEvent[]
```

Supports cursor-based pagination via `beforeDate` — pass the `occurred_at` of the last event received to fetch the next page.

---

## Event Emission Map

| Trigger | Event type | Actor type | Before/After |
|---------|-----------|------------|--------------|
| `createAction()` | `created` | `api` | — / full action snapshot |
| Status update route | `status_changed` | `user` | `{status}` / `{status}` |
| Priority update route | `priority_changed` | `user` | `{priority}` / `{priority}` |
| Delegation route | `delegated` | `user` | `{assigned_to}` / `{assigned_to}` |
| Re-assignment | `reassigned` | `user` | `{assigned_to}` / `{assigned_to}` |
| SLA engine escalation | `escalated` | `system` | — / metadata.level |
| `createRelation()` | `relation_added` | `user` | — / `{relation_type, target_id}` |
| `deleteRelation()` | `relation_removed` | `user` | `{relation_type, target_id}` / — |
| `pauseSla()` | `sla_paused` | `user`/`api` | — / `{paused_at}` |
| `resumeSla()` | `sla_resumed` | `user`/`api` | `{paused_duration_mins}` / updated |
| Action completed | `resolved` | `user` | `{status: 'open'}` / `{status: 'completed'}` |
| Action cancelled | `cancelled` | `user` | `{status}` / `{status: 'cancelled'}` |
| Action reopened | `reopened` | `user` | `{status: 'completed'}` / `{status: 'open'}` |

---

## Timeline Panel (Frontend)

The `TimelinePanel` React component renders the event stream:

- Fetches `GET /api/v1/actions/:id/timeline?limit=50`
- Renders events chronologically (earliest at top)
- Per event type: distinct icon (emoji), color-coded dot, actor label, relative timestamp
- Diff display for `status_changed` (`→ in_progress`), `priority_changed` (`→ high`), `escalated` (`Level 2`), `relation_added` (`blocks → …`)
- Vertical connector line between events creates visual flow

### Event Icon Map

| Event | Icon | Color |
|-------|------|-------|
| created | ✨ | Blue |
| assigned / delegated / reassigned | 👤 / ↪ / 🔄 | Purple |
| escalated | ⬆ | Orange |
| blocked / unblocked | 🔒 / 🔓 | Red / Green |
| status_changed | 📋 | Cyan |
| priority_changed | 🎯 | Amber |
| resolved | ✅ | Green |
| sla_paused / sla_resumed | ⏸ / ▶ | Amber / Green |
| relation_added / removed | 🔗 / ✂ | Cyan / Gray |

---

## Correlation ID Integration

Every event stores the `correlation_id` from the originating HTTP request:

```
Client request → X-Correlation-ID: abc123
  └── Middleware: req.correlationId = 'abc123'
        └── Route handler: publishActionEvent(..., { correlationId: req.correlationId })
              └── action_events.correlation_id = 'abc123'
```

A single SLA engine tick that triggers escalation → notification enqueue → event publication will share the same `correlation_id`, enabling end-to-end distributed trace reconstruction by querying `action_events WHERE correlation_id = 'abc123'`.

---

## Compliance and Retention

The immutable event log satisfies common audit requirements:
- **Who** changed it: `actor_id` + `actor_label` + `actor_type`
- **What** changed: `before_snapshot` / `after_snapshot` JSONB diffs
- **When**: `occurred_at` with microsecond precision
- **Why / context**: `metadata` JSONB + `correlation_id`

Retention policy (outside Phase 2 scope): consider archiving events older than N years to cold storage (S3 + Parquet) while keeping the PostgreSQL table bounded. The immutability rules do not prevent archival DELETEs executed by a superuser role.
