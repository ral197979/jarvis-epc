# Forecast Calibration Engine

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

The forecast calibration engine corrects systematic prediction bias using historical accuracy data. When the system consistently over- or under-predicts readiness, risk, or workload scores, the calibration factor automatically adjusts future predictions without modifying the underlying forecast model.

## Tracking Accuracy

Every forecast value produced by the system can be recorded via `recordPrediction()`. When the actual value becomes known (e.g., at the end of a sprint or maintenance window), `recordActual()` computes and stores:

- `absoluteError = |predicted - actual|`
- `squaredError = (predicted - actual)²`
- `driftSeverity` — classified based on percentage error

## Drift Severity Classification

| Percentage Error | Severity |
|-----------------|---------|
| < 5% | `none` |
| 5–10% | `minor` |
| 10–20% | `moderate` |
| 20–35% | `significant` |
| > 35% | `critical` |

Where percentage error = `absoluteError / baseline (50)`.

## Calibration Factor

`calibrationFactor` is computed from `meanBias`:
```typescript
// Mean bias = avg(predicted - actual)
// Positive bias = systematically over-predicting
calibrationFactor = clamp(1 - (meanBias / 100) * 0.5, 0.7, 1.3)
```

If `|meanBias| < 1`: no calibration applied (`factor = 1.0`).

### Examples

| Mean Bias | Interpretation | Factor |
|-----------|---------------|--------|
| +10 | Over-predicting by 10 pts | 0.95 |
| -20 | Under-predicting by 20 pts | 1.10 |
| 0.5 | Neutral | 1.00 |

## Calibration API

```
POST /api/v1/adaptive/calibrate
{
  "forecastType": "readiness",
  "predictedValue": 75,
  "horizon": 30
}

→ {
  "calibrationFactor": 0.93,
  "calibratedPrediction": 69.8,
  "adjustmentExplained": "7% downward adjustment based on 24 historical observations (MAE: 8.3)"
}
```

## Minimum Sample Requirement

Calibration is only applied when `sampleCount >= 5`. Below this threshold, the original prediction is returned unchanged with explanation: `"Insufficient history — no calibration applied"`.

## Drift Summary

`GET /api/v1/adaptive/calibrate/drift/:type` returns per-horizon drift status with actionable recommendations:

- `none`: "Forecast model performing well"
- `significant`: "Consider retraining forecast model"
- `critical`: "Critical drift — manual review required"

## Integration with Forecast Engine

The Phase 6 `operationalForecastEngine` calls `calibratePrediction()` before returning values when sufficient history exists. For new tenants, no calibration is applied.
