# Executive Risk Summary
**Denver Engineering / Ava Platform — v13.0.0**
**Audit Date:** 2026-05-12
**Auditor:** Claude (automated static + runtime analysis)

---

## Overall Platform Score: 83 / 100

| Domain | Score | Status |
|--------|-------|--------|
| Tenant Isolation | 72/100 | ⚠️ CONDITIONAL |
| Governance Integrity | 88/100 | ✅ PASS |
| Ecosystem Trust / DP | 92/100 | ✅ PASS |
| Deployment Health | 80/100 | ✅ PASS |
| **Composite** | **83/100** | ⚠️ GO WITH RESTRICTIONS |

---

## Risk Register

### 🔴 P0 — CRITICAL (Must fix before expanding user access)

**TENANT-001: Unauthenticated tenantId injection on agent routes**
- **What:** Routes at `/api/v1/agents/*` and `/api/v1/agents/approvals`, `/agents/memory`, `/agents/risk` accept `tenantId` from request body / query params with no authentication middleware.
- **Impact:** Any unauthenticated caller knowing a tenant UUID can read agent tasks, pending AI approvals, memory entries, and submit orchestration plans attributed to that tenant.
- **Files:** `api/routes/agents.ts`, `agentApprovals.ts`, `agentMemory.ts`, `agentRisk.ts`
- **Fix (30 min):** Add `router.use(requireAuth as never, requireTenant() as never)` at the top of each router, then replace `req.body.tenantId` / `req.query.tenantId` with `(req as TenantRequest).tenantId`.

---

### 🟡 P1 — HIGH (Fix within 1 sprint)

**TENANT-002: Functional dead zones — twinRouter, scenariosRouter, optimizationRouter**
- **What:** These routers cast `req.tenantId` without auth middleware. Runtime value is `undefined`, making all endpoints non-functional.
- **Impact:** `/api/v1/twins`, `/api/v1/scenarios`, `/api/v1/optimization` — all endpoints silently fail or return DB errors.
- **Fix (1 hr):** Add `requireAuth + requireTenant` at mount points in `server.ts` (lines 394–398).

**TENANT-003: 3 tables missing RLS**
- `tenant_lifecycle_events` — contains tenant state machine transitions
- `tenant_subscriptions` — billing-sensitive
- `external_agents` / `external_agent_executions` — external agent calls
- **Fix:** Add `ENABLE ROW LEVEL SECURITY` + standard policy in a new migration `056_rls_backfill.sql`.

---

### 🟡 P2 — MEDIUM (Fix within 2 sprints)

**DP-001: No k-anonymity enforcement on federated aggregation**
- Single-tenant cohorts can be released with DP noise that still reveals the individual tenant's data at small scales.
- **Fix:** Gate `federatedAggregationWorker` to suppress releases where cohort count < 5.

**RATE-001: No rate limiting on agent orchestration endpoints**
- `/api/v1/agents/orchestrate` is unprotected from abuse.
- **Fix:** Apply `aiLimiter` or a new agent-specific limiter.

**TOKEN-001: IoT ingest tokens have no expiry**
- Tokens live indefinitely. Leaked tokens cannot be auto-revoked.
- **Fix:** Add `expires_at` column and check in `resolveIngestToken`.

---

### 🟢 P3 — LOW (Backlog)

**POOL-001: 4 route files use raw `pool.query` instead of `tenantQuery`**
- ops.ts, readiness.ts, sync.ts, evidence.ts — compensate with manual WHERE tenant_id clauses, but bypass PostgreSQL RLS session variable.

**LOG-001: 4 `.catch(() => {})` blocks silently swallow errors**
- externalAgentGateway, federatedAggregationWorker, apiGatewayService, simulationRouter.
- **Fix:** Replace with `logger.warn(err)`.

**AGENT-001: External agent signature verification is optional**
- Incoming external agent calls have an optional `signature` field but no enforcement.

---

## Positive Findings (What's Working Well)

✅ **Laplace DP fully implemented** — both federatedIntelligenceEngine and federatedAggregationWorker use correct Laplace(0, Δf/ε) mechanism, ε=1.0

✅ **Audit chain hash** — `auditVerifier.ts` computes chain hash over ordered events and detects gaps, stored in `audit_integrity_snapshots`

✅ **Replay integrity wired** — `replayIntegrityAuditor`, `governanceRegressionMonitor`, and `migrationSafetyValidator` all reference replay integrity checks

✅ **All v10.x migrations (053–055) fully RLS-compliant** — EVM, Schedule Import, IoT all correct

✅ **IoT ingest token security** — SHA-256 hashed, length-based detection, one-time display warning

✅ **Worker lifecycle management** — both background workers have clean start/stop in server.ts

✅ **Idempotent migrations** — DO/EXCEPTION pattern, CREATE IF NOT EXISTS, UPSERT id_map

✅ **canAutoApprove gate** — all AI auto-approvals gated through trust score + flag count check

✅ **91.4% RLS table coverage** — strong baseline across 197 tables
