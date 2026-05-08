# ACTION ENGINE ARCHITECTURE
**Denver Engineering — Ava Phase 1A/1B/1C/1D**
**Version:** 4.33.0 | **Status:** Production

---

## Overview

The Ava Action Engine is a unified action tracking and SLA escalation system that spans all modules in the Denver Engineering platform. Every module emits a single, standardized action record at creation time. A single background worker handles escalation for all modules.

**Design goals:**
- Zero code duplication across modules — one engine, all modules
- Non-blocking: action creation never fails a module's HTTP route
- Idempotent: calling createAction twice is always safe
- Tenant-isolated: full RLS on all 4 tables
- Concurrent-worker safe: `FOR UPDATE SKIP LOCKED`

---

## Database Schema

### 4 Tables (Migration 029)

#### `actions` — Unified action model
```
id                   UUID PK
tenant_id            UUID NOT NULL → tenants(id) CASCADE
project_id           UUID          → projects(id) SET NULL
title                VARCHAR(500)  NOT NULL
description          TEXT
action_type          VARCHAR(100)  -- RFI | SUBMITTAL | PUNCH_ITEM | DAILY_LOG |
                                   -- COMPLIANCE_TASK | INSPECTION | BIM_ISSUE |
                                   -- WORK_ORDER | ALARM | TEMPLATE_ASSIGNMENT
source_module        VARCHAR(100)  -- rfis | submittals | punch_items | ...
source_id            UUID          -- FK to originating record (soft)
system_type          VARCHAR(100)  -- PWTP | WWTP | HVAC | EPC | null
priority             VARCHAR(20)   CHECK IN ('low','medium','high','critical')
status               VARCHAR(30)   CHECK IN ('open','in_progress','completed','cancelled')
assigned_to_user_id  UUID          → users(id) SET NULL
assigned_to_role     VARCHAR(50)
due_at               TIMESTAMPTZ   -- computed from sla_rules at creation
sla_rule_id          UUID          -- nullable; rule used for due_at computation
completed_at         TIMESTAMPTZ
cancelled_at         TIMESTAMPTZ
created_by           UUID          → users(id) SET NULL
created_at / updated_at TIMESTAMPTZ

UNIQUE (tenant_id, source_module, source_id)   ← idempotency key
```

**Key indexes:**
- `(tenant_id, status)` — primary filter for open action lists
- `(tenant_id, assigned_to_user_id)` — "my actions" queries
- `(tenant_id, due_at) WHERE status = 'open'` — overdue detection
- `(tenant_id, source_module, source_id)` — idempotency lookups

#### `sla_rules` — Escalation configuration per tenant
```
id                     UUID PK
tenant_id              UUID NOT NULL
action_type            VARCHAR(100)
system_type            VARCHAR(100) NULL   -- NULL = catch-all
default_duration_hours INTEGER DEFAULT 72  -- hours from creation to due_at
is_active              BOOLEAN DEFAULT TRUE
escalation_levels      JSONB DEFAULT '[]'
  -- [{ level: 1, after_hours: 0,  notify_role: 'assigned_user' },
  --  { level: 2, after_hours: 24, notify_role: 'supervisor'    },
  --  { level: 3, after_hours: 48, notify_role: 'admin'         }]

UNIQUE (tenant_id, action_type, system_type)
```

#### `action_escalations` — Append-only escalation event log
```
id               UUID PK
tenant_id        UUID NOT NULL
action_id        UUID NOT NULL → actions(id) CASCADE
escalation_level INTEGER       -- 1, 2, 3
triggered_at     TIMESTAMPTZ   -- when escalation fired
notified_users   JSONB         -- array of user UUIDs notified
notify_role      VARCHAR(50)
hours_overdue    NUMERIC(8,2)  -- snapshot for forensics

(No UPDATE trigger — append-only)
```

#### `approval_delegations` — Time-bound delegation rules
```
id               UUID PK
tenant_id        UUID NOT NULL
user_id          UUID NOT NULL → users(id) CASCADE  -- delegator
delegate_user_id UUID NOT NULL → users(id) CASCADE  -- recipient
start_date       TIMESTAMPTZ NOT NULL
end_date         TIMESTAMPTZ NOT NULL
scope            JSONB DEFAULT '{}'
  -- {} = all modules/types
  -- {"modules": ["rfis"], "action_types": ["RFI"]}
is_active        BOOLEAN DEFAULT TRUE
created_by       UUID
CHECK (user_id <> delegate_user_id)              -- no self-delegation
UNIQUE (tenant_id, user_id, delegate_user_id, start_date, end_date)
```

---

## Service Layer

### `api/services/actionService.ts`

**`createAction(tenantId, input)`** — Core creation function
1. `resolveEffectiveAssignee()` — check for active delegation
2. `_resolveSlaRule()` — look up matching SLA rule, compute `due_at`
3. `INSERT ... ON CONFLICT (tenant_id, source_module, source_id) DO NOTHING`
4. If conflict: SELECT and return existing row
5. On any error: log and return `null` — never throws

