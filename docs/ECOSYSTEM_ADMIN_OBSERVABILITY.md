# Ecosystem Admin Observability

## Overview

The Ecosystem Admin layer provides cross-tenant visibility into platform health, data quality, and compliance posture. Unlike tenant-scoped queries (which use `tenantQuery`), admin observability functions use the raw `pool` connection to bypass Row-Level Security and access all tenant data.

## Admin-Only Functions

| Service | Function | Description |
|---|---|---|
| `edgeNodeService` | `getAllEdgeNodeStatuses()` | Cross-tenant view of all edge nodes |
| `federatedIntelligenceEngine` | `getPrivacyAudits(contributionId)` | Audit trail for a contribution |
| `pluginRegistryService` | `triggerKillSwitch(pluginId, actor)` | Platform-wide plugin disable |
| `externalAgentGateway` | `listExternalAgents()` | Cross-tenant agent listing |
| `certificationEvidenceService` | `listCertificationExports(tenantId)` | Compliance export history |
| `benchmarkingService` | `computeAndStoreCohort(input)` | Admin: recompute cohort |

## Query Isolation by Role

```
tenantQuery(tenantId, sql, params)
  → Adds tenant_id filter to all queries
  → RLS enforced at DB level
  → Used by all tenant-facing operations

pool.query(sql, params)
  → Bypasses RLS
  → Admin-only operations
  → Cross-tenant reads/writes require explicit justification
```

## Platform Health Signals

### Edge Node Health

`getAllEdgeNodeStatuses()` returns:

```typescript
Array<{ tenantId, nodeId, status, lastSeenAt }>
```

Nodes with `lastSeenAt` older than the expected heartbeat interval are flagged for investigation. Nodes with `status = 'decommissioned'` have been revoked and should not appear in active monitoring.

### Plugin Health

`listPlugins()` excludes `kill_switch = TRUE` plugins. The kill switch count and active plugin count are key health metrics for the platform plugin ecosystem.

### Federated Intelligence Quality

Privacy audit records (`federated_privacy_audits`) track whether contributions met opt-in, k-anonymity, and data quality checks. A high rejection rate signals data quality or integration issues.

## Compliance Dashboard Signals

| Signal | Source | Threshold |
|---|---|---|
| Contributions opted in | `federated_consent.enabled` | > 0 per tenant |
| Patterns published | `federated_patterns.is_active` | K >= 5 contributors |
| Cohorts suppressed | `benchmark_cohorts.suppressed` | < 10% of cohorts |
| Exports generated | `compliance_exports.status = 'completed'` | Quarterly minimum |
| Dead-letter events | `automation_events.retry_count >= 3` | < 1% of events |

## Audit Architecture

All mutation operations in ecosystem services emit audit records to dedicated audit tables:
- `federated_privacy_audits` — contribution privacy events
- `plugin_audit_events` — plugin lifecycle events
- `compliance_exports` — certification export immutable log

These tables are append-only by convention. No DELETE operations exist on audit tables.

## Related Services

All 12 Phase 9 ecosystem services contribute to the admin observability surface. The admin dashboard aggregates their outputs into a unified platform health view.
