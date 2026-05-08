# Executive Operations Center (Post-GA)

**Program:** Post-GA Operationalization  
**Domain:** Unified Executive Visibility  
**Service:** `/api/postGA/executive/summary` (composite API endpoint)  
**Component:** `ExecutiveOperationsCenterV2`  
**Owner:** Denver Engineering — Leadership Engineering  

---

## Purpose

The Executive Operations Center provides a single, unified view of all Post-GA program health for operational leadership. It aggregates signals from five operational domains — tenant launch, customer adoption, ecosystem trust, governance & replay integrity, and support operations — into a single dashboard with real-time status indicators and actionable alerts.

---

## Dashboard Sections

### 1. Tenant Launch

Displays the active rollout wave pipeline status:

| KPI                      | Source                                          | Health Threshold   |
|-------------------------|-------------------------------------------------|--------------------|
| Active wave count        | `pga_rollout_waves` (status = active)          | ≥ 1 = operational  |
| Wave success rate        | `deployedCount / (deployedCount + failedCount)`| ≥ 80% = healthy    |
| Tenants deployed         | Sum of `deployedCount` across active waves     | —                  |
| Tenants failed           | Sum of `failedCount` across active waves       | 0 = ideal          |

Wave success rate below 80% triggers a `warn` or `bad` status indicator.

---

### 2. Customer Adoption

Tracks tenant adoption health across the platform:

| KPI                       | Source                          | Health Threshold              |
|--------------------------|---------------------------------|-------------------------------|
| Platform adoption score   | `computeAdoptionScore()`        | ≥ 65 = healthy                |
| At-risk tenant count      | `getAtRiskTenants()` (churn ≥ 0.35) | 0 = ideal              |
| Champion tenant count     | Tenants with tier = `champion`  | Maximize                      |
| Average churn risk        | Mean `churnRisk` across tenants | < 0.35 = healthy              |

Adoption score below 65 or any at-risk tenants present triggers intervention recommendations.

---

### 3. Ecosystem Trust

Monitors the health of the plugin and partner ecosystem:

| KPI                       | Source                                  | Health Threshold        |
|--------------------------|-----------------------------------------|-------------------------|
| Ecosystem trust signal    | `computeEcosystemTrustSignal(records)` | ≥ 0.75 = healthy        |
| Moderation queue depth    | `getModerationQueue()` count           | 0 = ideal               |
| Critical queue items      | `getModerationQueue('critical')` count | 0 = requires attention  |
| Trusted entity count      | Records with trustScore ≥ 75 and active| —                       |

Trust signal below 0.75 is a platform-level governance concern requiring escalation.

---

### 4. Governance & Replay Integrity

Aggregates governance durability and replay drift signals:

| KPI                          | Source                             | Health Threshold         |
|-----------------------------|------------------------------------|--------------------------|
| Governance durability rate   | Min pass rate across all dimensions| ≥ 98% = durable          |
| Open replay drift alerts     | `getOpenReplayDriftAlerts()` count | 0 = clean                |
| Degrading dimensions count   | Dimensions with trend = `degrading`| 0 = ideal                |
| Replay gate pass rate        | Replay-category gates in pass status| 100% = required          |

Any open replay drift alert or degrading governance dimension surfaces as a critical indicator.

---

### 5. Support Operations

Summarizes support health and incident patterns:

| KPI                       | Source                              | Health Threshold           |
|--------------------------|-------------------------------------|----------------------------|
| Open incidents            | `getOpenOperations()` count        | Minimize                   |
| SLA breach rate           | Breached / total resolved          | 0% = ideal                 |
| Replay-assisted rate      | `computeReplayAssistedRate()`      | Maximize                   |
| Root cause rate           | `computeRootCauseRate()`           | Maximize                   |
| Active cluster types      | `buildIncidentClusters()` count    | 0 = no systemic issues     |

`replay_failure` cluster presence triggers an immediate cross-reference with governance and telemetry indicators.

---

## Status Coloring Model

Each KPI is classified into one of three visual states:

| Status  | Color  | Meaning                                      |
|--------|--------|----------------------------------------------|
| `good` | Green  | Metric is within healthy operating range     |
| `warn` | Yellow | Metric is approaching threshold or degrading |
| `bad`  | Red    | Metric has breached a critical threshold     |

---

## Complexity Over-Limit Banner

A platform-level banner is displayed when any environment has `isOverLimit === true` on its latest complexity trend record. The banner identifies the affected environment and current growth percentage, and links to the Platform Evolution Council for remediation.

The banner is rendered conditionally — it does not appear when all environments are within the 10% complexity growth limit.

---

## API Endpoint

The dashboard fetches from a single composite endpoint:

```
GET /api/postGA/executive/summary
```

The endpoint aggregates data from all five operational domains and returns a unified summary object. Individual KPI endpoints are not exposed directly through this component — all data flows through the summary.

---

## Operational Runbook

**Daily operational review:**
1. Open Executive Operations Center dashboard
2. Review any `bad` (red) KPI cards — these require same-day action
3. Review any `warn` (yellow) KPI cards — these require monitoring and probable intervention
4. Check complexity over-limit banner — if visible, freeze evolution proposals

**Escalation triggers from the dashboard:**
- Any replay drift alert → replay integrity team
- Governance dimension degrading → governance owner for that dimension
- Trust signal < 0.75 → ecosystem integrity team
- Wave success rate < 80% → reliability engineering
- At-risk tenant count > 0 → customer success team within 72h
