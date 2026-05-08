# Support Excellence Operations (Post-GA)

**Program:** Post-GA Operationalization  
**Domain:** Support Operations & Incident Management  
**Service:** `supportOperationsCoordinator`  
**Component:** N/A (backend service only)  
**Owner:** Denver Engineering — Customer Support  

---

## Purpose

Support Excellence Operations tracks every support interaction after GA — from initial ticket creation through resolution — with emphasis on replay-assisted diagnostics, root cause identification, and incident clustering. It provides the analytics backbone for measuring support quality and identifying systemic failure patterns.

---

## Support Operations Record

Each `SupportOperationsRecord` represents a single support engagement:

| Field                 | Description                                                  |
|----------------------|--------------------------------------------------------------|
| `tenantId`           | Tenant associated with the support operation                 |
| `incidentId`         | Optional external incident system reference                  |
| `clusterType`        | Incident cluster classification (nullable for unclassified)  |
| `replayAssisted`     | Whether replay diagnostics were used to resolve              |
| `resolutionTimeMs`   | Time from creation to resolution in milliseconds (null if unresolved) |
| `rootCauseIdentified`| Whether a definitive root cause was documented               |
| `escalationTier`     | Support tier: `l1`, `l2`, `l3`, or `engineering`            |
| `satisfactionScore`  | Post-resolution CSAT score (nullable)                        |
| `resolvedAt`         | Resolution timestamp (null if still open)                    |

---

## Incident Cluster Types

| Cluster Type              | Description                                      |
|--------------------------|--------------------------------------------------|
| `replay_failure`         | Failures in replay session execution             |
| `onboarding_blocker`     | Issues preventing tenant onboarding completion   |
| `performance_degradation`| Latency or throughput degradation incidents      |
| `governance_violation`   | Policy or governance constraint violations       |
| `integration_failure`    | Third-party integration breakdowns               |

Records without a cluster type are unclassified and excluded from cluster analytics.

---

## SLA Target

The platform SLA target for critical support resolution is **4 hours**:

```
SUPPORT_RESOLUTION_TARGET_MS = 14,400,000 ms (4 hours)
```

A support operation is **SLA-breached** when `resolutionTimeMs > 14,400,000`. Unresolved operations (`resolutionTimeMs === null`) are not considered breached — they are open incidents.

---

## Escalation Tiers

| Tier          | Scope                                         |
|--------------|-----------------------------------------------|
| `l1`         | Front-line support; common issues             |
| `l2`         | Technical support; escalated issues           |
| `l3`         | Senior technical support; complex issues      |
| `engineering`| Engineering team involvement required         |

Escalation tier is set at creation and reflects the expected complexity of resolution.

---

## Support Analytics

### Replay-Assisted Rate

Measures how frequently resolved incidents used replay diagnostics:

```
replayAssistedRate = resolvedWithReplay / totalResolved
```

Only resolved operations (where `resolvedAt !== null`) are counted. An unresolved operation does not contribute.

### Root Cause Rate

```
rootCauseRate = resolvedWithRootCause / totalResolved
```

A high root cause rate indicates systematic diagnosis quality. Low rates indicate surface-level fixes without understanding.

### Average Satisfaction

```
avgSatisfaction = sum(satisfactionScore) / count(scoredRecords)
```

Only records with a non-null `satisfactionScore` contribute. Records without a score are excluded.

---

## Incident Cluster Analysis

The `buildIncidentClusters()` function groups resolved support operations by cluster type and computes:

| Cluster Metric         | Calculation                                |
|-----------------------|--------------------------------------------|
| `count`               | Total incidents of this type               |
| `avgResolutionMs`     | Average resolution time for the cluster    |
| `rootCauseRate`       | Fraction with identified root cause        |
| `replayAssistedRate`  | Fraction resolved with replay assistance   |

Clusters with a high `avgResolutionMs` and low `rootCauseRate` are candidates for systematic investigation.

---

## Tenant Isolation

- `createSupportOperation()` uses `pool.query()` — admin write
- `resolveSupportOperation()` uses `pool.query()` — admin write
- `getTenantSupportHistory()` uses `tenantQuery()` — RLS-enforced tenant read
- `getOpenOperations()` uses `pool.query()` — admin-level cross-tenant view

---

## Operational Runbook

**Opening a support operation:**
1. `createSupportOperation(tenantId, incidentId, clusterType, escalationTier)`
2. Assign to appropriate tier based on reported severity
3. Begin replay-assisted diagnosis if applicable

**Resolving a support operation:**
1. `resolveSupportOperation(recordId, resolutionTimeMs, replayAssisted, rootCauseIdentified, satisfactionScore)`
2. Record `replayAssisted: true` if replay diagnostics contributed to resolution
3. Record `rootCauseIdentified: true` only if a documented root cause exists
4. Check `isSLABreached(resolutionTimeMs)` — escalate if breached

**Weekly support quality review:**
1. `getOpenOperations()` — review all unresolved incidents
2. `getTenantSupportHistory(tenantId)` — per-tenant support pattern review
3. `buildIncidentClusters(records)` — identify systemic failure patterns
4. `computeReplayAssistedRate(records)` — target: maximize replay-assisted resolution
5. `computeRootCauseRate(records)` — target: every resolved incident has a root cause

**Responding to cluster spikes:**
- `replay_failure` cluster spike → escalate to replay integrity team immediately
- `governance_violation` cluster spike → escalate to governance owner within 24h
- `onboarding_blocker` cluster spike → assign onboarding specialist and review deployment gates
- `performance_degradation` cluster spike → cross-reference with telemetry `severe` drift records

---

## Database Tables

| Table                        | Description                                        |
|-----------------------------|-----------------------------------------------------|
| `pga_support_operations`    | Support records with resolution and cluster data    |
