# Adaptive Anomaly Learning

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

The adaptive anomaly engine extends Phase 6 anomaly detection by learning per-type detection thresholds from operator feedback. When operators mark detections as false positives or confirm true positives, the system adjusts its σ multiplier accordingly — reducing noise without missing real anomalies.

## Threshold Learning

The base threshold is `DEFAULT_THRESHOLD = 2.0σ`. The system adjusts this based on operator feedback:

```typescript
adjustment = fpRate × 0.5 - tpRate × 0.2
learnedThreshold = clamp(DEFAULT_THRESHOLD + adjustment, MIN=1.5, MAX=4.0)
```

### Learning Dynamics

| Feedback Pattern | Effect |
|-----------------|--------|
| 80% false positives | Threshold increases toward 4.0σ (less sensitive) |
| 90% true positives | Threshold decreases toward 1.5σ (more sensitive) |
| 50/50 mix | Threshold stays near 2.0σ |

## Pattern Cache

Learned patterns are cached in-memory for 5 minutes (TTL). The cache is keyed by `tenantId:anomalyType:entityType`. Writing new feedback (via `recordAnomalyFeedback`) immediately invalidates the relevant cache entry.

## API

```
GET  /api/v1/adaptive/anomaly-patterns          — List all learned patterns
GET  /api/v1/adaptive/anomaly-patterns/:type    — Get pattern for specific anomaly type
POST /api/v1/adaptive/anomaly-patterns/:id/feedback
  { "anomalyType": "score_deviation", "entityType": "project", "isFalsePositive": true }
```

## Integration with Phase 6 Anomaly Detection

Phase 6 `anomalyDetectionEngine` uses a hardcoded 2σ threshold. With Phase 7, the adaptive engine provides `getAdaptiveThreshold(tenantId, anomalyType, entityType)` which can be used to override the static threshold.

The `AnomalyRadar` component's "false positive" button now calls the feedback endpoint automatically.

## Pattern Persistence

Pattern data is derived entirely from `learning_feedback` records. No separate patterns table is needed — patterns are always computable from feedback history. This means:
- Zero warm-up state to manage
- Patterns are always consistent with feedback history
- Rollback of feedback by deleting records is not supported (append-only)

## Entity-Type Scoping

Patterns can be learned per entity type (`project`, `equipment`, `site`) for more precise calibration. A `project` type twin might have a higher false positive rate on `score_deviation` than an `equipment` twin due to normal project volatility.
