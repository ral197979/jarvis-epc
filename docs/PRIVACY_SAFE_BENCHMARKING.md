# Privacy-Safe Benchmarking

## Overview

The Benchmarking Service computes industry-wide performance cohorts from pooled data while ensuring individual tenant values are never exposed. Cohorts with fewer than `MIN_BENCHMARK_COHORT = 10` values are suppressed entirely — their percentile fields are set to `NULL` and `suppressed = TRUE`.

## Cohort Mechanics

A cohort groups contributions by:
- `metric_name` — the metric being benchmarked (e.g., `sla_compliance`, `incident_closure_time`)
- `industry_segment` — the industry vertical (e.g., `saas`, `fintech`)
- `region` — geographic region (e.g., `us-west`, `eu-central`)
- `project_type` — optional project classifier

Cohorts are upserted via `ON CONFLICT` on `(metric_name, industry_segment, region, project_type)`, so each logical cohort has exactly one current row.

## Suppression Rule

```typescript
if (values.length < MIN_BENCHMARK_COHORT) {
  // insert with suppressed=TRUE, all percentiles NULL
}
```

`MIN_BENCHMARK_COHORT = 10` is strictly greater than `K_ANONYMITY_MIN = 5`. This creates a two-layer privacy fence: K-anonymity at the contribution level, and minimum cohort size at the benchmark level.

## Percentile Bands

Each cohort exposes four percentile breakpoints: `p25`, `p50`, `p75`, `p90`. The `_classifyBand()` helper translates a tenant's raw value into a band label:

| Band | Condition |
|---|---|
| `top_quartile` | value >= p75 |
| `above_median` | p50 <= value < p75 |
| `below_median` | p25 <= value < p50 |
| `bottom_quartile` | value < p25 |
| `insufficient_data` | any percentile is NULL |

## Tenant Self-Comparison

`getTenantBenchmark(tenantId, metricName, tenantValue)` computes where the tenant stands relative to their industry cohort without exposing other tenants' values. The response includes:

```typescript
{
  tenantId,
  metricName,
  tenantValue,
  percentileEstimate,  // 'top_quartile' | 'above_median' | ...
  cohortP25, cohortP50, cohortP75, cohortP90,
  cohortSize,
  suppressed,
}
```

## SLA Benchmarks

`getSlaBenchmarks()` returns cohorts for `sla_compliance` and `incident_closure_time` metrics, enabling teams to compare their SLA performance against industry peers.

## Configuration

```env
MIN_BENCHMARK_COHORT=10    # Minimum values to compute percentiles
```

## Related Services

- `federatedIntelligenceEngine` — source of anonymized contribution data
- `certificationEvidenceService` — uses benchmark cohort data for compliance reports
