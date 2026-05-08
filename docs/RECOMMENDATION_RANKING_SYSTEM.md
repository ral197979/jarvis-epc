# Recommendation Ranking System

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

The recommendation ranking engine scores and sorts competing recommendations from multiple agents using a weighted composite formula that combines urgency, model confidence, and historical effectiveness. Rankings improve over time as more outcomes are recorded.

## Scoring Formula

```
score = urgency × 0.40 + confidence × 100 × 0.30 + historicalEffectiveness × 0.30
```

All inputs are on a 0–100 scale. The output is clamped to [0, 100].

### Weight Rationale

| Weight | Factor | Rationale |
|--------|--------|-----------|
| 0.40 | Urgency | Operational urgency drives priority — a low-confidence but critical action must rank high |
| 0.30 | Confidence | Model certainty matters but cannot override urgency |
| 0.30 | Historical Effectiveness | Agents that have been effective before are trusted more |

## Historical Effectiveness

Historical effectiveness is sourced from `recommendation_outcomes.effectiveness_score`, aggregated per agent type over a 60-day window via `getAgentEffectiveness()`.

- New agent with no history → defaults to 50 (neutral)
- Agent with 100% acceptance and avg effectiveness 85 → ranks higher than agents with 50 effectiveness

## API

```
POST /api/v1/adaptive/rank
{
  "candidates": [
    { "recommendationId": "r1", "recommendationType": "risk_mitigation", "agentType": "RiskAgent",
      "urgency": 85, "confidence": 0.9, "rationale": "Critical path risk" },
    { "recommendationId": "r2", "recommendationType": "readiness_boost", "agentType": "ReadinessCoordinatorAgent",
      "urgency": 40, "confidence": 0.7, "rationale": "Behind schedule" }
  ]
}
→ [{ score: 88.5, recommendationId: "r1", ... }, { score: 55.0, ... }]
```

## Top Ranked from DB

`GET /api/v1/adaptive/rank/top?limit=10` returns historically top-performing recommendations directly from `recommendation_outcomes`, sorted by average effectiveness.

## Comparison

`compareRecommendations(a, b)` returns:
- `winner` — the higher-scoring recommendation
- `margin` — score difference
- `explanation` — "Clear winner by X points" or "Near tie (margin: Y)" when margin < 5

## Effectiveness Tracking

Outcomes are recorded via `recordOutcome()` and measured via `updateOutcomeMeasurement()`:
```typescript
// When recommendation is acted on:
await recordOutcome(tenantId, { recommendationId, outcome: 'accepted', ... })

// When outcome can be measured (e.g., readiness score improved):
await updateOutcomeMeasurement(tenantId, outcomeId, effectivenessScore, afterState)
```

## Learning Lifecycle

1. Agent proposes recommendation
2. Human accepts/rejects
3. `recordOutcome()` called with outcome
4. After measurable time window: `updateOutcomeMeasurement()` with score
5. `getAgentEffectiveness()` aggregates over time
6. Future `rankRecommendations()` calls benefit from updated effectiveness
