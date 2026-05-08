# Real-time Event Streaming
**Denver Engineering — Ava Phase 3 (v4.35.0)**

## Overview

Phase 3 adds a persistent, replayable real-time event streaming layer. Clients connect via WebSocket and receive live operational events as they occur. Clients that disconnect can reconnect and replay missed events from a durable sequence log.

## Architecture

```
Client (browser / mobile)
    │
    │  ws://host:3001/ws?tenant_id=T&user_id=U&last_seq=N
    │
    ▼
wsGateway.ts (ws library, HTTP upgrade)
    │
    ├── Auth: validate tenant_id + user_id from query params
    ├── Register: subscriptionManager.register(ws, clientId, tenantId, userId)
    ├── Replay: replayEvents(tenant_id, scope, scope_id, last_seq) if last_seq present
    ├── Heartbeat: ping every 30s, terminate on pong timeout
    └── Message handler: {type:'subscribe'|'unsubscribe', scope, scope_id}
    │
    ▼
subscriptionManager.ts (singleton)
    │
    ├── register() / unregister()
    ├── subscribe(clientId, {scope, scope_id})
    ├── broadcast(event) → tenant-isolated fan-out
    └── startHeartbeat(30_000ms)
    │
    ▼
eventBroadcaster.ts
    │
    ├── publishRealtimeEvent(event) → persist to realtime_event_log → broadcast()
    ├── broadcastEvent(event) → fire-and-forget (no persist)
    ├── replayEvents(tenantId, scope, scopeId, sinceSequence) → DB query
    └── Dedup: in-memory Map, 5-second TTL, key = tenant:type:scope_id:payload_prefix
```

## WebSocket Connection

### Connection URL

```
ws://host:3001/ws
  ?tenant_id=<uuid>
  &user_id=<uuid>
  [&last_seq=<bigint>]        // replay from this sequence
  [&replay_scope=<scope>]     // scope for replay ('tenant'|'project'|'action')
  [&replay_scope_id=<id>]     // scope entity id for replay
```

### Client Messages (client → server)

```json
{ "type": "subscribe",   "scope": "project", "scope_id": "proj-uuid" }
{ "type": "unsubscribe", "scope": "project", "scope_id": "proj-uuid" }
{ "type": "pong" }
```

### Server Messages (server → client)

```json
{
  "event_type": "action_created",
  "tenant_id": "tenant-uuid",
  "payload": { ... },
  "subscription_scope": "project",
  "scope_id": "proj-uuid",
  "sequence_number": 4821,
  "correlation_id": "abc123",
  "published_at": "2026-05-06T12:00:00.000Z"
}
```

```json
{ "type": "ping" }            // server → client every 30s
{ "type": "replay_complete" } // sent after reconnect replay finishes
```

## Event Types

| Event | Trigger |
|-------|---------|
| `action_created` | New action created |
| `action_updated` | Action fields changed |
| `action_status_changed` | Status transition |
| `action_escalated` | Escalation level incremented |
| `action_assigned` | Assignee changed |
| `action_completed` | Status → completed |
| `action_reopened` | Completed action re-opened |
| `sla_breached` | SLA deadline passed |
| `sla_at_risk` | SLA warning threshold hit |
| `sla_paused` | SLA timer paused |
| `sla_resumed` | SLA timer resumed |
| `blocker_added` | Dependency blocker created |
| `blocker_resolved` | Dependency resolved |
| `readiness_changed` | Readiness state transition |
| `recommendation_generated` | New recommendation available |
| `incident_created` | Ops incident opened |
| `escalation_triggered` | Automated escalation fired |

## Subscription Scopes

| Scope | Meaning | scope_id |
|-------|---------|---------|
| `tenant` | All events for the tenant | tenant_id (auto-subscribed on connect) |
| `project` | Events for a specific project | project_id |
| `action` | Events for a specific action | action_id |

## Event Persistence

Every call to `publishRealtimeEvent()` persists the event to `realtime_event_log` **before** broadcasting. This ensures:

1. Events are never lost if the broadcast fails.
2. Reconnecting clients can replay from any sequence number.
3. Polling clients (`GET /ops/live-feed?last_seq=N`) receive the same ordered stream.

```sql
CREATE SEQUENCE realtime_event_seq;

CREATE TABLE realtime_event_log (
  id                  bigserial PRIMARY KEY,
  tenant_id           uuid NOT NULL,
  event_type          text NOT NULL,
  payload             jsonb NOT NULL DEFAULT '{}',
  subscription_scope  text NOT NULL DEFAULT 'tenant',
  scope_id            text,
  sequence_number     bigint NOT NULL DEFAULT nextval('realtime_event_seq'),
  correlation_id      text,
  published_at        timestamptz NOT NULL DEFAULT now()
);
```

## Event Deduplication

In-memory dedup prevents duplicate events during burst conditions (e.g., two concurrent processes both detect an SLA breach):

```
key = "{tenant_id}:{event_type}:{scope_id}:{payload_prefix_32}"
TTL = 5 seconds
```

When size > 1000 entries, the oldest 500 are evicted. Dedup applies only to `publishRealtimeEvent()`; `broadcastEvent()` (fire-and-forget) bypasses it.

## Polling Fallback

For environments where WebSocket is unavailable (corporate proxies, some mobile networks):

```
GET /api/v1/ops/live-feed?last_seq=4820&scope=project&scope_id=proj-uuid
```

Returns the same `realtime_event_log` data as WebSocket replay. The `LiveEventFeed` component automatically falls back to polling every 10 seconds when the WebSocket connection fails.

## Tenant Isolation Guarantee

`SubscriptionManager.broadcast()` iterates all connected clients and checks `client.tenantId !== event.tenant_id` before sending. A client registered as tenant A will never receive events from tenant B, regardless of subscription configuration.

## Reconnect Protocol

1. Client stores `last_seq` from each received message.
2. On disconnect, client reconnects with `?last_seq=<stored_value>`.
3. Server calls `replayEvents()` and streams missed events in sequence order.
4. Server sends `{type: "replay_complete"}` when caught up.
5. Normal streaming resumes.
