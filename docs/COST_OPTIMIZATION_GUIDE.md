# Cost Optimization Guide — Phase 11

**Denver Engineering · GA Operations**
**Version:** 11.0.0

---

## Overview

This guide covers cost tracking, anomaly detection, AI usage optimization, and infrastructure cost forecasting tools introduced in Phase 11.

---

## Cost Tracking Architecture

| Service | Role |
|---|---|
| `operationalCostAnalyzer` | Records and queries cost records per tenant |
| `aiEfficiencyOptimizer` | Optimizes AI model routing for cost vs. quality |
| `infrastructureCostForecaster` | Projects future infrastructure costs |
| `cacheOptimizationEngine` | Reduces DB load via cache tuning |

---

## Cost Anomaly Detection

`detectCostAnomaly` identifies statistically abnormal cost periods:

```
deviation = (currentCost - avgCost) / avgCost
isAnomaly = |deviation| > 0.50  (50% above or below historical average)
```

**Example:** avg=$1,000/day, current=$1,600/day → deviation=0.60 → `isAnomaly = true`

### When Anomalies Occur

| Cause | Investigation |
|---|---|
| Tenant over-usage | Check per-tenant cost breakdown via `getCostRecords` |
| AI inference spike | Review `aiEfficiencyOptimizer.analyzeRoutingEfficiency` |
| Import bulk run | Expected — correlate with active import jobs |
| Infrastructure issue | Check for autoscaling events or runaway processes |
| Data leakage | Cross-tenant query without RLS → governance alert |

---

## Monthly Run Rate

```typescript
computeRunRate(total, periodDays):
  (total / periodDays) × 30  // Monthly projection
```

Use run rate for budget planning. Recompute after any major product change.

---

## AI Cost Optimization

`aiEfficiencyOptimizer` analyzes AI usage patterns and recommends model routing:

### Routing Recommendations

| Condition | Recommendation | Expected Savings |
|---|---|---|
| `acceptanceRate >= 0.85` AND `costPer1k > $0.01` | Switch to `gpt-4o-mini` | ~80% |
| `acceptanceRate < 0.50` | Upgrade to `gpt-4o` | Quality improvement |

### Cost Per 1K Tokens

```typescript
computeCostPerThousandTokens(totalCost, totalTokens):
  (totalCost / totalTokens) × 1000
```

### AI Cost Targets

| Model | Cost per 1K tokens | Use Case |
|---|---|---|
| `gpt-4o-mini` | ~$0.002 | High-volume, high-acceptance workflows |
| `gpt-4o` | ~$0.015 | Complex reasoning, low-acceptance workflows |
| `gpt-4-turbo` | ~$0.020 | Long context, document analysis |

---

## Infrastructure Cost Forecasting

`infrastructureCostForecaster.projectFutureCosts` uses compound growth:

```
monthlyGrowthRate = (lastCost - firstCost) / firstCost / periods × 100
projectedCost[n] = baseCost × (1 + rate/100)^n
```

Forecast confidence by data history:

| Historical Months | Confidence |
|---|---|
| ≥ 12 | 90% |
| ≥ 6 | 75% |
| ≥ 3 | 50% |
| < 3 | 25% |

### Using the Forecast

1. Gather last 6+ months of cost records
2. Run `computeLinearGrowthRate` to get monthly growth %
3. Project 6 and 12 months out with `projectFutureCosts`
4. Compare projection to budget allocation
5. If projected cost > budget at 6 months: initiate capacity review

---

## Cache Optimization for Cost Reduction

Improving cache hit rates reduces DB compute costs:

### Graph Cache

```
Trigger: hitRate < 0.70
Impact: Each 10% improvement in hit rate ≈ 15% reduction in DB query load
Action: increase cache memory allocation (see CAPACITY_PLANNING_GUIDE.md)
```

### Replay Cache

```
Trigger: hitRate < 0.80
Impact: Each 10% improvement ≈ 10% reduction in replay compute cost
Action: increase TTL (300s → 600s → 900s → 1800s)
```

---

## Per-Tenant Cost Accountability

All cost records are tenant-scoped using `tenantQuery` (RLS enforced):

```typescript
// Tenant-scoped cost lookup
const costs = await getCostRecords(tenantId, startDate, endDate)
const total = await getTotalCostForPeriod(tenantId, startDate, endDate)
const runRate = computeRunRate(total, daysBetween(startDate, endDate))
```

Cross-tenant cost aggregation uses `pool.query` (admin only):
```typescript
// Admin cost summary across all tenants
const globalTotal = await getTotalCostForPeriod(undefined, startDate, endDate)
```

---

## Cost Reduction Checklist

Review monthly:

- [ ] Check AI routing efficiency — is `gpt-4o-mini` being used where acceptance ≥ 85%?
- [ ] Review cache hit rates — any caches below target thresholds?
- [ ] Check for cost anomalies — any tenants with >50% deviation?
- [ ] Review run rate trend — is monthly growth rate sustainable?
- [ ] Check for idle infrastructure — any ECS tasks with < 5% CPU utilization?
- [ ] Validate telemetry retention — `purgeOldTelemetryEvents` running correctly (90-day retention)?
- [ ] Check import job storage — archive completed job payloads after 30 days

---

## Telemetry Retention

```
TELEMETRY_RETENTION_DAYS = 90
```

`purgeOldTelemetryEvents` removes events older than 90 days. Run as a nightly cron:

```
0 2 * * * node -e "require('./api/services/phase11/productionTelemetryEngine').purgeOldTelemetryEvents()"
```

Purging old telemetry reduces storage costs by ~40% for high-volume tenants.
