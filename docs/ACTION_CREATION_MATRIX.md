# ACTION CREATION MATRIX
**Denver Engineering — Ava Phase 1B**
**Version:** 4.33.0 | **Status:** Production

This document maps every module that emits actions into the unified action engine, specifying exact field values, hook location, and SLA behavior.

---

## Module Hook Summary

| Module | Route File | action_type | source_module | Title Pattern | Priority Source | Assignee Source |
|--------|-----------|------------|--------------|--------------|----------------|----------------|
| RFIs | `procurement.ts` | `RFI` | `rfis` | `RFI {rfi_number}: {title}` | `row.priority ?? 'medium'` | `row.assigned_to` |
| Submittals | `procurement.ts` | `SUBMITTAL` | `submittals` | `Submittal {submittal_number}: {title}` | `'medium'` | `null` |
| Punch Items | `punchLists.ts` | `PUNCH_ITEM` | `punch_items` | `Punch Item {item_number}: {title}` | `row.priority ?? 'medium'` | `row.assigned_to` |
| Daily Logs | `dailyLogs.ts` | `DAILY_LOG` | `daily_logs` | `Daily Log: {log_date}` | `'medium'` | `null` |
| Compliance Tasks | `compliance.ts` | `COMPLIANCE_TASK` | `compliance_tasks` | `Compliance: {title}` | `'medium'` | `row.assigned_to` |
| BIM Issues | `bim.ts` | `BIM_ISSUE` | `bim_issues` | `BIM Issue: {title}` | Derived from `severity`* | `row.assigned_to` |
| Inspections | `inspections.ts` | `INSPECTION` | `inspections` | `Inspection {inspection_number}: {title}` | `'medium'` | `row.inspector_id` |

*BIM priority derivation: `severity='critical'` → `'critical'`; `severity='major'` → `'high'`; otherwise `'medium'`

---

## Detailed Field Mapping

### RFI

```typescript
// File: api/routes/procurement.ts
// Trigger: POST /api/v1/rfis

void createAction(tenantId, {
  title:               `RFI ${row.rfi_number}: ${row.title}`,
  action_type:         'RFI',
  source_module:       'rfis',
  source_id:           row.id,                               // UUID
  project_id:          row.project_id ?? null,
  priority:            (row.priority as 'low'|'medium'|'high'|'critical') ?? 'medium',
  assigned_to_user_id: row.assigned_to ?? null,
  created_by:          req.auth?.sub ?? null,
})
```

**SLA default:** 72h duration. Escalation: assigned reviewer → PM → admin.

---

### Submittal

```typescript
// File: api/routes/procurement.ts
// Trigger: POST /api/v1/submittals

void createAction(tenantId, {
  title:               `Submittal ${row.submittal_number}: ${row.title}`,
  action_type:         'SUBMITTAL',
  source_module:       'submittals',
  source_id:           row.id,
  project_id:          row.project_id,
  priority:            'medium',
  assigned_to_user_id: null,
  created_by:          req.auth?.sub ?? null,
})
```

**Note:** Submittals have no direct assignee at creation; the action remains unassigned until a reviewer is set.

---

### Punch Item

```typescript
// File: api/routes/punchLists.ts
// Trigger: POST /api/v1/punch-lists/:id/items

void createAction(r.tenantId!, {
  title:               `Punch Item ${row.item_number}: ${row.title}`,
  action_type:         'PUNCH_ITEM',
  source_module:       'punch_items',
  source_id:           row.id,
  project_id:          row.project_id ?? null,
  priority:            (row.priority as 'low'|'medium'|'high'|'critical') ?? 'medium',
  assigned_to_user_id: row.assigned_to ?? null,
  created_by:          (r as any).auth?.sub ?? null,
})
```

---

### Daily Log

```typescript
// File: api/routes/dailyLogs.ts
// Trigger: POST /api/v1/projects/:projectId/daily-logs

void createAction(r.tenantId!, {
  title:         `Daily Log: ${row.log_date}`,
  action_type:   'DAILY_LOG',
  source_module: 'daily_logs',
  source_id:     row.id,
  project_id:    projectId ?? null,
  priority:      'medium',
  created_by:    (r as any).auth?.sub ?? null,
})
```

**Note:** Daily logs have no specific assignee; priority is always `medium`. SLA tracks approval workflow (draft → submitted → approved).

