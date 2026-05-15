# Tenant Isolation Audit
**Denver Engineering / Ava Platform — v13.0.0**
**Audit Date:** 2026-05-12

---

## Summary
**Score: 72 / 100 — CONDITIONAL PASS (P0 issues require remediation)**

---

## RLS Coverage

| Metric | Count |
|--------|-------|
| Total tables (CREATE TABLE) | 197 |
| Tables with ENABLE ROW LEVEL SECURITY | 180 |
| Coverage rate | **91.4%** |

### Tables Without RLS (18 gap)
Intentionally excluded system / global tables (no tenant data):
- `tenants`, `schema_migrations`, `worker_leases`, `demo_tenants`, `deployment_health_checks`
- `plugins`, `plugin_versions`, `marketplace_playbooks`, `benchmark_cohorts`
- `transmittal_counters` (aggregation counter, no PII)

Tables that **should** have RLS but appear to lack it:
- `tenant_lifecycle_events` — contains per-tenant state transitions ⚠️
- `tenant_subscriptions` — billing-sensitive ⚠️
- `external_agents`, `external_agent_executions` — cross-tenant agent calls ⚠️
- `federated_model_versions`, `federated_patterns`, `federated_privacy_audits` — intended cross-tenant (DP-protected), acceptable without RLS

---

## Raw `pool.query` (Bypasses RLS Session Variable)

The following service files use raw `pool.query` instead of `tenantQuery`. `tenantQuery` sets `app.current_tenant_id` via `SET LOCAL`, which activates the PostgreSQL RLS policies. Raw pool calls bypass this mechanism. They compensate with manual `WHERE tenant_id = $N` clauses, but this creates a dual-enforcement model where one defense layer (RLS) is absent.

**Affected files:**
| File | Calls | Risk |
|------|-------|------|
| `api/routes/ops.ts` | 15+ | Medium — manually passes tenantId |
| `api/routes/readiness.ts` | 5 | Medium — manually passes tenantId |
| `api/routes/sync.ts` | 2 | Medium — manually passes tenantId |
| `api/routes/evidence.ts` | 2 | Medium — manually passes tenantId |
| `api/realtime/eventBroadcaster.ts` | 3 | Low — fires async events |
| `api/services/ecosystem/pluginRegistryService.ts` | 10+ | Low — plugin registry is global |
| `api/db/migrate.ts` | 2 | Acceptable — migration runner |
| `api/db/pool.ts` | 1 | Acceptable — pool wrapper |

**Recommendation:** Migrate ops.ts, readiness.ts, sync.ts, and evidence.ts to `tenantQuery`.

---

## P0: Client-Supplied TenantId — Unauthenticated Cross-Tenant Access

**Severity: CRITICAL**

The following route files do NOT apply `requireAuth` or `requireTenant` middleware. Instead they accept `tenantId` directly from request body or query parameters. Any unauthenticated caller can supply any valid tenant UUID and access that tenant's data.

| Route Prefix | File | TenantId Source | Risk |
|---|---|---|---|
| `/api/v1/agents` | `agents.ts` | `req.body.tenantId` / `req.query.tenantId` | 🔴 CRITICAL |
| `/api/v1/agents/approvals` | `agentApprovals.ts` | `req.query.tenantId` | 🔴 CRITICAL |
| `/api/v1/agents/memory` | `agentMemory.ts` | `req.query.tenantId` (likely) | 🔴 CRITICAL |
| `/api/v1/agents/risk` | `agentRisk.ts` | `req.query.tenantId` (likely) | 🔴 CRITICAL |

**Exposed operations:**
- List/read agent tasks for any tenant
- List pending AI governance approvals for any tenant
- Submit orchestration plans attributed to any tenant
- Read agent memory entries for any tenant

**Routes with broken tenantId injection (functional failures, not leakage):**
- `/api/v1/twins` — casts `req.tenantId` without middleware; runtime value is `undefined`
- `/api/v1/scenarios` — same
- `/api/v1/optimization` — same

These routes will return errors or empty results (not cross-tenant data) but are functionally dead.

---

## Remediation Priority

1. **Immediate (P0):** Add `requireAuth as never, requireTenant() as never` to `agentsRouter`, `agentApprovalsRouter`, `agentMemoryRouter`, `agentRiskRouter` — either at route mount in `server.ts` or inside each router with `router.use(...)`.
2. **Short-term (P1):** Add `requireAuth + requireTenant` to `twinRouter`, `scenariosRouter`, `optimizationRouter` in `server.ts`.
3. **Medium-term (P2):** Add RLS to `tenant_lifecycle_events`, `tenant_subscriptions`, `external_agents`, `external_agent_executions`.
4. **Backlog (P3):** Migrate `ops.ts`, `readiness.ts`, `sync.ts`, `evidence.ts` pool.query calls to `tenantQuery`.
