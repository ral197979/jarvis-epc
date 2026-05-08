# Production Telemetry Operations (Post-GA)

**Program:** Post-GA Operationalization  
**Domain:** Real-Time Platform Health Monitoring  
**Service:** `productionTelemetryOperations`  
**Owner:** Denver Engineering — SRE  

---

## Purpose

Production Telemetry Operations provides continuous observability into platform metric drift after GA. It ingests real-time telemetry, computes drift relative to pre-GA baselines, classifies severity, and maintains an aggregate health score to drive operational decisions.

---

## Tracked Metrics

| Metric                      | Description                                  |
|----------------------------|----------------------------------------------|
| `recommendation_acceptance` | Rate at which AI recommendations are accepted |
| `workflow_abandonment`      | Rate of incomplete workflow sessions          |
| `replay_latency`            | Time to execute replay sessions               |
| `support_escalation`        | Rate of support ticket escalations            |
| `onboarding_friction`       | Friction score during tenant onboarding       |
| `plugin_adoption`           | Plugin usage adoption rate                    |
| `deployment_rollback`       | Frequency of deployment rollbacks             |
| `operational_bottleneck`    | Detected operational bottleneck events        |

---

## Drift Classification

Drift is measured as absolute percentage deviation from the pre-GA baseline:

```
driftPct = |currentValue - baselineValue| / baselineValue
```

| Severity   | Drift Range     | Operational Response               |
|-----------|-----------------|-------------------------------------|
| `none`    | ≤ 5%            | No action                           |
| `minor`   | > 5% — ≤ 15%   | Log, monitor trend                  |
| `moderate`| > 15% — ≤ 35%  | Alert SRE, investigate root cause   |
| `severe`  | > 35%           | Page on-call, possible rollback     |

---

## Overall Drift Score

The platform-level drift health score is computed as:

```
score = 100 - (alertCount × 5) - (severeCount × 15)
score = max(0, score)
```

Where:
- `alertCount` = records with severity != `none`
- `severeCount` = records with severity == `severe`

Severe records incur a double penalty (both the alert penalty and the severe penalty).

The platform is **healthy** when `overallDriftScore >= 70`.

---

## Tenant Isolation

- Per-tenant telemetry is queried using `tenantQuery()` to enforce row-level security
- Cross-tenant aggregate views use `pool.query()` restricted to admin operations
- Baseline values are established per-metric during the pre-GA qualification window

---

## Operational Runbook

**Recording telemetry:**
```
recordTelemetry(metric, currentValue, baselineValue, tenantId?)
```
Drift classification and severity assignment happen automatically on insert.

**Checking platform health:**
1. `getRecentAlerts(since)` — all moderate/severe metrics in the time window
2. `getSevereMetrics(records)` — extract metric names with severe drift
3. `isTelemetryHealthy(overallDriftScore)` — pass/fail gate

**Responding to severe drift:**
1. Identify the metric from `getSevereMetrics()`
2. Cross-reference with recent deployments and rollout waves
3. Replay-related severe drift → escalate to replay integrity team immediately
4. Non-replay severe drift → SRE investigation, potential feature flag rollback

---

## Database Tables

| Table                    | Description                                   |
|-------------------------|-----------------------------------------------|
| `pga_telemetry_records` | Per-metric drift measurements with severity   |
