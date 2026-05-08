# Simulation Learning Service

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

The simulation learning service tracks scenario simulation predictions against real-world outcomes to improve future scenario planning accuracy. When a simulated scenario has both a predicted impact (from `scenarioSimulationEngine`) and a measured actual impact (after the scenario plays out), the service records the prediction error and uses it to calibrate confidence in future simulations.

## Data Flow

```
Phase 6: scenarioSimulationEngine runs simulation
  → Records predictedDelta (readiness change)
  → Calls recordSimulationOutcome(tenantId, { scenarioId, predictedDelta, mitigationsApplied })

Later: actual outcome observed
  → Calls recordActualOutcome(tenantId, scenarioId, actualDelta)
  → predictionError = |predictedDelta - actualDelta|
  → signal: positive (< 10 pts error), neutral (10–25 pts), negative (> 25 pts)
```

## Accuracy Classification

| Prediction Error | Signal | Category |
|-----------------|--------|---------|
| ≤ 10 points | `positive` | Accurate |
| 10–25 points | `neutral` | Acceptable |
| > 25 points | `negative` | Inaccurate |

## Stats

`getScenarioAccuracyStats(tenantId, windowDays)` returns:
- `totalSimulations`: count of scenarios tracked
- `measuredSimulations`: those with actual outcomes recorded
- `meanPredictionError`: average |predicted - actual|
- `accurateCount`: predictions within ±10 points
- `inaccurateCount`: predictions more than 25 points off
- `accuracyRate`: accurateCount / measuredSimulations

## Storage

Outcomes are stored in `learning_feedback` with `feedback_type = 'scenario'`. The `context` JSONB field stores `predictedDelta` and `mitigationsApplied`; the `metadata` field stores computed `predictionError` after actual is recorded.

This reuses the learning feedback infrastructure (no separate table needed) and allows the `getLearningHealth()` function to include scenario accuracy in the overall system health report.

## API

```
POST /api/v1/adaptive/simulation-outcomes
GET  /api/v1/adaptive/simulation-outcomes
GET  /api/v1/adaptive/simulation-outcomes/stats
```

## Integration with Phase 6

Phase 6's `ScenarioSimulationPanel` component calls `recordSimulationOutcome` automatically after a scenario run completes. The `MitigationEffectivenessChart` (Phase 7) visualizes the prediction accuracy and applied mitigations.
