# Deployment Automation Guide — Phase 11

**Denver Engineering · GA Operations**
**Version:** 11.0.0

---

## Overview

Phase 11 provides fully automated deployment orchestration via `deploymentAutomationEngine` and `rolloutCoordinator`. This guide covers deployment strategies, rollout plan management, wave coordination, and rollback procedures.

---

## Deployment Strategies

| Strategy | Use Case | Risk |
|---|---|---|
| `immediate` | Critical hotfixes, single tenant | High — no gradual rollout |
| `blue_green` | Infrastructure changes, zero-downtime swaps | Medium |
| `canary` | Feature flags, experimental changes | Low — partial traffic only |
| `wave` | GA rollouts across all tenants | Lowest — gated by success criteria |

---

## Rollout Plans

A `RolloutPlan` defines how a deployment propagates across tenants.

### Canary Configuration

```typescript
computeCanaryTenantCount(totalTenants, canaryPct):
  max(1, floor(totalTenants × canaryPct / 100))
```

Example: 1000 tenants, 10% canary → 100 canary tenants (minimum 1 always selected)

### Progress Tracking

```typescript
computeRolloutProgress(plan):
  (deployed + failed) / total × 100
```

### Health Checks

```typescript
isRolloutHealthy(plan):
  failureRate = failed / total
  return failureRate <= 0.05  // ≤ 5% failure rate

shouldRollback(plan):
  failureRate = failed / total
  return failureRate > 0.10  // > 10% failure rate triggers auto-rollback
```

---

## Deployment Waves

Waves allow staged GA rollout across customer groups. Managed by `rolloutCoordinator`.

### Wave Lifecycle

```
planned → in_progress → completed
                ↓
             paused → in_progress (resumed)
                ↓
             failed
```

### Wave Status Transitions

| Current Status | Action | New Status |
|---|---|---|
| `planned` | Start | `in_progress` |
| `in_progress` | Complete | `completed` |
| `in_progress` | Pause | `paused` |
| `paused` | Resume | `in_progress` |

### Wave Health

```typescript
computeWaveSuccessRate(wave):
  successful / (complete + failed)
  // Returns 0 if no complete + failed rollouts

isWaveComplete(wave):
  all rollout statuses in ['complete', 'failed', 'skipped']
```

---

## Deployment Wave Tracker UI

The `DeploymentWaveTracker` component shows each wave with:
- Progress bar (% of tenants deployed)
- Status badge
- Expandable card: customer list + success criteria
- Action buttons: **Start** / **Complete** / **Pause** / **Resume**

Waves are shown in order. Only one wave should be `in_progress` at a time.

---

## Standard Wave Structure (GA Rollout)

Recommended wave plan for a 1,000-tenant GA rollout:

| Wave | Name | Tenants | Success Criteria |
|---|---|---|---|
| 1 | Internal / Dogfood | 5 | Zero incidents, all health checks green |
| 2 | Early Adopters | 50 | Error rate < 0.5%, p95 < 200ms |
| 3 | Pilot Graduates | 200 | Health score ≥ 70, error rate < 1% |
| 4 | Growth Tier | 400 | Throughput baseline met, no regressions |
| 5 | Full GA | 345 | Standard SLA thresholds |

Gate between waves: wait for `computeWaveSuccessRate ≥ 0.95` before starting next wave.

---

## Per-Tenant Rollout Statuses

Each `TenantRollout` within a wave has status:

| Status | Description |
|---|---|
| `pending` | Queued for this wave |
| `in_progress` | Deployment actively running |
| `complete` | Successfully deployed |
| `failed` | Deployment failed |
| `skipped` | Skipped (e.g., tenant opted out) |
| `rolled_back` | Deployment reverted |

---

## Rollback Procedures

### Automatic Rollback

`shouldRollback` triggers at > 10% failure rate. When triggered:

1. Stop dispatching new deployments in the wave
2. Run `POST /api/phase11/rollouts/:id/rollback` for all `failed` tenants
3. Pause the wave
4. Alert engineering on-call and deployment owner
5. Investigate root cause before resuming

### Manual Rollback

For individual tenant rollback:

```typescript
import { rollbackTenantDeployment } from '../services/phase11/rolloutCoordinator'

await rollbackTenantDeployment(rolloutId)
// Throws TenantRolloutNotFoundError if rolloutId is invalid
```

### Safe Rollback Checklist

- [ ] Verify `canRollback(importJob) === true` for any data migrations
- [ ] Confirm replay ledger integrity is maintained post-rollback
- [ ] Verify RLS policies still active after infrastructure rollback
- [ ] Check audit log continuity (no gaps introduced)
- [ ] Run governance audit after rollback completes

---

## Migration Safety Before Deployment

Run `migrationSafetyValidator` before any deployment that includes DB migrations:

```typescript
const result = await runMigrationSafetyChecks()

if (!isMigrationSafe(result)) {
  const blocking = result.blockers.filter(b => b.severity === 'critical')
  // Abort deployment, report blockers
}
```

---

## CI/CD Integration

Recommended deployment pipeline:

```
1. Run scale validation (loadSimulationRunner)
2. Check performance regression (performanceRegressionAnalyzer)
3. Run migration safety check (migrationSafetyValidator)
4. Deploy canary (5% of tenants)
5. Monitor for 30 min — check isRolloutHealthy
6. If healthy: proceed to full wave rollout
7. If shouldRollback: stop and alert
```

Gates that block deployment advancement:
- `hasCriticalRegression === true`
- `isMigrationSafe === false`
- `shouldRollback === true` (> 10% failure rate in canary)
- Any `governance_drift_detector.hasCriticalDrift === true`
