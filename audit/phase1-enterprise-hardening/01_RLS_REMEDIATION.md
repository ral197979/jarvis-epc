# Phase 1 — RLS Lockdown Remediation
**Denver Engineering Platform · Security Hardening**
**Status:** ✅ COMPLETE (migration 072 + P1-B + P1-C + P1-E)

---

## Objective

Ensure all tenant-scoped tables have PostgreSQL Row-Level Security enforced, close the X-Tenant-ID header injection vector, tighten tenant registration rate limiting, and fix the IFC event loop block.

---

## P1-A: RLS Gap Analysis

### Methodology

Cross-referenced every table referenced in migrations 001–071 against:
1. Tables with `ENABLE ROW LEVEL SECURITY` in migration history
2. Tables with a `tenant_id` column or FK to a tenant-scoped parent
3. Tables that should be globally visible (system/benchmark/plugin data)

### Tables Without RLS — Disposition

| Table | Has tenant_id | Decision | Rationale |
|-------|---------------|----------|-----------|
| `demo_tenants` | YES (FK) | **ADD RLS** | Contains per-tenant demo data |
| `worker_leases` | OPTIONAL (nullable) | **ADD RLS** | NULL = system lock; non-null = tenant lock |
| `workflow_versions` | NO (via parent) | **ADD RLS** | Isolation via `workflow_id → workflows.tenant_id` |
| `benchmark_cohorts` | NO | EXEMPT — global | Cross-tenant anonymized benchmarks |
| `deployment_health_checks` | NO | EXEMPT — system | Infrastructure monitoring, no tenant data |
| `external_agents` | NO | EXEMPT — global | Shared AI agent registry (migration 056 explicit) |
| `federated_model_versions` | NO | EXEMPT — global | Cross-tenant model federation |
| `federated_patterns` | NO | EXEMPT — global | Cross-tenant pattern library |
| `federated_privacy_audits` | NO | EXEMPT — global | Platform-level privacy audit log |
| `marketplace_playbooks` | NO | EXEMPT — global | Published playbook marketplace |
| `playbook_versions` | NO | EXEMPT — global | Versioned marketplace content |
| `plugin_versions` | NO | EXEMPT — global | Published plugin registry |
| `plugins` | NO | EXEMPT — global | Plugin marketplace |
| `tenants` | IS tenant | EXEMPT — anchor | The tenant table itself cannot be scoped |

### Migration 072 — `api/db/migrations/072_rls_hardening.sql`

Three policies created:

```sql
-- demo_tenants: standard FK isolation
ALTER TABLE demo_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON demo_tenants
  USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

-- worker_leases: NULL tenant_id = system lock (visible to all)
ALTER TABLE worker_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON worker_leases
  USING (tenant_id IS NULL
      OR tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid);

-- workflow_versions: no direct tenant_id — isolation via parent workflows table
ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_versions
  USING (workflow_id IN (
    SELECT id FROM workflows
    WHERE tenant_id = current_setting('app.current_tenant_id', TRUE)::uuid
  ));
```

**Coverage after migration 072:** 212/212 tables protected or explicitly exempt

---

## P1-B: X-Tenant-ID Header Injection — CLOSED

### Vulnerability

`api/middleware/tenant.ts` previously resolved tenant context from three sources in order:
1. JWT `tid` claim
2. **`X-Tenant-ID` HTTP header** ← injection point
3. Subdomain

Any caller could send `X-Tenant-ID: <any-tenant-uuid>` to access another tenant's data on routes that had `requireTenant` but not `requireAuth`. The header was never validated against the authenticated user.

### Fix Applied

Removed the X-Tenant-ID header branch from `requireTenant()`:

```diff
- // 2 — Explicit header (API clients, admin tools)
- if (!tenant) {
-   const headerTid = req.headers['x-tenant-id'] as string | undefined
-   if (headerTid) {
-     tenant = await _lookupById(headerTid)
-   }
- }
+ // Note: X-Tenant-ID header fallback removed (P1-B security hardening).
+ // Tenant must be derived from the verified JWT tid claim on authenticated routes.
+ // The header fallback created a footgun where routes without requireAuth could
+ // accept an arbitrary tenant ID from the caller.
```

Remaining resolution order:
1. JWT `tid` claim (cryptographically verified)
2. Subdomain (e.g., `acme.jarvis.app` → slug `acme`)

### Verification

`api/__tests__/tenantIsolation.test.ts` AV-2 tests:
- ✅ JWT tenant takes precedence over X-Tenant-ID header
- ✅ Unauthenticated request with X-Tenant-ID header is blocked
- ✅ Header-only tenant resolution blocked when requireAuth guards route

---

## P1-C: Registration Rate Limit — TIGHTENED

### Risk

The public `POST /api/v1/tenants` endpoint was limited to **60 registrations per hour per IP**. At that rate, an attacker could create ~600 tenants in 10 minutes (with IP rotation or a /24 subnet), filling the database and potentially enabling denial-of-service via user limit exhaustion against other tenants.

### Fix Applied

`api/routes/tenants.ts` — default max tightened from `60` to `5`:

```diff
- max: Number.isFinite(_regEnv) && _regEnv > 0 ? _regEnv : 60,
+ max: Number.isFinite(_regEnv) && _regEnv > 0 ? _regEnv : 5,
```

`RATE_LIMIT_REGISTER_MAX` environment variable remains available for load testing and staging overrides.

---

## P1-D: TypeScript Strict Mode — CLEAN

Post-sprint TypeScript compilation:

```
$ npm run typecheck
(no output = zero errors)
```

Fixes applied:
- `authMiddleware.test.ts:233` — moved message string from `toBe(403, msg)` to `expect(res.status, msg).toBe(403)` (Vitest API)
- `errorTracking.ts:75` — `@ts-ignore` for optional `@sentry/node` peer dependency
- `errorTracking.ts:81` — explicit `any` type for Sentry `event` parameter
- `errorTracking.ts:165` — `req as unknown as Record<string, unknown>` double-cast

---

## P1-E: IFC Event Loop Block — FIXED

### Risk

`api/services/bim/ifcParseWorker.ts` used `readFileSync` to load IFC files. A large IFC upload (20–500 MB is common for complex MEP models) would block the Node.js event loop for hundreds of milliseconds, degrading all concurrent requests.

### Fix Applied

```diff
- import { readFileSync, existsSync } from 'node:fs'
+ import { readFile } from 'node:fs/promises'
+ import { existsSync } from 'node:fs'

- const buffer = readFileSync(localPath)
+ const buffer = await readFile(localPath)
```

The `existsSync` call (a fast metadata-only check) is intentionally kept synchronous — its overhead is nanoseconds, not milliseconds.

---

## Summary

| Finding | ID | Severity | Status |
|---------|-----|----------|--------|
| Missing RLS on 3 tables | P1-A | HIGH | ✅ Fixed — migration 072 |
| X-Tenant-ID header injection | P1-B | CRITICAL | ✅ Fixed — header removed |
| Tenant registration farming | P1-C | MEDIUM | ✅ Fixed — 5/hr limit |
| TypeScript compilation errors | P1-D | LOW | ✅ Fixed — 0 errors |
| IFC readFileSync blocking | P1-E | MEDIUM | ✅ Fixed — async readFile |
