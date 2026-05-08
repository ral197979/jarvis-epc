# Scenario Simulation Engine

**Denver Engineering — Ava Phase 6 (v6.0.0)**

## Overview

The Scenario Simulation Engine runs isolated what-if simulations against operational twin state. Each simulation is fully isolated (via a unique `isolation_token`), replayable, and never writes to production tables.

## Design Principles

1. **Isolation** — Simulations operate on a copy of state; they never mutate production twins
2. **Auditability** — Every simulation is persisted in `scenario_simulations`; results are stored as JSONB
3. **Reproducibility** — Given the same `baseSnapshotId` and `injectedEvents`, results are deterministic
4. **Non-blocking** — Run asynchronously; UI polls for completion

## Simulation Lifecycle

```
createScenario → pending
     ↓
runScenario → running
     ↓ (success)          ↓ (error)
  completed              failed
     
cancelScenario → cancelled (from pending or running)
```

## Event Types

| Event Type | Effect |
|------------|--------|
| `readiness_drop` | Reduces `readiness_score` by `payload.amount` (clamped to 0) |
| `risk_spike` | Increases `risk_score` by `payload.amount` (clamped to 100) |
| `resource_reduction` | Multiplies resources by `1 - payload.percent` |
| `blocker_injection` | Adds `payload.count` to `active_blockers` |
| (custom) | Merges `payload` directly into state |

Events are applied in `offsetDays` order, earliest first.

## Base State Resolution

The simulation resolves its starting state in priority order:
1. `baseSnapshotId` → load exact historical snapshot
2. `config.targetTwinId` → load latest snapshot for that twin
3. Fallback → portfolio aggregate (`AVG(readiness_score)`)

## Result Computation

```typescript
interface ScenarioResult {
  readinessDelta: number          // simulated - base readiness
  slaBreachCount: number          // events likely to cause SLA breach
  estimatedDelayDays: number      // -readinessDelta * 0.3 (conservative)
  resourceConflicts: number       // from active_blockers in simulated state
  mitigationRecommendations: string[]
  simulatedTimeline: TimeSeriesPoint[]  // day-by-day trajectory
  bottlenecks: string[]           // target entity IDs of blocker events
}
```

## Isolation Token

Each simulation is assigned a `randomUUID()` as its `isolation_token`. This prevents cross-simulation contamination and acts as an idempotency key for replay. The token is stored in `scenario_simulations.isolation_token`.

## Schema

```sql
CREATE TABLE scenario_simulations (
  id                          uuid PRIMARY KEY,
  tenant_id                   uuid NOT NULL,
  name                        text NOT NULL,
  scenario_type               text NOT NULL,
  status                      scenario_status NOT NULL DEFAULT 'pending',
  config                      jsonb NOT NULL DEFAULT '{}',
  base_snapshot_id            uuid REFERENCES twin_state_snapshots(id),
  injected_events             jsonb NOT NULL DEFAULT '[]',
  results                     jsonb,
  projected_readiness_impact  numeric(5,2),
  projected_sla_impact        numeric(5,2),
  confidence_score            numeric(5,2),
  isolation_token             text NOT NULL DEFAULT gen_random_uuid()::text,
  created_by                  uuid NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                timestamptz
);
```

## Common Scenario Types

| Type | Description |
|------|-------------|
| `resource_shock` | Simulate sudden resource loss |
| `delay_cascade` | Model downstream effects of a delay |
| `vendor_failure` | Critical vendor goes offline |
| `weather_disruption` | Force-majeure event |
| `scope_change` | Impact of adding/removing scope |
