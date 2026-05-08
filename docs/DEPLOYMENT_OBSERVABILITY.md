# Deployment Observability

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Overview

The Deployment Health Service provides SRE-oriented visibility into platform operational status. It records named health checks with structured pass/warn/fail signals and generates consolidated health reports.

## Health Check Model

```typescript
interface DeploymentHealthCheck {
  checkName: string             // e.g., 'database.connectivity'
  status: 'passing' | 'warning' | 'failing'
  message?: string              // human-readable detail
  value?: number                // measured value (e.g., latency in ms)
  threshold?: number            // threshold for warn/fail
  metadata: Record<string, unknown>
  checkedAt: Date
}
```

## Built-in Platform Checks

`runPlatformChecks()` executes three checks concurrently using `Promise.allSettled`:

| Check Name | What It Measures | Warn Threshold | Fail Condition |
|------------|-----------------|----------------|----------------|
| `database.connectivity` | DB response latency | > 500ms | DB unreachable |
| `platform.tenant_count` | Total registered tenants | — | Query fails |
| `platform.subscriptions` | Active + trial counts | — | Query fails |

All checks use `pool.query` directly (not `tenantQuery`) — health checks are admin-level, not tenant-scoped.

## Health Report

`generateHealthReport()` uses `DISTINCT ON (check_name)` ordered by `checked_at DESC` to get the latest result for each check, avoiding full-table aggregation:

```sql
SELECT DISTINCT ON (check_name) *
FROM deployment_health_checks
ORDER BY check_name, checked_at DESC
```

`overall` status:
- `'unhealthy'` — any `failing` check
- `'degraded'` — no `failing` but any `warning`
- `'healthy'` — all `passing` (or no checks)

## External Checks

External systems (monitoring agents, CI/CD pipelines) can push check results via `POST /enterprise/deployment/health/check`. This allows third-party health signals to appear in the consolidated report alongside built-in checks.

## No RLS

`deployment_health_checks` has **no Row-Level Security** — it is a global platform table, not tenant-scoped. Access is restricted to authenticated admin routes only.

## Naming Convention

Check names use dot-notation by domain:
- `database.*` — DB connectivity, pool health
- `platform.*` — tenant/subscription counts
- `queue.*` — job queue depth, processing lag
- `cache.*` — Redis/cache hit rates
- `storage.*` — S3/blob availability
