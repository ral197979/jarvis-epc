# Continuous Learning Loop

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

The learning loop is the feedback backbone of Phase 7. Every significant system action (recommendation, anomaly detection, forecast, scenario) generates a `LearningFeedback` record when its real-world outcome is observed. These records power calibration, ranking, anomaly threshold adjustment, and operational memory.

## Data Model

```typescript
interface LearningFeedback {
  id: string
  tenantId: string
  feedbackType: 'recommendation' | 'forecast' | 'anomaly' | 'scenario'
  sourceId: string         // ID of the recommendation/forecast/anomaly
  sourceType: string       // table name or entity type
  agentType?: string
  signal: 'positive' | 'negative' | 'neutral' | 'mixed'
  outcome: 'accepted' | 'rejected' | 'partially_accepted' | 'deferred' | 'superseded' | 'unknown'
  context: Record<string, unknown>   // type-specific context
  metadata: Record<string, unknown>  // computed fields (e.g. predictionError)
  recordedBy?: string      // 'user' | 'system' | 'agent'
  createdAt: Date
}
```

## Signal Classification

| Signal | Meaning |
|--------|---------|
| `positive` | The action produced the expected good outcome |
| `negative` | The action was wrong (false positive, rejected) |
| `neutral` | The action was taken but outcome is inconclusive |
| `mixed` | Partially correct — some targets improved, others didn't |

## Learning Health Metrics

`getLearningHealth()` returns:
- `totalFeedback`: all-time signal count
- `feedbackLast7Days`: recent activity volume
- `overallPositiveRate`: fraction of positive signals (target: ≥ 0.6)
- `byType`: per-type breakdown (recommendation, forecast, anomaly, scenario)

Expected health targets:

| Metric | Healthy | Warning |
|--------|---------|---------|
| `feedbackLast7Days` | ≥ 10 | < 3 |
| `overallPositiveRate` | ≥ 0.60 | < 0.40 |
| `recommendation positiveRate` | ≥ 0.65 | < 0.45 |

## Flow: Recording a Learning Signal

```
Agent executes recommendation
  → User accepts/rejects/defers
  → recordFeedback({ signal: 'positive', outcome: 'accepted', ... })
  → learning_feedback row inserted (immutable)
  → rankRecommendations() picks up new data on next call
  → getAdaptiveThreshold() recalibrates on next call
```

## Aggregation Window

Default aggregation window is 30 days for most signals. Forecast accuracy uses 90 days to capture long-horizon predictions. Signal summaries include `positiveRate = positive / total`.

## Cold Start Behavior

With zero feedback records, all systems fall back to defaults:
- Recommendation ranking uses 50 as baseline effectiveness for all agents
- Anomaly thresholds use the compiled-in `DEFAULT_THRESHOLD = 2.0σ`
- Forecast calibration applies no adjustment (`calibrationFactor = 1.0`)
- All explicit "not enough data" explanations are returned to callers

This ensures Phase 7 is non-disruptive on initial deployment.
