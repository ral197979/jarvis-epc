# Operational Simulation + Replay Engine

**Denver Engineering — Ava Phase 4 (v4.40.0)**

## Overview

The Simulation Engine enables safe what-if analysis and historical event replay in complete isolation from production data. Simulations read from `realtime_event_log` but write exclusively to `simulation_*` tables. No production mutations ever occur during simulation.

## Core Principles

- **Isolation guaranteed** — simulation sessions write ONLY to `simulation_events` and `simulation_results`
- **Deterministic replay** — events are ordered by `sequence_number ASC`; checksum covers the full ordered sequence
- **Pure state accumulation** — `_applySimulatedEvent()` is a pure function returning a new state object
- **What-if injection** — synthetic events are inserted at fractional sequence positions to maintain ordering

## Schema

### `simulation_sessions`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Session identifier |
| tenant_id | UUID | Tenant scope (RLS) |
| simulation_type | TEXT | replay / what_if / forecast |
| status | TEXT | pending / running / completed / failed |
| config | JSONB | Full replay configuration |
| replay_from | TIMESTAMPTZ | Start of replay window |
| replay_to | TIMESTAMPTZ | End of replay window |
| replay_checksum | TEXT | SHA-256 of replayed event sequence |

### `simulation_events`
Synthetic events injected during what-if scenarios. Never written to `realtime_event_log`.

### `simulation_results`
Projected outcomes from a simulation session. Read-only after completion.

## Replay Checksum

The checksum is a rolling SHA-256 over the ordered event sequence:

```
checksum_0 = ''
checksum_i = SHA256(checksum_{i-1} + ':' + event_id + ':' + sequence_number)
final = checksum_n  (or SHA256('empty') for empty list)
```

The same algorithm is used in the Audit Verifier (`computeChainHash`) ensuring cross-system consistency.

Crucially, the replay engine **sorts by `sequence_number` before hashing**, so the checksum is stable regardless of insertion order.

## State Accumulator

`_applySimulatedEvent(state, event)` accumulates simulation state as a pure function:

| Event Type | State Change |
|-----------|-------------|
| `action_escalated` | escalationCount++ |
| `sla_breached` | slaBreachCount++ |
| `sla_paused` | pausedCount++ |
| `action_completed` | completedCount++, openCount-- (min 0) |
| `action_created` | openCount++ |
| `blocker_added` | blockerCount++ |
| `blocker_resolved` | blockerCount-- (min 0) |
| `readiness_changed` | readinessScore = payload.score (if numeric) |

The function never mutates the input state — it spreads into a new object.

## Projected Readiness

`_projectReadiness(state)` maps simulated state to a readiness score (0–100):

```
score = 100 - (slaBreachCount × 10) - (escalationCount × 5)
             - (blockerCount × 8) - (openCount × 0.5)
Returns 95 when openCount=0 and escalationCount=0 and slaBreachCount=0
Always clamped to [0, 100]
```

## What-If Scenario Injection

Synthetic events specify `inject_at` (sequence_number). The engine merges them with historical events, using fractional positions to preserve order (e.g., `inject_at=3` inserts between seq 3 and seq 4). After merge, all sequence numbers are normalized to contiguous integers.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/simulation/replay` | Start replay (async, returns 202 + session_id) |
| POST | `/api/v1/simulation/what-if` | Run what-if scenario (sync) |
| GET | `/api/v1/simulation/:id/results` | Get simulation results |
| GET | `/api/v1/simulation` | List recent sessions |

## Frontend: OperationalReplayViewer

The `OperationalReplayViewer` component provides a UI for configuring replay time ranges and injecting synthetic events for what-if analysis. Results are rendered by the embedded `SimulationResultViewer` component, which displays projected metrics, bottleneck tags, and the replay SHA-256 checksum.
