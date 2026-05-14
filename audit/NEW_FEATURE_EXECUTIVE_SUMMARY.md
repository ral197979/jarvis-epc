# New Feature Audit — Executive Summary
**Features:** EVM v10.3.0 · Schedule Import v10.4.0 · IoT Ingest v10.5.0 · Security Remediations v10.5.1–v10.6.0
**Audited:** 2026-05-14
**Prior audit score:** 83/100 (v10.5.0)

---

## Verdict: ⚠️ GO WITH RESTRICTIONS

All prior P0/P1 blockers from the last audit are resolved and live. Two new P1 findings were introduced in the new features (unrelated to the security remediations). These must be fixed before the IoT and schedule import features are used in production under adversarial conditions.

---

## Risk Register

### 🔴 P1 — Open

| ID | Feature | Finding | File |
|---|---|---|---|
| IOT-001 | IoT v10.5.0 | `pool.query` in ingest hot path — `sensors` UPDATE has no `tenant_id` in WHERE | `sensorIngestService.ts:196` |
| SCHED-001 | Schedule Import v10.4.0 | `pool.query` for dependency DELETE/INSERT — bypasses RLS | `scheduleImportService.ts:142,157` |

### 🟡 P2 — Should Fix

| ID | Feature | Finding |
|---|---|---|
| SCHED-002 | Schedule Import | MSP lag calculation 10× underestimated — all dependency lags wrong |
| SCHED-003 | Schedule Import | Re-import deletes manually-added dependencies |
| SCHED-004 | Schedule Import | No per-project task count limit (DoS risk on large XER files) |
| EVM-001 | EVM | WBS projectId not validated against baseline project |
| EVM-002 | EVM | Internal DB errors returned in HTTP 500 detail field |
| EVM-003 | EVM | WBS upsert uses ON CONFLICT DO NOTHING — updates silently dropped |
| IOT-002 | IoT | ttlDays string-interpolated into SQL interval (design risk) |
| IOT-003 | IoT | Auto-registration assigns wrong projectId in batch ingest |
| IOT-004 | IoT | N×4+ DB queries per reading — will not scale |
| IOT-005 | IoT | Alert threshold queries fire even when thresholds are null |
| SEC-005 | Security | Rate limiter trust proxy not confirmed for reverse proxy setup |

### 🔵 P3 — Low Priority

| ID | Feature | Finding |
|---|---|---|
| EVM-004 | EVM | req.body spread passes unknown fields |
| EVM-005 | EVM | Dead `pool` import in evmService.ts |
| EVM-006 | EVM | No BAC / date input validation |
| EVM-007 | EVM | WBS sum vs BAC consistency not enforced |
| SCHED-006 | Schedule Import | 50 MB file held in heap — OOM risk on free Render tier |
| SCHED-007 | Schedule Import | WBS code fallback to activityId is semantically wrong |
| IOT-006 | IoT | Auto-registered sensors get meaningless type/unit |
| SEC-008 | Security | IoT ingest / simulation have no rate limiting |

---

## Feature Scorecards

| Feature | Auth | RLS | Error Handling | Correctness | Score |
|---|---|---|---|---|---|
| EVM v10.3.0 | ✅ | ✅ | ⚠️ (detail leak) | ⚠️ (WBS upsert) | **88/100** |
| Schedule Import v10.4.0 | ✅ | ⚠️ (P1 deps) | ⚠️ (detail leak) | ❌ (lag bug) | **74/100** |
| IoT Ingest v10.5.0 | ✅ | ❌ (P1 ingest) | ✅ | ⚠️ (batching) | **76/100** |
| Security Remediations v10.5.1–v10.6.0 | ✅ | ✅ | — | ✅ | **96/100** |

**Composite score: 83.5/100** (roughly flat vs prior audit — new features added new findings while remediations closed old ones)

---

## Immediate Actions (Before Production Load)

### Fix 1 — IOT-001: Add tenant_id to ingest pool.query calls
**File:** `sensorIngestService.ts`
```typescript
// Line 188 → tenantQuery(tenantId, ...)
// Line 196 → tenantQuery(tenantId, `UPDATE sensors SET ... WHERE id=$1 AND tenant_id=$2`, [sensorId, tenantId])
// Lines 244, 250, 259 → tenantQuery(tenantId, ...) + add AND tenant_id=$N to WHERE
```

### Fix 2 — SCHED-001: Replace pool.query in scheduleImportService
**File:** `scheduleImportService.ts:142,157`
```typescript
// Both → tenantQuery(tenantId, sql, params)
```

### Fix 3 — SCHED-002: MSP lag calculation
**File:** `mspParser.ts:120–122`
```typescript
// Wrong:
const lagHrs  = Number(l['LinkLag'] ?? 0) / 10
const lagDays = Math.round(lagHrs / 600 / 8)
// Correct:
const lagMinutes = Number(l['LinkLag'] ?? 0) / 10
const lagDays    = Math.round(lagMinutes / 480)
```

### Fix 4 — SEC-005: Confirm trust proxy
**File:** `server.ts`
Verify `app.set('trust proxy', 1)` is set before rate limiters are applied.

---

## What's Clean

- ✅ All prior P0/P1/P2/P3 findings from the v10.5.0 audit are resolved and deployed
- ✅ EVM math implementation is correct (ANSI/EIA-748 compliant)
- ✅ XER parser is correct and robust
- ✅ Token security design is solid (SHA-256, expiry, revocation)
- ✅ RLS coverage on all new tables in migrations 053, 054, 055, 056
- ✅ All new route files use requireAuth + requireTenant at router level
- ✅ No new cross-tenant data access vulnerabilities introduced
- ✅ Migration 056 deployed clean after IMMUTABLE index fix
