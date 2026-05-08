# Capacity Planning Guide — Phase 11

**Denver Engineering · GA Operations**
**Version:** 11.0.0

---

## Overview

This guide defines how to plan, forecast, and provision capacity for the Denver Engineering platform at GA scale. It covers cost forecasting, infrastructure scaling thresholds, and the tools used to automate capacity decisions.

---

## Capacity Planning Services

| Service | Purpose |
|---|---|
| `infrastructureCostForecaster` | Projects future costs based on growth trends |
| `operationalCostAnalyzer` | Tracks actual costs and detects anomalies |
| `adaptivePerformanceTuner` | Recommends tuning adjustments at runtime |
| `cacheOptimizationEngine` | Recommends cache sizing changes |
| `loadSimulationRunner` | Validates capacity before traffic increases |

---

## Growth Rate Calculation

The `infrastructureCostForecaster` computes monthly growth rate using:

```
growthRate = (lastPeriodCost - firstPeriodCost) / firstPeriodCost / numPeriods × 100
```

Future cost projections use compound growth:

```
projectedCost[month] = baseCost × (1 + growthRate/100) ^ month
```

Forecast confidence by data points:

| Historical Months | Confidence |
|---|---|
| ≥ 12 | 0.90 |
| ≥ 6 | 0.75 |
| ≥ 3 | 0.50 |
| < 3 | 0.25 |

---

## Tenant Growth Tiers

Plan capacity in advance of hitting the next tier boundary.

| Tier | Tenant Count | DB Sizing | App Sizing | Queue Workers |
|---|---|---|---|---|
| Starter | 1–50 | db.t3.large | 2 ECS tasks | 4 per type |
| Growth | 51–250 | db.r6g.xlarge | 4–6 ECS tasks | 8 per type |
| Scale | 251–1,000 | db.r6g.2xlarge | 8–12 ECS tasks | 12 per type |
| Enterprise | 1,001–5,000 | db.r6g.4xlarge Multi-AZ | 16–20 ECS tasks | 20 per type |
| GA Full | 5,000+ | db.r6g.8xlarge cluster | Auto-scale 20–50 | 40 per type |

Provision the next tier when you reach **80% of the current tier ceiling**.

---

## Scaling Triggers

### Automatic (AdaptivePerformanceTuner)

The system automatically recommends tuning when these thresholds are crossed:

| Signal | Threshold | Action |
|---|---|---|
| Queue fill rate | ≥ 80% | Increase worker concurrency |
| Queue fill rate | ≥ 95% | High-confidence scale-out recommendation |
| Replay latency | ≥ 2,000 ms | Increase replay batch size |
| Sync lag | ≥ 500 ms | Increase sync concurrency |
| Anomaly frequency | ≥ 10% | Review AI inference capacity |

### Manual Review Triggers

Schedule a capacity review when any of these occur:
- Month-over-month cost growth exceeds 25%
- `detectCostAnomaly` flags an anomaly (deviation > 50%)
- p95 latency trend shows `degrading` direction with confidence ≥ 0.5
- Import queue backlog exceeds 500 pending jobs

---

## Cache Sizing Guidelines

### Graph Cache

```
Trigger: hitRate < 0.70
Action: increase cache memory allocation

Recommended sizing:
  < 500 tenants: 4 GB
  500–2,000 tenants: 16 GB
  2,000–5,000 tenants: 64 GB
  5,000+ tenants: 128 GB (dedicated cluster)
```

### Replay Cache

```
Trigger: hitRate < 0.80
Action: increase TTL (recommended: +300 seconds per step)

Base TTL: 300s
Step up: 300s → 600s → 900s → 1800s
Max TTL: 3600s (1 hour)
```

---

## Cost Anomaly Detection

The `operationalCostAnalyzer` detects anomalies using:

```
deviation = (currentCost - avgCost) / avgCost
isAnomaly = |deviation| > 0.50  (50% above or below average)
```

Run rate is computed monthly:
```
runRate = (totalCostForPeriod / periodDays) × 30
```

Monitor for anomalies on a daily cron. Alert SRE if `isAnomaly = true`.

---

## Import Capacity

The import pipeline processes up to **5,000 rows per batch**. Plan capacity based on:

| Daily Import Volume | Batch Count | Recommended Workers |
|---|---|---|
| < 50,000 rows | ≤ 10 batches | 2 |
| 50,000–500,000 rows | ≤ 100 batches | 4 |
| 500,000–5,000,000 rows | ≤ 1,000 batches | 8 |
| > 5,000,000 rows | > 1,000 batches | 16+ (review architecture) |

Max validated job size: **500,000 rows** (`validateRowCount` upper bound).

---

## Quarterly Capacity Review

Run quarterly:

1. Pull cost records for last 3 months via `getTotalCostForPeriod`
2. Generate 6-month forecast via `projectFutureCosts`
3. Review trend analysis from `telemetryTrendAnalyzer.detectDegradingMetrics`
4. Run load simulation for current tenant count × 1.5 (growth buffer)
5. Update baselines if infrastructure was changed
6. Adjust tier boundaries if needed

Document the review outcome in a capacity memo and share with engineering leadership.