**`resolveEffectiveAssignee(tenantId, userId, actionType, sourceModule)`**
- Queries `approval_delegations` with time-bound + JSONB scope filter
- Scope matching: empty `{}` covers all; otherwise `modules` and `action_types` arrays checked with `@>` containment
- Returns `delegate_user_id` if active match; original `userId` otherwise

**`_resolveSlaRule(tenantId, actionType, systemType)`**
- Prefers `system_type`-specific rule via `ORDER BY (system_type IS NOT NULL) DESC LIMIT 1`
- Falls back to `system_type IS NULL` catch-all rules

**`completeAction(tenantId, sourceModule, sourceId)`**
- Sets `status='completed'`, `completed_at=NOW()`
- Guard: `AND status NOT IN ('completed','cancelled')`

**`cancelAction(tenantId, sourceModule, sourceId)`**
- Sets `status='cancelled'`, `cancelled_at=NOW()`
- Same terminal-state guard

---

### `api/services/slaEngine.ts`

**Background worker** registered via `registerPromoter()` (same pattern as `complianceWatcher`). Fires on every scheduler tick (default 60s minimum between scans).

**Scan loop:**
1. Query all `open`/`in_progress` actions where `due_at < NOW()`
2. `FOR UPDATE OF a SKIP LOCKED` — concurrent-worker safe
3. For each: resolve escalation levels (from `sla_rules` or defaults)
4. Call `_fireNextEscalation()` for each

**`_fireNextEscalation(action, levels)`**
- Finds next un-fired level where `hours_overdue >= after_hours`
- Resolves notified users by role (`assigned_user` / `supervisor` / `admin`)
- INSERTs into `action_escalations` (append-only)
- Returns `true` if fired, `false` if nothing due yet

**Default escalation ladder** (used when no SLA rule matched):
| Level | Threshold | Notify Role |
|-------|-----------|-------------|
| 1     | +0h       | assigned_user |
| 2     | +24h      | supervisor    |
| 3     | +48h      | admin         |

---

## API Routes (`api/routes/actions.ts`)

Mounted at `/api/v1/actions` in `server.ts`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Paginated action list; filters: `status`, `action_type`, `project_id`, `assigned_to_user_id`, `system_type`, `priority`, `overdue_only` |
| GET | `/my` | Current user's actions (status filter, default `open`) |
| GET | `/overdue` | Admin/PM only; includes `hours_overdue`, `max_escalation_level` |
| GET | `/summary` | Counts by status, priority, type; `overdue_count` |
| GET | `/:id` | Single action with full escalation history array |
| PATCH | `/:id` | Update `status`, `priority`, `assigned_to_user_id`, `description` |
| GET | `/sla-rules` | List tenant SLA rules |
| POST | `/sla-rules` | Create/upsert SLA rule |
| PATCH | `/sla-rules/:id` | Update SLA rule |
| GET | `/delegations` | List active delegations |
| POST | `/delegations` | Create delegation (circular check enforced) |
| PATCH | `/delegations/:id` | Deactivate delegation |

---

## Module Hook Pattern

All module route files follow this pattern after a successful INSERT:

```typescript
// At top of route file:
import { createAction } from '../services/actionService'  // v4.33.0 Ava

// After INSERT RETURNING *:
const row = result.rows[0]
void createAction(tenantId, {
  title:               `RFI ${row.rfi_number}: ${row.title}`,
  action_type:         'RFI',
  source_module:       'rfis',
  source_id:           row.id,
  project_id:          row.project_id ?? null,
  priority:            row.priority ?? 'medium',
  assigned_to_user_id: row.assigned_to ?? null,
  created_by:          req.auth?.sub ?? null,
})
res.status(201).json({ data: row })
```

**`void` prefix** — fire-and-forget. Errors are logged inside `createAction()` but never propagate.

---

## Module Hook Coverage

| Module | action_type | source_module | File |
|--------|------------|---------------|------|
| RFIs | `RFI` | `rfis` | `procurement.ts` |
| Submittals | `SUBMITTAL` | `submittals` | `procurement.ts` |
| Punch Items | `PUNCH_ITEM` | `punch_items` | `punchLists.ts` |
| Daily Logs | `DAILY_LOG` | `daily_logs` | `dailyLogs.ts` |
| Compliance Tasks | `COMPLIANCE_TASK` | `compliance_tasks` | `compliance.ts` |
| BIM Issues | `BIM_ISSUE` | `bim_issues` | `bim.ts` |
| Inspections | `INSPECTION` | `inspections` | `inspections.ts` |

---

## Startup Registration (`api/server.ts`)

```typescript
import { actionsRouter }    from './routes/actions'
import { registerSlaEngine } from './services/slaEngine'

app.use('/api/v1/actions', actionsRouter)  // routes

registerSlaEngine()  // background worker (called after startScheduler())
```

---

## RLS Policy

All 4 tables use:
```sql
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
```

The `tenantQuery(tenantId, sql, params)` helper sets this session variable before every query, ensuring every read and write is automatically scoped to the calling tenant.

---

## Security Notes

- Circular delegation rejected at POST time (bidirectional check)
- `PATCH /:id` route enforces tenant ownership before updating
- `GET /overdue` requires `admin` or `project_manager` role
- No cross-tenant data leak possible: RLS enforced at Postgres session level
