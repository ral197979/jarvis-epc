# Governance Durability Program (Post-GA)

**Program:** Post-GA Operationalization  
**Domain:** Continuous Governance Assurance  
**Service:** `governanceDurabilityAuditor`  
**Owner:** Denver Engineering — Governance  

---

## Purpose

The Governance Durability Program continuously validates that governance controls remain effective under real production conditions. It monitors pass rates per governance dimension, tracks trends over time, and provides replay drift alerting with sub-1% precision.

---

## Governance Dimensions

| Dimension              | What It Validates                                      |
|-----------------------|--------------------------------------------------------|
| `replay_integrity`    | Replay sessions produce deterministic, consistent output |
| `approval_enforcement`| All high-risk actions have required approvals          |
| `plugin_isolation`    | Plugins cannot access unauthorized tenant resources    |
| `tenant_isolation`    | Cross-tenant data leakage is blocked                   |
| `explainability`      | AI decisions include required explanation metadata     |
| `policy_drift`        | Operational policies have not drifted from baseline    |

---

## Durability Threshold

Governance is **durable** when `passRate >= 0.98` (98%).

Any dimension falling below this threshold triggers a governance durability alert. The threshold is intentionally high — post-GA governance degradation is treated as a critical signal, not a routine operational event.

---

## Governance Trend Classification

Trend is computed from consecutive durability checks:

```
delta = currentPassRate - previousPassRate
```

| Delta        | Trend       | Action Required                        |
|-------------|-------------|----------------------------------------|
| > +0.01     | `improving` | No action                              |
| ±0.01       | `stable`    | Monitor                                |
| < -0.01     | `degrading` | Investigate and remediate within 24h   |

---

## Replay Drift Alerting

Replay drift is monitored per stream/tenant pair. An alert fires when:

```
driftPct = |currentDeterminismRate - baselineDeterminismRate| / baselineDeterminismRate
isAlert = driftPct > 0.01  (1% threshold)
```

The 1% threshold is a zero-tolerance signal. Any drift above this indicates the replay pipeline has diverged from its deterministic baseline and requires immediate investigation.

**Open alert protocol:**
1. `hasOpenReplayDrift(records)` returns `true` when any unresolved alert exists
2. `getOpenReplayDriftAlerts()` retrieves all active alerts for triage
3. Replay drift alerts must be resolved (`resolvedAt` set) before new tenant activations proceed

---

## Non-Negotiable Rules

- Replay drift alerts are append-only. Alerts cannot be deleted, only resolved.
- A `GovernanceDurabilityRecord` is immutable once inserted — historical governance state is preserved for audit.
- Resolved replay drift records retain their `detectedAt` and `driftPct` for audit trail continuity.
- Governance dimension pass rates below 95% trigger an immediate incident regardless of trend direction.

---

## Database Tables

| Table                       | Description                                      |
|----------------------------|--------------------------------------------------|
| `pga_governance_durability` | Per-dimension pass rates and trend history       |
| `pga_replay_drift_records`  | Replay drift events with alert status            |

---

## Operational Runbook

**Recording a governance audit:**
```
recordDurabilityCheck(dimension, passRate, failCount, warnCount, previousPassRate)
```
Durability status and trend are computed automatically.

**Monitoring replay integrity:**
1. After each replay pipeline execution, call `recordReplayDrift(streamId, tenantId, baseline, current)`
2. Check `isReplayDriftAlert(driftPct)` — if true, an alert is raised automatically
3. `getOpenReplayDriftAlerts()` to review active alerts
4. After investigation and fix, call the appropriate resolution endpoint

**Responding to degrading governance:**
1. Identify the degrading dimension from trend records
2. Cross-reference with recent platform changes (deployments, config updates)
3. Engage the governance owner for that dimension
4. Target restoration to ≥ 98% pass rate within one operational cycle
