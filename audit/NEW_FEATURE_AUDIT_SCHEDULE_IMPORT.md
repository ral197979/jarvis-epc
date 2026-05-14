# Schedule Import Feature Audit — v10.4.0
**Scope:** `api/services/schedule/xerParser.ts`, `mspParser.ts`, `scheduleImportService.ts`, `api/routes/scheduleImport.ts`, `api/db/migrations/054_schedule_import.sql`
**Audited:** 2026-05-14

---

## Security

### ✅ PASS — Auth & Tenant Isolation
- `scheduleImportRouter.use(requireAuth, requireTenant())` — both middleware applied at router level
- `tenantId` derived from `r.tenantId!` (middleware), never from body/query
- Job creation, task upserts, ID map inserts, and job status updates all use `tenantQuery()`

### ✅ PASS — RLS Coverage
`schedule_import_jobs` and `schedule_import_id_map` both have RLS enabled with correct tenant policies (migration 054).

### ❌ P1 — `pool.query` in dependency operations (RLS bypass)
**File:** `services/schedule/scheduleImportService.ts:142–163`

Two `pool.query` calls remain in the dependency import path:
```typescript
// Line 142 — DELETE
await pool.query(
  `DELETE FROM schedule_dependencies WHERE tenant_id=$1 AND predecessor_id = ANY($2) ...`,
  [tenantId, taskIds],
)
// Line 157 — INSERT
await pool.query(
  `INSERT INTO schedule_dependencies (tenant_id, ...) VALUES ($1,...)`,
  [tenantId, predId, succId, dep.lagDays],
)
```
Both use explicit `tenant_id` filtering in the query, so cross-tenant access is not currently exploitable. However, this bypasses the RLS session variable mechanism. If `schedule_dependencies` ever has its RLS policy tightened without updating this code, these calls will silently operate outside the policy.

**Fix:** Replace both with `tenantQuery(tenantId, sql, params)`.

### ✅ PASS — File Upload Safety
- multer fileFilter restricts to `.xer` and `.xml` extensions only
- 50 MB size limit enforced at upload middleware level
- In-memory storage (no file written to disk, no path traversal possible)
- No eval, no exec — purely string/DOM parsing

### ⚠️ P2 — Error detail leaked to client
**File:** `routes/scheduleImport.ts:55`
Import failures return `detail: (e as Error).message` in the HTTP 500 response, which can include DB error messages or parser tracebacks.

**Fix:** Log internally via `log.error()`, return only generic message to client.

### ⚠️ P3 — Memory pressure on free Render instance
Multer uses `memoryStorage()`. A 50 MB XER file is held fully in Node.js heap during parsing. On Render free tier (512 MB RAM), a concurrent import could OOM the process.

**Recommendation:** Consider streaming parse or reducing limit to 10 MB for free tier.

---

## Correctness

### ✅ PASS — Idempotent task import
External ID mapping via `schedule_import_id_map` ensures re-imports UPSERT tasks rather than creating duplicates. The `ON CONFLICT (tenant_id, project_id, external_id) DO UPDATE SET task_id=...` is correct.

### ✅ PASS — XER Parser
- `%T/%F/%R/%E` section parsing is correct
- Status code mapping (`TK_NotStart`, `TK_Active`, `TK_Complete`) correct
- Duration hours→days conversion (÷8) correct
- `percentComplete` clamped 0–100
- Empty file / no TASK table produces a warning, not a crash

### ❌ P2 — MSP Lag calculation is 10× off
**File:** `services/schedule/mspParser.ts:120–122`

```typescript
const lagHrs  = Number(l['LinkLag'] ?? 0) / 10  // comment says "→ lagHrs = lag/600"
const lagDays = Math.round(lagHrs / 600 / 8)
```

MS Project `LinkLag` is stored in tenths of a minute. The conversion should be:
- minutes = `LinkLag / 10`
- hours = `LinkLag / 600`
- days = `LinkLag / 4800` (8-hour day)

The code computes `lagDays = (LinkLag / 10) / 600 / 8 = LinkLag / 48000`, which is **10× too small**. A 1-day lag (LinkLag=4800) would be computed as 0.1 → rounds to 0. All MSP dependency lags are underestimated by a factor of 10.

**Fix:**
```typescript
const lagMinutes = Number(l['LinkLag'] ?? 0) / 10
const lagDays    = Math.round(lagMinutes / 480)  // 480 min per 8-hour day
```

### ⚠️ P2 — Re-import deletes manually-added dependencies
**File:** `scheduleImportService.ts:138–144`
Before re-inserting dependencies, the service deletes ALL existing `schedule_dependencies` rows where both `predecessor_id` AND `successor_id` are in the imported task set. This removes any manually-created dependencies between imported tasks.

**Impact:** Users who manually link two tasks that also exist in the imported schedule will lose those links on every re-import.

**Fix:** Track which dependencies were created by import (add `import_job_id` FK to `schedule_dependencies`) and only delete those.

### ⚠️ P2 — No per-project task limit
The service loops over every task in the XER/XML file, each with multiple individual DB queries. A large P6 export (10,000+ tasks) could exhaust the DB connection pool or time out. No limit is enforced on task count.

**Fix:** Add a configurable `MAX_TASKS_PER_IMPORT` check after parsing, reject with HTTP 422 if exceeded.

### ⚠️ P3 — WBS code fallback to `activityId`
**File:** `scheduleImportService.ts:94`
When updating tasks: `wbs_code = task.wbsCode ?? task.activityId`. If WBS is null, activity ID (e.g. "A1000") is stored as wbs_code. This is a different semantic — activity codes and WBS codes are distinct concepts in P6.

---

## Summary

| ID | Severity | Finding |
|---|---|---|
| SCHED-001 | P1 | `pool.query` for dependency operations (RLS bypass) |
| SCHED-002 | P2 | MSP lag calculation 10× underestimated |
| SCHED-003 | P2 | Re-import deletes manually-added dependencies |
| SCHED-004 | P2 | No per-project task count limit (DoS risk) |
| SCHED-005 | P2 | Error detail in HTTP 500 response |
| SCHED-006 | P3 | Memory pressure on free Render tier for large files |
| SCHED-007 | P3 | WBS code fallback to activityId is semantically incorrect |

**Overall: CONDITIONAL PASS — SCHED-001 (P1) and SCHED-002 (P2) should be fixed**
