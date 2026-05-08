# SLA Policy Engine

**Ava Phase 2 | Denver Engineering v4.34.0**

---

## Overview

The SLA Policy Engine extends Phase 1's rule-based SLA assignment with business-hours-aware due date calculation, timezone support, holiday skipping, and a pause/resume lifecycle. It introduces no breaking changes — Phase 1's `_resolveSlaRule()` and `due_at` assignment remain untouched; the policy engine adds a richer calculation path for tenants with SLA profiles.

---

## Database Schema

### `sla_profiles`

Tenant-scoped named profiles that describe a business calendar:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Owning tenant |
| `name` | VARCHAR(120) | Display name |
| `timezone` | VARCHAR(80) | IANA timezone string (e.g. `America/Denver`) |
| `business_hours_start` | TIME | Local time business day begins (e.g. `08:00`) |
| `business_hours_end` | TIME | Local time business day ends (e.g. `17:00`) |
| `business_days` | INTEGER[] | ISO weekdays (1=Mon … 7=Sun); typical: `{1,2,3,4,5}` |
| `holiday_dates` | DATE[] | Dates excluded from business time |
| `grace_period_minutes` | INTEGER | Minutes after breach before first escalation |
| `escalation_cooldown_minutes` | INTEGER | Minimum gap between successive escalations |
| `is_default` | BOOLEAN | One active default per tenant (enforced by partial unique index) |
| `is_active` | BOOLEAN | Soft-disable without deletion |

### `sla_profile_rules`

Profile-scoped SLA duration overrides, keyed by `action_type × system_type × priority`:

| Column | Type | Description |
|--------|------|-------------|
| `profile_id` | UUID | Parent profile |
| `action_type` | VARCHAR | e.g. `RFI`, `INSPECTION` |
| `system_type` | VARCHAR | e.g. `HVAC`, `STRUCTURAL` (nullable = all) |
| `priority` | VARCHAR | `low`, `medium`, `high`, `critical` |
| `sla_hours` | NUMERIC | Duration in business hours |

### `action_sla_state`

Per-action SLA lifecycle tracking (`UNIQUE(tenant_id, action_id)`):

| Column | Type | Description |
|--------|------|-------------|
| `action_id` | UUID | FK to actions |
| `sla_status` | VARCHAR | `active`, `paused`, `breached`, `met` |
| `remaining_minutes` | INTEGER | Last computed remaining (updated by worker) |
| `paused_at` | TIMESTAMPTZ | When current pause began |
| `paused_duration_mins` | NUMERIC | Accumulated pause time (all pauses) |
| `breach_count` | INTEGER | How many times this action has breached |

---

## Business Hours Calculation

### Timezone Conversion

All business hours math uses `Intl.DateTimeFormat` with `timeZone` option to convert UTC timestamps to local time without requiring external libraries:

```typescript
function _inTimezone(utc: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(utc).map(p => [p.type, p.value]))
  return { year, month, day, hour, minute, dow }
}
```

### Business Time Check

A moment is "in business time" when:
1. The local day-of-week is in `profile.business_days`
2. The local date is not in `profile.holiday_dates`
3. The local time is within `[business_hours_start, business_hours_end)`

### Due Date Computation

`computeBusinessDueDate(start, durationHours, profile)` steps forward from `start` in **15-minute increments**, accumulating only business-time minutes, until the target duration is reached. Maximum iteration cap: `365 × 24 × 4 = 35,040 steps` to prevent infinite loops on misconfigured profiles.

**Example:**
```
Start:    Friday 16:45 Mountain Time
Duration: 4 business hours
Profile:  Mon–Fri 08:00–17:00

Step forward:
  16:45→17:00  =  15 min business  (remaining: 3h 45m)
  17:00 Friday → skip to 08:00 Monday
  08:00→12:00  =  4h business      ✓ done at Monday 11:45
```

### Holiday Skipping

Holidays are checked by comparing the local date string (`YYYY-MM-DD`) against the `holiday_dates` array. The entire day is skipped — stepping moves forward until a non-holiday business day is found.

---

## Pause / Resume

### Pause

```typescript
export async function pauseSla(tenantId: string, actionId: string): Promise<boolean>
```

- Upserts `action_sla_state` with `sla_status = 'paused'`, `paused_at = NOW()`
- Idempotent: if already paused, returns `false` without updating
- Publishes `sla_paused` event via `publishActionEvent`

### Resume

```typescript
export async function resumeSla(tenantId: string, actionId: string): Promise<boolean>
```

- Reads current `paused_at`, computes elapsed minutes: `EXTRACT(EPOCH FROM (NOW() - paused_at)) / 60`
- Accumulates into `paused_duration_mins`
- Sets `sla_status = 'active'`, clears `paused_at`
- Publishes `sla_resumed` event

### Remaining Minutes Computation

```typescript
export async function computeRemainingMinutes(tenantId: string, actionId: string): Promise<number | null>
```

Reads the action's `due_at` and the current `paused_duration_mins`. Remaining = `due_at - NOW() + paused_duration_mins`. Returns `null` if no `due_at` is set.

---

## SLA Status Lifecycle

```
                   createAction()
                        │
                        ▼
                     [active]
                    /         \
           pauseSla()       due_at exceeded
               │                  │
            [paused]          [breached]
               │                  │
           resumeSla()        action closed
               │                  │
            [active]           [met]
```

---

## Profile Resolution Order

When computing a due date or SLA rule:

1. Look up `sla_profile_rules` for `(profile_id, action_type, system_type, priority)` — most specific
2. Fall back to `(profile_id, action_type, NULL, priority)` — ignore system_type
3. Fall back to global `sla_rules` table (Phase 1) — tenant-wide default
4. Return `null` (no SLA) if no rule found

---

## Grace Periods and Cooldowns

- **`grace_period_minutes`** — After a breach, the escalation engine waits this many minutes before firing the first escalation notification. Prevents alert fatigue on brief overruns.
- **`escalation_cooldown_minutes`** — Minimum gap between successive escalation levels. If an action was escalated 30 minutes ago and the cooldown is 60 minutes, the next escalation is deferred.

Both values are stored on the SLA profile and read by the Phase 1 SLA engine's `_fireNextEscalation()` function (integrated via profile lookup, not hardcoded).

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/actions/:id/sla/pause` | Pause SLA countdown |
| `POST` | `/api/v1/actions/:id/sla/resume` | Resume SLA countdown |

Both endpoints validate tenant ownership of `actionId` before operating.

---

## Limitations

- Business hours accumulation uses 15-minute steps. Sub-15-minute accuracy is not supported. This is a deliberate tradeoff: finer granularity (e.g. 1-minute steps) increases CPU cost by 15× with negligible real-world benefit.
- `computeRemainingMinutes` is a point-in-time calculation. The inbox shows the last computed value (updated by the SLA worker on each tick). Real-time countdown requires client-side interpolation between ticks.
- Holiday dates are stored as a flat array on the profile. There is no calendar subscription (e.g. iCal/Google Calendar) integration in Phase 2.
