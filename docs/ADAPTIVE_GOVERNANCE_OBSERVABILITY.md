# Adaptive Governance and Observability

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Governance Invariants

Phase 7 introduces learning and optimization capabilities but **does not relax any governance rules**. All invariants from Phases 4 and 5 remain in force.

### What Learning Cannot Do

| Action | Status | Why |
|--------|--------|-----|
| Auto-apply optimization proposals | ❌ Never | Requires explicit human approval |
| Override policy freeze via learning signal | ❌ Never | Governance policies are immutable |
| Auto-resolve anomalies | ❌ Never | Resolution is a human decision |
| Change twin status based on forecast | ❌ Never | Status changes require governed actions |
| Execute trades or financial actions | ❌ Never | Prohibited action category |

### What Learning Can Do

| Action | Status |
|--------|--------|
| Adjust σ threshold for anomaly detection | ✓ With cache, tenant-scoped |
| Apply calibration factor to forecast predictions | ✓ Explain all adjustments |
| Re-rank recommendations by historical effectiveness | ✓ Transparent scoring |
| Generate strategy plans (advisory) | ✓ No autonomous execution |
| Build agent consensus | ✓ Advisory only |

## Observability Primitives

### Feedback Audit Trail

Every `learning_feedback` record is immutable. The complete feedback history is queryable via:
```
GET /api/v1/adaptive/feedback/source/:sourceType/:sourceId
```

This provides a full audit chain: which agent, which signal, which outcome, when.

### Calibration Explainability

Every calibrated forecast includes `adjustmentExplained`:
```
"8% downward adjustment based on 20 historical observations (MAE: 5.2)"
```

Operators can always see why a prediction was adjusted.

### Optimization Proposal Audit

All proposals track `approved_by`, `applied_at`, `expected_gain`, and `actual_gain`. The `gainAccuracy` metric holds the optimization engine accountable over time.

## Monitoring Checklist (Phase 7)

| Metric | Expected | Alert |
|--------|----------|-------|
| `overallPositiveRate` | ≥ 0.60 | < 0.40 |
| `feedbackLast7Days` | ≥ 10 | < 3 |
| `gainAccuracy` | ≥ 0.75 | < 0.50 |
| `simulationAccuracyRate` | ≥ 0.65 | < 0.40 |
| `calibrationFactor` deviation | ≤ ±0.15 | > ±0.30 |

## Tenant Isolation

All Phase 7 tables have RLS enabled:
- `learning_feedback.tenant_id`
- `recommendation_outcomes.tenant_id`
- `forecast_accuracy_history.tenant_id`
- `optimization_feedback.tenant_id`

Cross-tenant learning bleed is impossible at the database level.

## Replayability

The learning feedback log is append-only. Any calibration factor or threshold adjustment can be recomputed from scratch by replaying `learning_feedback` records. There is no hidden state.