---

### Compliance Task

```typescript
// File: api/routes/compliance.ts
// Trigger: POST /api/v1/compliance-tasks

void createAction(tenantId, {
  title:               `Compliance: ${row.title}`,
  action_type:         'COMPLIANCE_TASK',
  source_module:       'compliance_tasks',
  source_id:           row.id,
  project_id:          row.project_id ?? null,
  priority:            'medium',
  assigned_to_user_id: row.assigned_to ?? null,
  created_by:          row.created_by ?? null,
})
```

**Note:** `complianceWatcher` auto-transitions compliance tasks; the action engine tracks the human-facing due date alongside.

---

### BIM Issue

```typescript
// File: api/routes/bim.ts
// Trigger: POST /api/v1/projects/:projectId/bim-issues

void createAction(r.tenantId!, {
  title:               `BIM Issue: ${row.title}`,
  action_type:         'BIM_ISSUE',
  source_module:       'bim_issues',
  source_id:           row.id,
  project_id:          req.params.projectId ?? null,
  priority:            row.severity === 'critical' ? 'critical'
                     : row.severity === 'major'    ? 'high'
                     : 'medium',
  assigned_to_user_id: row.assigned_to ?? null,
  created_by:          (r as any).auth?.sub ?? null,
})
```

**Priority derivation:** BIM `severity` maps to action `priority`: `critical`→`critical`, `major`→`high`, all others→`medium`.

---

### Inspection

```typescript
// File: api/routes/inspections.ts
// Trigger: POST /api/v1/projects/:projectId/inspections

void createAction(r.tenantId!, {
  title:               `Inspection ${row.inspection_number}: ${row.title}`,
  action_type:         'INSPECTION',
  source_module:       'inspections',
  source_id:           row.id,
  project_id:          projectId ?? null,
  priority:            'medium',
  assigned_to_user_id: row.inspector_id ?? null,
  created_by:          (r as any).auth?.sub ?? null,
})
```

---

## Idempotency Guarantee

Every `createAction()` call is guarded by:

```sql
INSERT INTO actions (...) ON CONFLICT (tenant_id, source_module, source_id) DO NOTHING
```

If the same `(tenant_id, source_module, source_id)` tuple is inserted twice (e.g., retried POST), the second call:
1. Hits the UNIQUE constraint
2. Returns 0 rows from INSERT
3. Fetches and returns the existing row via SELECT
4. Logs nothing unusual — transparent to the caller

**Result:** Exactly one action row per source record, guaranteed at the Postgres constraint level.

---

## action_type Enum Reference

| action_type | Source | Notes |
|------------|--------|-------|
| `RFI` | rfis | Request for Information |
| `SUBMITTAL` | submittals | Drawing/spec submittal for approval |
| `PUNCH_ITEM` | punch_items | Quality closeout deficiency |
| `DAILY_LOG` | daily_logs | Field daily log approval |
| `COMPLIANCE_TASK` | compliance_tasks | Regulatory/contractual compliance item |
| `INSPECTION` | inspections | Formal inspection record |
| `BIM_ISSUE` | bim_issues | 3D coordination clash or issue |
| `WORK_ORDER` | work_orders | Field work order (future hook) |
| `ALARM` | alarms | System alarm (future hook) |
| `TEMPLATE_ASSIGNMENT` | template_assignments | Checklist template assignment (future hook) |

---

## system_type Isolation

When a module provides a `system_type` (e.g., `PWTP`, `WWTP`, `HVAC`, `EPC`), the SLA engine uses it to find a system-specific SLA rule before falling back to the catch-all rule:

```sql
ORDER BY (system_type IS NOT NULL) DESC   -- prefer specific over catch-all
LIMIT 1
```

This allows, for example, PWTP alarms to have a 2h escalation while general alarms use 24h — without any code changes.

---

## Planned Future Hooks

The following modules have `createAction()` stubs prepared but not yet active:

| Module | Trigger | action_type |
|--------|---------|-------------|
| Work Orders | `POST /work-orders` | `WORK_ORDER` |
| Alarms | System alarm trigger | `ALARM` |
| Template Assignments | Template assignment | `TEMPLATE_ASSIGNMENT` |
| Safety Incidents | `POST /safety-incidents` | `SAFETY_INCIDENT` |

These will be added in Phase 1D sprint iterations.
