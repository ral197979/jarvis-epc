# Live Production Telemetry

**Denver Engineering — Phase 12**  
**Status:** Active | **Version:** 12.0.0

---

## Overview

Phase 12 telemetry refines raw signals from production into actionable behavioral intelligence. Three services collaborate to detect drift, classify risk, and surface usage anomalies before they become incidents.

---

## Services

| Service | Purpose |
|---------|---------|
| `productionBehaviorAnalyzer` | Classifies abandonment/override risk per tenant |
| `operationalUsageProfiler` | Builds holistic health profiles from usage signals |
| `telemetryDriftDetector` | Detects metric drift against established baselines |

---

## Behavioral Risk Classification

### Abandonment Rate
```
abandonmentRate = abandoned / total   (0 if total = 0)
```

| Rate | Risk Level |
|------|-----------|
| > 0.50 | high |
| > 0.25 | medium |
| ≤ 0.25 | low |

### Override Rate
```
overrideRate = overrides / total   (0 if total = 0)
```

| Rate | Risk Level |
|------|-----------|
| > 0.60 | high |
| > 0.35 | medium |
| ≤ 0.35 | low |

**Overall risk:** maximum of abandonment risk and override risk.

---

## Usage Profile Health

### Score Formula
```
healthScore = completion × 30 + aiAcceptance × 25 + reliability × 25 + (1 − escalationRate) × 20
```

### Health Gate
A profile is considered healthy when **all three** conditions hold:
- `workflowCompletionRate ≥ 0.70`
- `abandonmentRate ≤ 0.30`
- `edgeSyncReliability ≥ 0.95`

### Onboarding Friction Score
```
frictionScore = min(events / steps, 1.0)   (0 if steps = 0)
```

### Edge Sync Reliability
```
reliability = successes / (successes + failures)   (1.0 if total = 0)
```

---

## Telemetry Drift Detection

### Drift Percentage
```
driftPct = |current − baseline| / baseline

Special cases:
  baseline = 0 AND current ≠ 0  →  driftPct = 1.0
  baseline = 0 AND current = 0  →  driftPct = 0
```

### Direction
- `increasing`: current ≥ baseline
- `decreasing`: current < baseline

### Alert Threshold
```
TELEMETRY_DRIFT_ALERT_THRESHOLD = 0.20

isDriftAlert = driftPct > 0.20
```

### Severity Classification

| Drift % | Severity |
|---------|---------|
| ≤ 5% | none |
| ≤ 15% | minor |
| ≤ 35% | moderate |
| > 35% | severe |

---

## Key Tables

| Table | Description |
|-------|-------------|
| `p12_behavior_events` | Raw behavior events per tenant |
| `p12_usage_profiles` | Aggregated usage profiles (period-based) |
| `p12_telemetry_drift` | Drift records per metric |

---

## Operational Guidance

- **Drift alerts** are non-blocking but should trigger CSM review within 24 hours.
- **High behavioral risk** (abandonment > 0.50) should trigger an `adoptionAccelerationEngine` plan within 48 hours.
- **Profile health score < 60** qualifies a tenant for proactive outreach.
- Drift resolved when `resolvedAt` is set; unresolved drifts older than 7 days escalate to high severity.
