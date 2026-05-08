# Real-World Feedback Loops

**Denver Engineering — Phase 12**  
**Status:** Active | **Version:** 12.0.0

---

## Overview

Three services close the loop between platform behavior and user experience: operational feedback collection, usability friction analysis, and ecosystem-level sentiment aggregation.

---

## Services

| Service | Purpose |
|---------|---------|
| `operationalFeedbackHub` | Collects, classifies, and routes feedback |
| `usabilitySignalAggregator` | Aggregates usability friction from feature interactions |
| `ecosystemFeedbackAnalyzer` | Computes trust signal and NPS from feedback summaries |

---

## Feedback Hub

### Sentiment Classification (keyword-based)

| Positive Keywords | Negative Keywords |
|-------------------|------------------|
| great, excellent, love, easy, helpful, smooth, fast, good | slow, broken, difficult, confusing, error, failed, terrible, hate |

```
posScore = count of positive keywords in text
negScore = count of negative keywords in text

sentiment = 'positive'  if posScore > negScore
sentiment = 'negative'  if negScore > posScore
sentiment = 'neutral'   if posScore = negScore
```

### Actionable Feedback
```
isActionable = sentiment = 'negative'
             OR category ∈ {'feature_request', 'usability'}
```

### Sentiment Score
```
sentimentScore = (positive − negative × 0.5) / total
               = 0.5  if total = 0
```

---

## Usability Signal Aggregation

### Friction Score
```
completionFriction = (1 − completionRate) × 50
timeFriction       = averageTimeMs > expectedTimeMs
                     ? min((avg/expected − 1) × 20, 30)
                     : 0
abandonFriction    = min(abandonCount × 5, 20)

frictionScore = min(100, round(completionFriction + timeFriction + abandonFriction))
```

### High Friction Gate
```
isHighFriction = frictionScore ≥ 50
```

### Ranked Features
```
getRankedFrictionFeatures = signals sorted by frictionScore descending (non-mutating)
```

### Average Completion Rate
```
avgCompletionRate = sum(completionRate) / count   (1.0 if empty)
```

---

## Ecosystem Feedback Analysis

### Trust Signal Score
```
trustSignalScore = min(1.0, (positive × 1.0 + neutral × 0.5) / total)
                 = 0.5  if total = 0
```

### Net Promoter Score
```
NPS = round((positive − negative) / total × 100)
    = 0  if total = 0
```

### Top Friction Areas
Returns top N categories sorted by frequency descending.

### Ecosystem Health Gate
```
isFeedbackHealthy = trustSignalScore ≥ 0.65
```

---

## Feedback Sources

| Source | Description |
|--------|-------------|
| `in_app` | In-product feedback widgets |
| `support_ticket` | Extracted from resolved support records |
| `survey` | Periodic NPS/CSAT surveys |
| `partner_api` | Partner-submitted ecosystem feedback |

---

## Key Tables

| Table | Description |
|-------|-------------|
| `p12_feedback_records` | Individual feedback entries with sentiment |
| `p12_usability_signals` | Per-feature friction signals per tenant |
| `p12_ecosystem_feedback_summaries` | Period-aggregated ecosystem summaries |

---

## Feedback Health Targets

| Metric | Target |
|--------|--------|
| Trust signal score | ≥ 0.75 |
| NPS | ≥ 40 |
| High-friction features | 0 |
| Actionable feedback resolved within 2 sprints | ≥ 80% |

---

## Operational Guidance

- **Trust signal < 0.65** triggers an ecosystem health review with partner and product teams.
- High-friction features are routed to the product team as P1 UX issues.
- Feedback NPS drops of ≥ 10 points between periods generate an alert to the executive dashboard.
- `feature_request` feedback with ≥ 10 occurrences in a period is automatically escalated to the product roadmap queue.
- Feedback records are append-only; `processedAt` marks when feedback was actioned.
