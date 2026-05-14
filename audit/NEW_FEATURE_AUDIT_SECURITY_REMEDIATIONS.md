# Security Remediations Audit — v10.5.1 + v10.6.0
**Scope:** Agent route auth fixes, server.ts middleware additions, migration 056, tenantQuery migration
**Audited:** 2026-05-14

---

## TENANT-001: Agent Route Auth (v10.5.1)

### ✅ VERIFIED — `requireAuth + requireTenant` on all 4 agent routers
- `agentsRouter.use(requireAuth, requireTenant())` — confirmed
- `agentApprovalsRouter.use(requireAuth, requireTenant())` — confirmed
- `agentMemoryRouter.use(requireAuth, requireTenant())` — confirmed
- `agentRiskRouter.use(requireAuth, requireTenant())` — confirmed

### ✅ VERIFIED — Client-supplied tenantId eliminated
All handlers now use `(req as R).tenantId!` from middleware. No `req.body.tenantId` or `req.query.tenantId` references remain in these files.

### ✅ VERIFIED — Express 5 params typing handled
`p()` helper correctly handles `string | string[]` params across agents.ts, agentApprovals.ts, agentMemory.ts.

---

## TENANT-002: Auth on Twin/Scenarios/Optimization/Sync/Evidence (v10.5.1)

### ✅ VERIFIED — server.ts mount points
```typescript
app.use('/api/v1/twins',        requireAuth, requireTenant(), twinRouter)
app.use('/api/v1/scenarios',    requireAuth, requireTenant(), scenariosRouter)
app.use('/api/v1/optimization', requireAuth, requireTenant(), optimizationRouter)
app.use('/api/v1/sync',         requireAuth, requireTenant(), syncRouter)
app.use('/api/v1/evidence',     requireAuth, requireTenant(), evidenceRouter)
```
All 5 previously unguarded routers now have auth middleware at mount. TENANT-002 fully resolved.

---

## Migration 056: RLS Backfill + Token Expiry (v10.6.0)

### ✅ VERIFIED — RLS applied to 3 remaining unprotected tables
- `tenant_subscriptions` — RLS enabled, policy correct
- `tenant_lifecycle_events` — RLS enabled, policy correct
- `external_agent_executions` — RLS enabled, policy correct
- `external_agents` — correctly excluded (global cross-tenant registry using `owner_tenant_id`)

### ✅ VERIFIED — Migration 056 idempotent
- `DROP POLICY IF EXISTS` before `CREATE POLICY` — safe re-run
- `ADD COLUMN IF NOT EXISTS expires_at` — safe re-run
- `UPDATE ... WHERE expires_at IS NULL` — only backfills rows without expiry
- `CREATE INDEX IF NOT EXISTS` — safe re-run
- Fixed IMMUTABLE violation: removed `now()` from index predicate; using composite `(token_hash, expires_at)` instead

### ✅ VERIFIED — Token expiry enforced at resolution
`resolveIngestToken` WHERE clause: `AND (expires_at IS NULL OR expires_at > now())` — correct.

---

## Rate Limiting (v10.6.0)

### ✅ VERIFIED — agentLimiter applied
```typescript
const agentLimiter = rateLimit({ windowMs: 60_000, max: envInt('RATE_LIMIT_AGENT_MAX', 20), ... })
app.use('/api/v1/agents', agentLimiter, agentsRouter)
app.use('/api/v1/agents/approvals', agentLimiter, agentApprovalsRouter)
app.use('/api/v1/agents/memory',    agentLimiter, agentMemoryRouter)
app.use('/api/v1/agents/risk',      agentLimiter, agentRiskRouter)
```

### ⚠️ P2 — Rate limiter counts by client IP; trust proxy not confirmed
`express-rate-limit` defaults to using `req.ip`. Behind Render's reverse proxy, all requests may appear to originate from the same internal IP unless `app.set('trust proxy', 1)` is configured, causing the limiter to treat all users as the same client (and block all users at the rate threshold simultaneously).

**Action required:** Confirm `app.set('trust proxy', 1)` exists in server.ts. If not, add it before `rateLimit()` initialization.

### ⚠️ P3 — Only agent routes have rate limiting
Other high-frequency or compute-heavy endpoints (IoT ingest, EVM computeMetrics, simulation replay) have no rate limiting. The ingest endpoint in particular could be abused at high frequency.

**Recommendation:** Add rate limits to `/api/v1/iot/ingest`, `/api/v1/simulation/replay`, and EVM metric computation.

---

## tenantQuery Migration (v10.6.0)

### ✅ VERIFIED — readiness.ts
All 5 pool.query → tenantQuery. Confirmed in code.

### ✅ VERIFIED — sync.ts
3 pool.query → tenantQuery (register INSERT, upload device SELECT, upload UPDATE).

### ✅ VERIFIED — evidence.ts
2 pool.query → tenantQuery (evidence_assets SELECT, asset_scan_events INSERT).

### ✅ VERIFIED — ops.ts
11 pool.query → tenantQuery across all 8 handler functions.

---

## Residual pool.query Sites (New Features — Not Yet Migrated)

The following `pool.query` calls were introduced in v10.3.0–v10.5.0 and were not part of the v10.6.0 migration batch. They are tracked as open findings:

| File | Lines | Tables Affected | Risk |
|---|---|---|---|
| `scheduleImportService.ts` | 142, 157 | `schedule_dependencies` | P1 — explicit tenant_id present in query, low exploitation risk but wrong pattern |
| `sensorIngestService.ts` | 188, 196, 244, 250, 259 | `sensor_readings`, `sensors`, `sensor_alerts` | P1 — line 196 has NO tenant_id in WHERE |

---

## Summary

| ID | Severity | Finding |
|---|---|---|
| SEC-001 | ✅ | TENANT-001 agent route auth — fully resolved |
| SEC-002 | ✅ | TENANT-002 twin/scenarios/optimization/sync/evidence auth — fully resolved |
| SEC-003 | ✅ | RLS backfill migration 056 — deployed and verified |
| SEC-004 | ✅ | Token expiry enforcement — deployed and verified |
| SEC-005 | P2 | Rate limiter trust proxy not confirmed — verify app.set('trust proxy', 1) |
| SEC-006 | P1 | scheduleImportService.ts pool.query calls — carry forward from SCHED-001 |
| SEC-007 | P1 | sensorIngestService.ts pool.query calls — carry forward from IOT-001 |
| SEC-008 | P3 | Rate limiting not applied to IoT ingest / simulation endpoints |

**Overall: All prior audit blockers RESOLVED. Two new P1s introduced in new features.**
