# Supervisor Command Workflows
**Denver Engineering — Ava Phase 3 (v4.35.0)**

## Purpose

Supervisors need bulk operational control: reassign overloaded assignees, freeze SLAs during force majeures, escalate clusters of at-risk actions, and open formal incident records. Phase 3 provides a set of command endpoints that execute these operations atomically and emit auditable events.

## Command Endpoints

All commands require authentication. Role enforcement is handled by the tenant's RBAC configuration.

---

### Reassign

```
POST /api/v1/ops/reassign
{
  "action_ids": ["uuid", "uuid", ...],
  "new_assignee_id": "uuid",
  "reason": "string"
}
```

**Behavior:**
1. Validates `new_assignee_id` belongs to the tenant.
2. `UPDATE actions SET assignee_id = ? WHERE id = ANY(?) AND tenant_id = ?`
3. For each updated action, publishes `action_assigned` event via `publishActionEvent()`.
4. Broadcasts `action_updated` via `broadcastEvent()` for realtime clients.

**Response:** `{ updated: N }`

---

### Bulk Escalate

```
POST /api/v1/ops/escalate
{
  "action_ids": ["uuid", "uuid", ...],
  "reason": "string"
}
```

**Behavior:**
1. `UPDATE actions SET max_escalation_level = max_escalation_level + 1 WHERE id = ANY(?) AND tenant_id = ?`
2. For each updated action, publishes `action_escalated` event.
3. Broadcasts `escalation_triggered` for realtime clients.

**Response:** `{ escalated: N }`

---

### Freeze SLA

```
POST /api/v1/ops/freeze
{
  "action_ids": ["uuid", "uuid", ...],
  "reason": "string"
}
```

**Behavior:**
1. `UPSERT action_sla_state SET sla_status = 'paused', paused_at = now()`  
   Uses `ON CONFLICT (tenant_id, action_id) DO UPDATE`.
2. Publishes `sla_paused` event for each action.
3. Broadcasts `sla_paused` for realtime clients.

**Use case:** Weather events, supply chain disruptions, labor actions where SLA timers should not count against the team.

**Response:** `{ frozen: N }`

---

### Unfreeze SLA

```
POST /api/v1/ops/unfreeze
{
  "action_ids": ["uuid", "uuid", ...],
  "reason": "string"
}
```

**Behavior:**
1. For each action in `action_sla_state` where `sla_status = 'paused'`:
   - Computes `pause_duration_mins = EXTRACT(EPOCH FROM (now() - paused_at)) / 60`
   - `UPDATE action_sla_state SET sla_status = 'active', paused_at = NULL, paused_duration_mins = paused_duration_mins + ?`
2. Publishes `sla_resumed` event for each action.
3. Broadcasts `sla_resumed` for realtime clients.

**Response:** `{ unfrozen: N }`

---

### Open Incident

```
POST /api/v1/ops/incident
{
  "title": "string",
  "description": "string",
  "severity": "low" | "medium" | "high" | "critical",
  "related_action_ids": ["uuid", ...],
  "affected_systems": ["string", ...]
}
```

**Behavior:**
1. `INSERT INTO ops_incidents` with `reported_by = req.auth.sub`.
2. Broadcasts `incident_created` realtime event with severity and affected systems.

**Use case:** Formal record of site incidents that may explain SLA breaches, escalations, or scope changes.

**Response:** `{ incident_id: "uuid" }`

---

## Operations Center Overview

```
GET /api/v1/ops/overview
```

Aggregates three parallel queries:
1. Open action counts by status and priority.
2. Active incidents (last 7 days).
3. Notification dead letters (requires attention).

Used by the `OperationsCenterPage` dashboard header.

---

## Ops Commands Table

Every freeze, unfreeze, reassign, and escalate can optionally be recorded as a formal `ops_command` for auditability:

```sql
CREATE TABLE ops_commands (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  ops_command_type   ops_command_type NOT NULL,
  issued_by          uuid NOT NULL,
  target_action_ids  uuid[] NOT NULL DEFAULT '{}',
  payload            jsonb NOT NULL DEFAULT '{}',
  reason             text,
  requires_approval  boolean NOT NULL DEFAULT false,
  approved_by        uuid,
  approved_at        timestamptz,
  executed_at        timestamptz,
  result_summary     jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
```

`requires_approval` is reserved for emergency overrides — commands that affect scope, safety, or cost beyond a configurable threshold.

---

## Ops Incidents Table

```sql
CREATE TABLE ops_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  title             text NOT NULL,
  description       text,
  severity          incident_severity NOT NULL DEFAULT 'medium',
  status            text NOT NULL DEFAULT 'open',
  reported_by       uuid NOT NULL,
  related_action_ids uuid[] NOT NULL DEFAULT '{}',
  affected_systems  text[] NOT NULL DEFAULT '{}',
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

---

## Event Emission Pattern

All supervisor commands follow the same pattern to ensure auditability:

```typescript
// 1. Persist change
await tenantQuery(tenantId, 'UPDATE actions SET ...', [...])

// 2. Emit to action event stream (Phase 2 audit log)
await publishActionEvent({ tenantId, actionId, eventType: 'action_escalated', ... })

// 3. Broadcast to realtime subscribers (Phase 3 WebSocket)
broadcastEvent({ event_type: 'escalation_triggered', tenant_id: tenantId, ... })
```

This three-step pattern ensures:
- DB change is committed before any event.
- Action event stream retains the audit trail.
- Realtime clients are notified immediately.

---

## Bulk Operation Limits

| Command | Max Actions per Request |
|---------|------------------------|
| Reassign | 100 |
| Bulk Escalate | 100 |
| Freeze | 100 |
| Unfreeze | 100 |

Requests exceeding limits are rejected with `400 Bad Request`.

---

## Known Limitations

- `requires_approval` flag on ops_commands is not yet enforced in the API — approval workflow is a Phase 4 feature.
- Incident status transitions (`open` → `investigating` → `resolved`) require a dedicated incident management endpoint (Phase 4).
- Bulk commands do not support rollback if a subset of actions fails — partial success is returned with the updated count.
