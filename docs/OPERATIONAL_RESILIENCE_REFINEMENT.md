# Operational Resilience Refinement

**Denver Engineering — Phase 12**  
**Status:** Active | **Version:** 12.0.0

---

## Overview

Resilience refinement monitors and actively improves the platform's ability to withstand and recover from failures. Three services cover composite resilience scoring, queue rebalancing, and failover coordination.

---

## Services

| Service | Purpose |
|---------|---------|
| `resilienceOptimizationEngine` | Computes weighted resilience score across 6 subsystems |
| `queueRebalancer` | Auto-scales consumer counts based on queue depth |
| `failoverRecoveryCoordinator` | Tracks failover events and validates replay safety |

---

## Resilience Score

### Formula
```
overallResilienceScore = round(
  workerHealth      × 0.20 +
  replayHealth      × 0.25 +
  websocketHealth   × 0.15 +
  queueHealth       × 0.15 +
  cacheHealth       × 0.10 +
  failoverReadiness × 100 × 0.15
)
```

All inputs are 0–100 except `failoverReadiness` which is 0–1.

### Health Gate
```
RESILIENCE_SCORE_THRESHOLD = 75

isResilienceHealthy = overallScore ≥ 75 AND replayHealth ≥ 80
```
Replay health has a hard minimum of 80 regardless of overall score.

### Weakness Detection
Priority order for identifying the weakest subsystem (first below 70):
1. `replay` (highest priority)
2. `worker`
3. `queue`
4. `websocket`
5. `cache`

Returns `null` if all subsystems score ≥ 70.

---

## Queue Rebalancing

### Target Consumer Count
| Queue Depth | Target |
|-------------|--------|
| ≤ 100 | current (no change) |
| ≤ 500 | max(current, 4) |
| ≤ 2000 | max(current, 8) |
| > 2000 | max(current, 16) |

Consumer count **never decreases** via rebalancing.

### Rebalance Trigger
```
isRebalanceNeeded = targetConsumers > currentConsumers
```

### Queue Health Score
```
ratio = queueDepth / consumerCount

ratio ≤ 10   →  100
ratio ≤ 50   →   80
ratio ≤ 200  →   60
ratio ≤ 500  →   40
ratio > 500  →   20
```

---

## Failover Recovery

### Success Rate
```
successRate = successful / total   (1.0 if total = 0)
```

### Replay Safety Requirement
```
isFailoverReplaySafe = replaySafe AND successful
```
A failover that did not complete successfully is never considered replay-safe.

### Severity Classification
| Condition | Severity |
|-----------|---------|
| affectedTenants ≥ 100 OR duration ≥ 300,000ms | `critical` |
| affectedTenants ≥ 20 OR duration ≥ 60,000ms | `high` |
| affectedTenants ≥ 5 OR duration ≥ 10,000ms | `medium` |
| Otherwise | `low` |

### Open Failovers
```
hasOpenFailovers = any record with recoveredAt = null
```
Open failovers older than 15 minutes at critical severity are P0 incidents.

---

## Key Tables

| Table | Description |
|-------|-------------|
| `p12_resilience_scores` | Per-environment resilience score snapshots |
| `p12_queue_balance` | Queue depth, consumer counts, target recommendations |
| `p12_failover_records` | Failover events with tenant impact and duration |

---

## Operational Guidance

- **Overall score < 75** triggers an immediate resilience review with the platform team.
- **Replay health < 80** is treated as a governance violation and blocks new deployments.
- Queue rebalancer runs every 30 seconds in production; manual override available via admin API.
- Critical failovers are auto-escalated to `engineering` tier in the escalation system.
- All failover records are append-only; recovery is recorded by setting `recoveredAt`, never by deletion.
