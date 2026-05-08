# Support Operations Manual — Phase 11

**Denver Engineering · GA Operations**
**Version:** 11.0.0

---

## Overview

This manual covers support triage, incident clustering, escalation, and resolution workflows for GA production operations. The `SupportCommandCenter` and `IncidentClusterViewer` are the primary UIs. Backend logic lives in `supportTriageEngine` and `incidentCorrelationService`.

---

## Triage Queue

### Priority Classification

`supportTriageEngine.suggestPriority` assigns priority:

| Condition | Priority |
|---|---|
| `clusterType === 'replay_divergence'` OR `'auth_failure'` | `critical` |
| `affectedTenantCount >= 100` | `critical` |
| `clusterType === 'queue_saturation'` OR `'billing_lag'` | `high` |
| `affectedTenantCount >= 10` | `high` |
| `clusterType === 'import_failure'` OR `'integration_error'` | `medium` |
| `affectedTenantCount >= 3` | `medium` |
| Default | `low` |

### Engineering Escalation

`shouldEscalateToEngineering` returns `true` when:
- `priority === 'critical'`
- `clusterType === 'replay_divergence'`
- `clusterType === 'unknown'`

These bypass CSM triage and go directly to the engineering on-call queue.

---

## Incident Cluster Types

`classifyClusterType` matches keywords in title and description (case-insensitive):

| Cluster Type | Keywords |
|---|---|
| `replay_divergence` | replay, diverge, hash mismatch |
| `auth_failure` | auth, login, unauthorized, forbidden |
| `import_failure` | import, migration, ingest |
| `queue_saturation` | queue, backlog, saturated |
| `billing_lag` | billing, invoice, payment |
| `integration_error` | integration, webhook, sync |
| `performance_degradation` | slow, latency, timeout, degraded |
| `unknown` | (no keyword match) |

---

## Incident Cluster Lifecycle

### Cluster Creation

A cluster is created (or retrieved) via `getOrCreateCluster`. The cluster is considered **significant** when `incidentCount >= 3` (`INCIDENT_CLUSTER_MIN_COUNT`).

### Cluster Severity

`computeClusterSeverity` based on scope:

| Condition | Severity |
|---|---|
| ≥ 10 affected tenants OR ≥ 20 incidents | `critical` |
| ≥ 5 tenants OR ≥ 10 incidents | `high` |
| ≥ 3 tenants or incidents | `medium` |
| Below all thresholds | `low` |

### Cluster Resolution

1. Click **Resolve** in `IncidentClusterViewer`
2. Enter root cause in the inline form
3. System calls `POST /api/phase11/clusters/:id/resolve` with rootCause
4. `resolvedAt` timestamp set, cluster status updated
5. Affected tenants notified via standard communication template

---

## Suggested Actions by Cluster Type

`generateSuggestedActions` returns 3 actions per cluster type:

| Cluster Type | Actions |
|---|---|
| `replay_divergence` | Check replay hash chain, Re-run divergent events, Escalate to replay team |
| `auth_failure` | Review auth logs, Check token expiry, Reset affected tenant auth |
| `import_failure` | Review import error log, Re-run failed batches, Verify schema mapping |
| `queue_saturation` | Scale queue workers, Drain backlog manually, Check message TTL |
| `billing_lag` | Sync billing provider, Retry failed invoices, Review billing config |
| `integration_error` | Check webhook endpoints, Review integration logs, Re-register webhooks |
| `performance_degradation` | Check DB query plans, Review cache hit rates, Scale compute resources |
| `unknown` | Review error logs, Escalate to engineering, Monitor for pattern |

---

## Support Command Center Layout

The `SupportCommandCenter` has two tabs:

### Triage Queue Tab
- Left panel: list of triage records sorted by priority
- Right panel: detail view with cluster info and suggestedActions
- Priority color coding: critical=red, high=orange, medium=yellow, low=gray

### Incident Clusters Tab
- Filterable by cluster status
- Expandable cards: tenant count, incident count, severity badge
- **Monitor** button: marks cluster as under investigation
- **Resolve** button: opens root cause input form

---

## Tenant Health Escalations

`tenantHealthEscalation` generates alerts for the support queue:

### Health Score Alerts
- Score ≥ 70: no alert
- Score 40–69: `warning` — CSM outreach
- Score < 40: `critical` — immediate intervention

### Adoption Stall Alerts
- Adoption ≥ 60% AND days < 14: no alert
- Days ≥ 30 OR adoption < 20%: `critical`
- Otherwise (days ≥ 14 OR adoption < 40%): `warning`

### Incident Spike Alerts
- < 3 incidents: no alert
- 3–9 incidents: `warning`
- ≥ 10 incidents: `critical`

---

## On-Call Runbooks

### Replay Divergence (P0)

1. Page engineering on-call immediately
2. Check `realWorldReplayValidator.hasDivergence`
3. Identify affected tenant(s) from cluster
4. Pause affected tenant's replay queue
5. Run `computeReplayHash` comparison to identify divergent events
6. Restore from last known-good replay checkpoint
7. Re-run events from checkpoint with determinism validation
8. Verify `isDeterminismAcceptable` returns `true` (requires 100% determinism)
9. Resume replay queue
10. Post-incident review within 24 hours

### Queue Saturation (P1)

1. Verify fill rate > 80% via `productionTelemetryEngine`
2. Check `adaptivePerformanceTuner.recommendQueueConcurrency`
3. Apply recommended tuning via `operationalTuningService.applyTuningConfig`
4. Monitor fill rate for 15 minutes
5. If not improving: manually scale worker count
6. If still not improving: identify enqueuing tenant and apply rate limit

### Auth Failure Spike (P1)

1. Confirm cluster via `incidentCorrelationService`
2. Check if auth provider is reachable (external dependency)
3. Review recent deployment for auth-related changes
4. Check tenant-specific vs. platform-wide scope
5. If platform-wide: activate incident page and notify all tenants
6. If tenant-specific: isolate and contact affected tenant

---

## SLA Targets

| Priority | First Response | Resolution Target |
|---|---|---|
| Critical | 15 minutes | 4 hours |
| High | 1 hour | 24 hours |
| Medium | 4 hours | 72 hours |
| Low | 1 business day | 1 week |
