# EVM Feature Audit — v10.3.0
**Scope:** `api/services/evm/evmService.ts`, `api/routes/evm.ts`, `api/db/migrations/053_evm.sql`
**Audited:** 2026-05-14

---

## Security

### ✅ PASS — Auth & Tenant Isolation
- `evmRouter.use(requireAuth, requireTenant())` — both middleware applied at router level
- All service functions accept `tenantId` from middleware-derived `r.tenantId!`, never from client body
- All 5 DB operations use `tenantQuery()` exclusively

### ✅ PASS — RLS Coverage
All 5 new tables have `ENABLE ROW LEVEL SECURITY` and correct `USING (tenant_id = current_setting(...))` policies:
`evm_baselines`, `evm_wbs_entries`, `evm_actuals`, `evm_progress`, `evm_snapshots`

### ⚠️ P2 — WBS `projectId` not validated against baseline
**File:** `routes/evm.ts:62–73`
`POST /evm/baselines/:baselineId/wbs` accepts `projectId` from `req.body`. An authenticated tenant user could supply a `projectId` belonging to a different project (within the same tenant) when posting WBS entries against a given `baselineId`. The service writes the entry with both the caller-supplied `projectId` and the route-param `baselineId`, which could produce entries with inconsistent project linkage.

**Fix:** Cross-check `projectId` against the baseline's `project_id` before inserting.

### ⚠️ P2 — Internal error details leaked to clients
**File:** `routes/evm.ts` (multiple handlers)
All `catch` blocks return `detail: (e as Error).message` in HTTP 500 responses. This can expose PostgreSQL error messages including table/column names, constraint names, and query fragments.

**Fix:** Log the detail server-side via `log.error()`, return only a generic message to the client.

### ⚠️ P3 — `...req.body` spread in service calls
**File:** `routes/evm.ts:40–43, 91–95, 117–122`
`createBaseline`, `recordActual`, `recordProgress` pass `{ ...req.body }` plus explicit fields. While the service functions use named parameters and typed inputs, unknown body fields pass through as extra properties. PostgreSQL will reject unknown columns, but this pattern is fragile.

**Fix:** Destructure only expected fields from `req.body` explicitly.

### ⚠️ P3 — Dead import: `pool` in evmService.ts
**File:** `services/evm/evmService.ts` (last line: `void pool`)
`pool` is imported but never called — the `void pool` suppresses the unused-variable TS warning. This leaves a potential footgun if someone adds `pool.query` calls in a future edit without noticing.

**Fix:** Remove the `pool` import entirely.

---

## Correctness

### ✅ PASS — EVM Formula Implementation
- BCWS: linear interpolation between `planned_start` and `planned_finish` — correct for basic EVM
- BCWP: `BAC × (percentComplete / 100)` — correct Earned Value formula
- CPI, SPI, CV, SV, EAC, ETC, VAC, TCPI all correctly derived per ANSI/EIA-748
- TCPI guard: returns `null` when `acwp ≥ bac` or `bcwp ≥ bac` — avoids divide-by-zero

### ✅ PASS — Health Thresholds
- Green ≥ 0.95, Yellow ≥ 0.85, Red < 0.85 — matches common PMB health standards

### ⚠️ P2 — WBS `upsertWbsEntries` uses `ON CONFLICT DO NOTHING`
**File:** `services/evm/evmService.ts:upsertWbsEntries`
The INSERT uses `ON CONFLICT DO NOTHING` — re-submitting existing WBS codes silently ignores updates. If a user corrects a WBS entry BAC or name and re-POSTs, the change is lost. This should be `ON CONFLICT ... DO UPDATE SET name=EXCLUDED.name, bac=EXCLUDED.bac, ...`.

### ⚠️ P3 — No validation: BAC, dates
- Negative BAC is accepted (no CHECK constraint in service layer, though migration has no CHECK either)
- `startDate` / `finishDate` are stored as strings; invalid date strings (e.g. `"not-a-date"`) will be passed to `plannedValue()` which returns `0` silently rather than erroring
- `finishDate < startDate` is not rejected

### ⚠️ P3 — BAC consistency not enforced
Baseline `bac` and sum of WBS entry `bac` values can diverge. No reconciliation or warning is produced. Metrics will use `baseline.bac` for indices, ignoring the WBS sum, which can make BCWP appear > BAC.

---

## Summary

| ID | Severity | Finding |
|---|---|---|
| EVM-001 | P2 | WBS projectId not validated against baseline |
| EVM-002 | P2 | Internal error details in 500 responses |
| EVM-003 | P2 | WBS upsert silently ignores updates (ON CONFLICT DO NOTHING) |
| EVM-004 | P3 | req.body spread passes unknown fields through |
| EVM-005 | P3 | Dead `pool` import in evmService.ts |
| EVM-006 | P3 | No input validation on BAC / date fields |
| EVM-007 | P3 | BAC vs WBS sum consistency not enforced |

**Overall: PASS with P2/P3 findings — not blocking**
