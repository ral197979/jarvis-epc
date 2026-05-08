# Operational Anomaly Detection

**Denver Engineering — Ava Phase 6 (v6.0.0)**

## Overview

The Anomaly Detection Engine applies statistical methods to twin metrics and operational signals to surface abnormal conditions. Detected anomalies are persisted, classified, and routed to the appropriate response workflow.

## Detection Methods

### 1. Score Anomaly (Statistical Deviation)
Compares the latest readiness score against the window mean using Z-score:
```
deviation = |latest - avg| / stddev
```
Triggers when deviation > 2σ (≈ 95th percentile):
- 2–3σ → medium
- 3–4σ → high
- >4σ → critical

Anomaly score: `min(100, deviation × 25)`

### 2. High State Velocity
Counts state snapshots per twin in the detection window:
- ≥ 20 changes → medium
- ≥ 50 changes → high

Baseline: 5 changes per window (normal operational cadence).

### 3. Blocker Cluster
Counts blocked actions per project:
- ≥ 5 blocked → medium
- ≥ 10 blocked → high
- ≥ 15 blocked → critical

## Anomaly Schema

```sql
CREATE TABLE operational_anomalies (
  anomaly_score     numeric(5,2) NOT NULL CHECK (anomaly_score BETWEEN 0 AND 100),
  severity          anomaly_severity NOT NULL,  -- low/medium/high/critical
  false_positive    boolean NOT NULL DEFAULT false,
  resolved_at       timestamptz,
  ...
);
```

## Anomaly Lifecycle

```
detected → open
              ↓
          resolved (resolved_at set)
              OR
          false_positive = true (suppressed from future detections)
```

## Classification

The `anomalyClassificationService` provides:

| Anomaly Type | Category |
|-------------|---------|
| `readiness_score_spike` | metric |
| `high_state_velocity` | behavior |
| `blocker_cluster` | operational |
| `sla_breach_pattern` | compliance |
| `resource_contention` | operational |

**Escalation criteria:**
- `severity == critical` → always escalate
- `severity == high` AND `anomaly_score >= 75` → escalate

**False positive heuristics:**
- `anomaly_score < 20` AND `severity == low` → likely noise
- No impacted entities AND `severity == low` → likely noise

## Integration with Agents

The `RiskAgent` can trigger anomaly detection via `detectAnomalies({ tenantId })` and includes results in its risk analysis. Escalated anomalies are added to the agent approval queue.

## Forecast Cache Invalidation

When a new anomaly is detected that affects a twin with a cached forecast, `invalidateForecast` is called to ensure the next forecast request reflects the anomalous state.
