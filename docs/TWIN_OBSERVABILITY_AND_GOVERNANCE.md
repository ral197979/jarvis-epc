# Twin Observability and Governance

**Denver Engineering — Ava Phase 6 (v6.0.0)**

## Overview

Observability in the twin layer means every state change is auditable, every sync is measurable, and every anomaly is traceable. Governance means twin mutations respect the same policy constraints as all other system actions.

## Observability Primitives

### Snapshot Integrity
Every snapshot carries a SHA-256 checksum:
```typescript
checksum = sha256(JSON.stringify(state))
```
`verifySnapshot(snapshot)` recomputes and compares. Checksum mismatch indicates either data corruption or unauthorized mutation.

### Sync Lag Metrics
`sync_lag_ms` on `operational_twins` tracks how long each sync cycle took. Aggregated for alerting:
- > 5 seconds: warn
- > 30 seconds: alert to ops team

### Snapshot Frequency (State Velocity)
`computeStateVelocity()` returns `changesPerDay`. Expected baseline is 3–8 changes/day for active projects. Values > 20/day trigger `high_state_velocity` anomaly.

### Event Linkage
`twin_event_links` maps every state delta back to the source event in `realtime_event_log`. Complete causal chain: `event → delta → snapshot → twin`.

## Audit Trail

Every write through the standard routes (`POST /api/v1/twins`, `PATCH /:twinId/status`, etc.) is captured by the audit middleware in `server.ts`:
- `action: create | update`
- `resource: twins`
- `resource_id: <twin UUID>`
- `new_data: <redacted request body>`

Snapshots additionally provide content-level audit: the `diff` field shows exactly what changed between any two points.

## Governance Model

### Tenant Isolation
All twin tables have RLS enabled with `tenant_isolation` policy:
```sql
CREATE POLICY tenant_isolation ON operational_twins
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```
Cross-tenant data leakage is impossible at the database level.

### Agent Governance for Twin Mutations
When Phase 5 agents mutate twins, they must pass through `checkGovernance`:
- Policy type `freeze_condition` → blocks all mutations during project freezes
- Policy type `approval_requirement` → requires human sign-off for status changes
- Policy type `ai_confidence_minimum` → requires confidence ≥ threshold for risk score updates

### Simulation Isolation
Scenario simulations are isolated via `isolation_token` (UUID) and never write to production tables. The `scenario_simulations` table is the only destination for simulation results.

### Read-Only API Pattern
The graph traversal, risk propagation, and temporal query APIs are purely read-only. They build state graphs from existing data without any mutations.

## Monitoring Checklist

| Metric | Expected Range | Alert Threshold |
|--------|---------------|----------------|
| `sync_lag_ms` | < 500ms | > 5,000ms |
| `changesPerDay` | 3–8 | > 20 |
| Stale twins (> 5 min) | < 5% | > 20% |
| Open anomalies (critical) | 0 | ≥ 1 |
| Forecast cache hit rate | > 80% | < 50% |

## Health Endpoint

The existing `/api/v1/health` endpoint reflects DB pool health. Twin-specific health is surfaced via:
```
GET /api/v1/twins/graph/overview
→ { nodeCount, edgeCount, degradedCount, builtAt }
```

Degraded count > 0 is the primary operational health signal for the twin layer.
