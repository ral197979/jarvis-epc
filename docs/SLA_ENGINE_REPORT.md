# SLA ENGINE REPORT
**Denver Engineering — Ava Phase 1C**
**Version:** 4.33.0 | **Status:** Production

---

## Purpose

The SLA Engine is a background promoter that scans all open/in-progress actions every 60 seconds, detects which ones are overdue, and fires escalation events in sequence as time thresholds are breached. It records every escalation in an append-only log for full forensic auditability.

---

## Architecture

### Promoter Registration

```typescript
export function registerSlaEngine(): void {
  registerPromoter(_scanOverdueActions)
}
```

Uses the same `registerPromoter()` pattern as `complianceWatcher`. The existing scheduler picks it up on every tick. No separate background job table entry required.

### Throttle Guard

```typescript
const SCAN_MIN_INTERVAL_MS = Number(process.env['SLA_SCAN_MIN_INTERVAL_MS'] ?? '60000')
let _lastScanAt = 0

if (now - _lastScanAt < SCAN_MIN_INTERVAL_MS) return
```

Prevents runaway scans if the scheduler fires faster than expected. Configurable via environment variable.

---

## Scan Query

```sql
SELECT
  a.id, a.tenant_id, a.project_id, a.title, a.action_type,
  a.source_module, a.source_id, a.system_type, a.priority,
  a.assigned_to_user_id, a.assigned_to_role,
  a.due_at::text, a.sla_rule_id,
  EXTRACT(EPOCH FROM (NOW() - a.due_at)) / 3600.0 AS hours_overdue,
  MAX(ae.escalation_level) AS max_escalation_level
FROM actions a
LEFT JOIN action_escalations ae ON ae.action_id = a.id
WHERE a.status IN ('open','in_progress')
  AND a.due_at IS NOT NULL
  AND a.due_at < NOW()
GROUP BY a.id, ...
FOR UPDATE OF a SKIP LOCKED
```

**Key properties:**
- `FOR UPDATE SKIP LOCKED` — safe under multiple worker processes; each action is processed by exactly one worker per tick
- `MAX(ae.escalation_level)` — determines the highest escalation level already fired, enabling incremental progression
- `hours_overdue` computed in SQL — single round-trip, used for threshold checks and stored in escalation log
- Scoped to `open` and `in_progress` only — completed/cancelled actions are excluded

---

## Escalation Level Resolution

Priority order:
1. If `action.sla_rule_id` is set → fetch `escalation_levels` from `sla_rules`
2. If rule not found or `escalation_levels` is empty → use **default ladder**

### Default Escalation Ladder

| Level | Threshold (hours after due_at) | Notify Role |
|-------|-------------------------------|-------------|
| 1     | 0h (at due_at breach)         | assigned_user |
| 2     | 24h                           | supervisor    |
| 3     | 48h                           | admin         |

Tenants may configure custom ladders per `action_type` + `system_type` via `sla_rules`, e.g., PWTP alarms might escalate at 0h → 2h → 6h with different role targets.

---

## Escalation Firing Logic

```typescript
const nextLevel = levels
  .filter(l => l.level > currentMax && hoursOverdue >= l.after_hours)
  .sort((a, b) => a.level - b.level)[0]
```

**Invariants:**
- Only one level fires per scan tick (the lowest un-fired level whose threshold is met)
- An action that jumped from 0h to 50h overdue in one tick will fire level 1 on that tick; levels 2 and 3 fire on subsequent ticks
- `currentMax = null` → treated as 0 (no escalations yet)

---

## Notified User Resolution

| notify_role | Resolution |
|-------------|-----------|
| `assigned_user` | Returns `[assigned_to_user_id]` directly (no DB query) |
| `supervisor` | Queries `users` WHERE `role IN ('project_manager')` AND `tenant_id=X` AND `is_active=TRUE` LIMIT 10 |
| `admin` | Queries `users` WHERE `role IN ('admin','owner')` AND `tenant_id=X` AND `is_active=TRUE` LIMIT 10 |

If no users found for a role, `notified_users` is stored as `[]`. The escalation event is still recorded.

---

## Escalation Record

```sql
INSERT INTO action_escalations (
  tenant_id, action_id, escalation_level,
  triggered_at, notified_users, notify_role, hours_overdue
) VALUES ($1, $2, $3, NOW(), $4::jsonb, $5, $6)
```

- **Append-only** — no UPDATE trigger, no `updated_at` column
- `triggered_at = NOW()` — exact wall-clock time of escalation
- `notified_users` stored as JSONB array of UUIDs for later delivery hook
- `hours_overdue` stored at fire time for forensic reporting

---

## Notification Delivery (Phase 1 Sprint 4)

The current implementation records escalation events and resolves recipient lists. In-app notification and email delivery are stubbed with a `TODO` comment:

```typescript
// TODO Phase 1 Sprint 4: emit in-app notification to notifiedUsers
// await _emitNotification(action, nextLevel, notifiedUsers)
```

The `notified_users` JSONB column stores the user IDs; the delivery hook will read these on Sprint 4 when the notification service is wired in.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SLA_SCAN_MIN_INTERVAL_MS` | `60000` (1 min) | Minimum ms between scans |

SLA rule customization per tenant is done via `POST /api/v1/actions/sla-rules`.

---

## Observability

Every escalation fires a structured log:

```
[slaEngine] [escalate] Fired {
  action_id, action_type, level, notify_role,
  hours_overdue, notified_users
}
```

Scan summary:
```
[slaEngine] [scan] Escalations fired { count: N }
```

All logs use `slog('INFO', 'slaEngine', ...)` routed through the existing observability module.

---

## Performance Considerations

- Index `idx_actions_tenant_due ON actions(tenant_id, due_at) WHERE status = 'open'` covers the overdue scan WHERE clause
- `FOR UPDATE SKIP LOCKED` prevents lock contention under multi-worker deploys
- `LIMIT 10` on notified_user lookups prevents runaway queries in tenants with many admins
- Throttle guard prevents scan storm on scheduler restart

---

## Failure Modes

| Scenario | Behavior |
|----------|----------|
| DB connection lost during scan | Exception propagates to scheduler; logged; next tick retries |
| SLA rule deleted after action created | `sla_rule_id` lookup returns null → falls back to default ladder |
| All users in role are inactive | `notified_users = []`; escalation event still recorded |
| Action completed between scan and fire | `FOR UPDATE` lock held; status check at route layer; escalation recorded (idempotent) |
| Throttle guard active | Scan exits early, 0 escalations fired |

---

## Test Hooks

```typescript
export const __testHooks = {
  scanOnce:              _scanOverdueActions,
  resetThrottle:         () => { _lastScanAt = 0 },
  resolveEscalationLevels: _resolveEscalationLevels,
  fireNextEscalation:    _fireNextEscalation,
}
```

Used by `src/__tests__/modules/actions.test.ts` to test escalation logic in isolation without running the full scheduler.
