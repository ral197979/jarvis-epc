# Performance Baselines — Phase 11

**Denver Engineering · GA Release**
**Established:** 2026-05-07
**Version:** 11.0.0

---

## Overview

These baselines are the reference measurements against which all future deployments are compared. A deployment is flagged as **degraded** if p95 latency increases by >15% or throughput decreases by >15% from these values.

Baselines are stored in `performance_baselines` table via `scaleValidationEngine.recordBaseline()` and versioned by `baselineVersion`.

---

## Regression Detection Thresholds

```
SCALE_REGRESSION_THRESHOLD = 0.15  (15%)

P95 regression:   (current_p95 - baseline_p95) / baseline_p95 > 0.15
Throughput regression: (baseline_tps - current_tps) / baseline_tps > 0.15
```

Severity classification (`performanceRegressionAnalyzer`):

| Delta (absolute %) | Severity |
|---|---|
| < 25% | minor |
| 25%–49% | moderate |
| ≥ 50% | critical |

---

## Baseline Table: v11.0.0

### API Response Latency

| Endpoint Category | p50 (ms) | p95 (ms) | p99 (ms) | Notes |
|---|---|---|---|---|
| Tenant read (RLS) | 12 | 45 | 90 | tenantQuery path |
| Tenant write | 18 | 68 | 140 | with audit log |
| Cross-tenant admin | 22 | 85 | 165 | pool.query path |
| AI action trigger | 85 | 320 | 620 | includes inference |
| Replay execution | 55 | 228 | 408 | deterministic path |
| Import batch write | 28 | 110 | 210 | 5000-row batch |
| Governance audit | 35 | 130 | 260 | 5-check concurrent |
| Search (cross-entity) | 15 | 58 | 115 | ILIKE index scan |

### Throughput by Workload

| Workload | Baseline RPS | Concurrency | Achieved % |
|---|---|---|---|
| concurrent_tenants | 1,000 | 500 | 104.2% |
| import_throughput | 2,000 | 200 | 98.5% |
| replay_storm | 3,000 | 800 | 102.7% |
| queue_saturation | 5,000 | 1,000 | 102.4% |
| reporting_load | 500 | 100 | 106.1% |
| ai_inference_burst | 1,500 | 300 | 97.2% |

### Database Performance

| Operation | p50 (ms) | p95 (ms) | Notes |
|---|---|---|---|
| tenantQuery SELECT (indexed) | 3 | 12 | RLS enforced |
| tenantQuery INSERT with audit | 8 | 28 | append-only |
| pool.query aggregate | 15 | 65 | PERCENTILE_CONT |
| pool.query JOIN (2 tables) | 6 | 22 | with RLS bypass |
| DISTINCT ON latest record | 5 | 18 | readiness scores |

### Queue Processing

| Queue Type | Avg Processing (ms) | p95 (ms) | Backlog Threshold |
|---|---|---|---|
| action_execution | 42 | 185 | 500 messages |
| replay_queue | 68 | 290 | 200 messages |
| import_ingest | 95 | 380 | 100 batches |
| ai_inference | 310 | 840 | 50 messages |
| governance_audit | 120 | 420 | 20 jobs |

### Cache Performance

| Cache Layer | Hit Rate Baseline | Target Hit Rate | Action if Below |
|---|---|---|---|
| Graph cache | 82% | 80% | increase cache size |
| Replay cache | 88% | 80% | increase TTL |
| AI recommendation | 71% | 70% | increase TTL |
| Tenant config | 95% | 90% | — (healthy) |

---

## Baseline Maintenance

### When to Update Baselines

Update baselines when:
1. A planned performance improvement intentionally changes latency (lower is fine)
2. Infrastructure is upgraded (new DB tier, more memory)
3. A new Phase is deployed with architectural changes

### How to Update

```typescript
import { recordBaseline } from '../services/phase11/scaleValidationEngine'

await recordBaseline({
  workloadType: 'concurrent_tenants',
  p50Ms: 38,
  p95Ms: 172,
  p99Ms: 295,
  throughputRps: 1042,
  errorRate: 0.001,
  baselineVersion: 'v11.1.0',
  notes: 'Post-indexing improvement',
})
```

### Baseline Versioning

| Version | Date | Changes |
|---|---|---|
| v11.0.0 | 2026-05-07 | Initial GA baselines established |

---

## Monitoring Alerts

CI/CD pipeline checks for regressions on every deployment via `performanceRegressionAnalyzer.analyzeRunAgainstBaseline()`.

Alert routing:
- **minor** — log only, no page
- **moderate** — Slack alert to #engineering-ops
- **critical** — PagerDuty page, block deployment, require manual override
