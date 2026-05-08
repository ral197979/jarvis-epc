# Resource Optimization Engine

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

The resource optimization engine analyzes load distribution across operational entities (projects, equipment, workforce, systems) and proposes rebalancing actions. All proposals require explicit human approval before application.

## Load Computation

Current load is derived from twin state data:
```typescript
load = risk × 0.5 + (100 - readiness) × 0.3 + (100 - health) × 0.2
```

This formula captures:
- High risk → high load (50% weight)
- Low readiness → high operational strain (30%)
- Poor health → additional overhead (20%)

## Suggested Actions

| Condition | Action |
|-----------|--------|
| load ≥ 85 OR peak ≥ 90 | `scale_up` |
| load ≤ 20 | `scale_down` |
| load ≥ 70 AND peak ≥ 80 | `rebalance` |
| peak ≥ 80 | `defer` |
| otherwise | `ok` |

## Workload Balance Plan

`buildWorkloadBalancePlan()` identifies:
- **Overloaded entities**: currentLoad ≥ 75
- **Underutilized entities**: currentLoad ≤ 30
- **Transfer recommendations**: pairs (overloaded → underutilized), with estimated `workloadPct`

Estimated gain = `min(25, transfers.length × 5)`.

## Proposal Lifecycle

```
proposeOptimization() → status: 'proposed'
  → Human reviews
  → approveOptimization() → status: 'approved'
  → System applies changes
  → markOptimizationApplied(actualGain) → status: 'applied'
```

All proposals auto-expire after 24 hours if not approved.

## Governance

- Proposals in `proposed` state cannot be auto-applied
- `approved_by` field records who approved
- `actual_gain` vs `expected_gain` comparison drives `gainAccuracy` in the optimization summary

## API

```
GET  /api/v1/optimization/resources          — Load analysis
GET  /api/v1/optimization/resources/balance-plan  — Workload balance plan
POST /api/v1/optimization/proposals          — Create proposal
POST /api/v1/optimization/proposals/:id/approve  — Human approval required
POST /api/v1/optimization/proposals/:id/apply    — Mark applied
GET  /api/v1/optimization/proposals/summary  — Aggregate stats
```

## Optimization Summary

The summary tracks how accurate the expected gain estimates are over time:
```
gainAccuracy = 1 - |avgExpected - avgActual| / avgExpected
```

Values near 1.0 indicate the optimization engine's gain estimates are well-calibrated.
