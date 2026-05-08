# Predictive SLA Analytics
**Denver Engineering — Ava Phase 3 (v4.35.0)**

## Purpose

The Predictive SLA module computes a breach probability for each open action, identifies bottleneck factors, and estimates expected delay hours. Predictions are persisted for historical analysis and staffing risk dashboards.

## Design Philosophy

- **Deterministic baseline:** The feature vector and scoring functions use pure arithmetic. No external ML model is required.
- **ML-ready:** A `ScoringProvider` interface allows future model substitution without changing the prediction pipeline.
- **Short-lived predictions:** Predictions expire after 4 hours (`expires_at`) and are recomputed on the next cycle.

## Feature Vector

Seven signals are extracted per action:

| Feature | Weight | Derivation |
|---------|--------|-----------|
| `sla_urgency` | 35% | `max(0, 1 - slaRemainingMins / 480)` — urgency grows as deadline approaches |
| `priority_weight` | 15% | `{critical:1.0, high:0.75, medium:0.5, low:0.25}[priority]` |
| `escalation_weight` | 15% | `min(1, escalationLevel / 3)` |
| `blocker_weight` | 15% | `min(1, blockerCount / 5)` |
| `workload_pressure` | 10% | `workloadScore / 100` |
| `reopen_signal` | 5% | `min(1, reopenCount / 3)` |
| `age_risk` | 5% | `min(1, ageHours / 168)` — risk grows over 7 days |

## Breach Probability

```
probability = Σ (feature_value × weight)
probability = clamp(probability, 0.0, 1.0)
```

### Threshold Interpretation

| Probability | Interpretation |
|-------------|----------------|
| ≥ 0.8 | High risk — likely to breach |
| 0.5–0.79 | Medium risk — monitor closely |
| 0.2–0.49 | Low risk — no immediate action |
| < 0.2 | Minimal risk |

## Delay Hours Prediction

If `probability ≥ 0.5` and `slaRemainingMins` is defined:

```
predictedDelayHours = (1 - probability) × slaRemainingMins / 60 * -1
```

Returns `null` if breach is not predicted or SLA data is unavailable.

## Bottleneck Factor Identification

The engine identifies which signals are driving breach risk:

| Signal | Triggered When |
|--------|----------------|
| `sla_urgency` | SLA remaining < 240 minutes |
| `active_blockers` | blockerCount > 0 |
| `escalation_chain` | escalationLevel > 0 |
| `assignee_overload` | workloadScore > 70 |
| `chronic_reopen` | reopenCount ≥ 2 |

Each bottleneck factor includes `contribution` (0.0–1.0), the proportion of breach probability attributable to that signal.

## Staffing Risk Score

The engine computes a tenant-level staffing risk score (0–100):

```
risk = (overdueCount / max(openCount,1)) × 40
     + (criticalCount / max(openCount,1)) × 40
     + min(overdueCount × 2, 20)
risk = clamp(risk, 0, 100)
```

Staffing risk snapshots are written daily to `staffing_risk_snapshots` per user, enabling trends like "user X consistently has high workload on Fridays."

## ScoringProvider Interface

```typescript
interface ScoringProvider {
  name: string
  score(input: BreachPredictionInput): Promise<{
    probability: number
    confidence:  number
    explanation: string
  }>
}
```

When registered via `registerScoringProvider()`, the provider's output replaces the deterministic computation. The deterministic model remains available as a fallback if the provider throws.

## Persistence

Predictions are upserted to `sla_breach_predictions`:

```sql
CREATE TABLE sla_breach_predictions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  action_id             uuid NOT NULL,
  breach_probability    numeric(5,4) NOT NULL,
  predicted_delay_hours numeric(8,2),
  staffing_risk_score   int NOT NULL DEFAULT 0,
  bottleneck_factors    jsonb NOT NULL DEFAULT '[]',
  model_version         text NOT NULL DEFAULT 'v1',
  feature_vector        jsonb NOT NULL DEFAULT '{}',
  expires_at            timestamptz NOT NULL DEFAULT now() + interval '4 hours',
  predicted_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, action_id)
);
```

The `ON CONFLICT` clause updates all fields except `id` and `tenant_id`.

## Historical Baseline

The `getHistoricalBaseline()` function computes P50 and P90 resolution times from `action_resolution_samples`:

```typescript
async function getHistoricalBaseline(
  tenantId: string,
  actionType: string,
  priority: string
): Promise<{ p50: number | null; p90: number | null }>
```

These percentiles are used to contextualize breach predictions: "this action type typically resolves in X hours at P50."

On DB error, the function returns `{ p50: null, p90: null }` and logs — predictions are never blocked by baseline lookup failures.

## Resolution Sample Collection

When an action is completed, a resolution sample is written to `action_resolution_samples`:

```sql
CREATE TABLE action_resolution_samples (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  action_id               uuid NOT NULL,
  action_type             text NOT NULL,
  priority                text NOT NULL,
  resolution_hours        numeric(8,2),
  was_escalated           boolean NOT NULL DEFAULT false,
  was_reopened            boolean NOT NULL DEFAULT false,
  sla_breached            boolean NOT NULL DEFAULT false,
  final_assignee_workload int,
  completed_at            timestamptz NOT NULL DEFAULT now()
);
```

Samples accumulate over time and improve the historical baseline precision.

## Batch Prediction

```typescript
function batchPredictBreaches(inputs: BreachPredictionInput[]): BreachPrediction[]
```

Returns predictions sorted by `breachProbability` descending. Used by the Operations Center to show "most at risk" actions at the top.

## API Integration

Predictions are surfaced in:
- `GET /api/v1/ops/overview` — includes breach count summary
- `GET /api/v1/actions/inbox` — `sla_remaining_minutes` field used by frontend to compute risk indicators
- `GET /api/v1/ops/recommendations` — `predictiveSla` feeds `slaRemainingMins` into recommendation inputs

## Known Limitations

- Feature vector uses linear combination; non-linear interactions (e.g., high priority + many blockers + overloaded assignee) are underweighted relative to a trained ML model.
- Staffing risk is tenant-level; per-project staffing risk requires Phase 4 enhancement.
- P50/P90 baselines require at least 10 resolution samples per `(action_type, priority)` pair to be statistically meaningful.
