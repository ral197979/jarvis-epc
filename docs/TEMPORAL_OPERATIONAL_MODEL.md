# Temporal Operational Model

**Denver Engineering — Ava Phase 6 (v6.0.0)**

## Overview

The temporal layer provides time-travel queries, historical replay, state velocity computation, and forward projections. Every twin has a complete, append-only snapshot log that makes any past state recoverable and any future state projectable.

## Snapshot Model

```sql
CREATE TABLE twin_state_snapshots (
  twin_id         uuid NOT NULL,
  snapshot_at     timestamptz NOT NULL DEFAULT now(),
  sequence_num    bigint NOT NULL,          -- monotonic, per twin
  state           jsonb NOT NULL,           -- full state at this point
  diff            jsonb,                    -- delta from previous snapshot
  checksum        text NOT NULL,            -- SHA-256 for integrity
  triggering_event_id text,                 -- causal event
  UNIQUE(twin_id, sequence_num)
);
```

**Invariants:**
- `sequence_num` is monotonically increasing per twin
- `checksum` is computed deterministically: `sha256(JSON.stringify(state))`
- `diff` is null for the first snapshot; present for all subsequent ones
- No snapshots are deleted (append-only)

## Time-Travel Query

```typescript
getStateAt(twinId, tenantId, at: Date)
// Returns the latest snapshot at or before `at`
// Uses: ORDER BY snapshot_at DESC LIMIT 1 WHERE snapshot_at <= at
```

This enables answering: "What was the readiness score of project X on March 15th?"

## Replay Range

```typescript
replayRange(twinId, tenantId, from: Date, to: Date)
// Returns all snapshots in chronological order within the range
// Used for audit visualization and scenario baseline selection
```

## State Diff

```typescript
diffStates(twinId, tenantId, fromAt: Date, toAt: Date)
// Returns { from, to, diff }
// diff = { fieldName: { from: oldValue, to: newValue }, ... }
```

Useful for change reports: "What changed between last week and now?"

## State Velocity

```typescript
computeStateVelocity(twinId, tenantId, windowDays = 7)
// Returns { changesPerDay, mostChangedFields }
```

High velocity (>5 changes/day) is an anomaly signal — may indicate a runaway sync process or rapidly shifting operational conditions.

## Score Trend

```typescript
getScoreTrend(twinId, tenantId, field, windowDays = 30)
// Returns Array<{ ts: Date, value: number }>
// Used as input to linear projection
```

## Forward Projection

The `timelineProjectionService` implements simple linear regression over historical score trends to project future values:

```
slope = (N·ΣXY - ΣX·ΣY) / (N·ΣX² - (ΣX)²)
intercept = (ΣY - slope·ΣX) / N
```

Uncertainty bands use standard deviation of historical values, widening with projection distance:
```
uncertainty = σ · √(1 + 1/N + (x - x̄)²/ΣX²)
```

**Confidence Levels:**
| History Points | Confidence |
|---------------|-----------|
| < 5 | 40% |
| 5–9 | 55% |
| 10–19 | 70% |
| ≥ 20 | 85% |

## SLA Breach Probability

Derived from projected final readiness at horizon:
```
breach_prob = max(0, (70 - projected_readiness) / 70)
```

- Readiness ≥ 70%: breach probability near zero
- Readiness = 50%: ~28% breach probability
- Readiness = 0%: 100% breach probability
