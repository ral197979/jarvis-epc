# Deployment Reliability Refinement (Post-GA)

**Program:** Post-GA Operationalization  
**Domain:** Production Reliability Operations  
**Services:** `deploymentOperationsCoordinator`, `rolloutWaveManager`  
**Owner:** Denver Engineering — Reliability Engineering  

---

## Purpose

Deployment Reliability Refinement closes the loop between pre-launch validation and real production outcomes. It tracks deployment patterns, wave success rates, and launch failures to continuously improve the criteria and processes that govern tenant activation.

---

## Key Reliability Metrics

| Metric                    | Target    | Description                                   |
|--------------------------|-----------|-----------------------------------------------|
| Wave success rate         | ≥ 80%     | `deployedCount / (deployedCount + failedCount)` |
| Gate pass rate            | ≥ 95%     | Fraction of launch gates in `pass` status     |
| Replay validation rate    | 100%      | All waves must have replay validated          |
| Deployment readiness score| ≥ 80      | Composite score before `ready` status         |

---

## Wave Reliability Model

### Success Rate Formula
```
waveSuccessRate = deployedCount / (deployedCount + failedCount)
```
If no deployments attempted: `1.0` (no failures by definition).

### Abort Criteria
A wave must be aborted when either condition is true:
- `replayValidated === false` — wave was created without replay validation
- `waveSuccessRate < 0.80` — more than 20% of deployment attempts failed

Abort is irreversible within a wave cycle. A new wave must be created after root cause analysis.

### Progress Tracking
```
waveProgress = round(deployedCount / targetCount × 100)%
```
Waves auto-transition to `completed` status when `deployedCount >= targetCount`.

---

## Deployment Status Lifecycle

```
not_ready ──────────────────→ ready ──→ deployed
    ↑                           |
    └───── (failed gate) ───────┘
```

The `failed` status captures tenants where deployment was attempted but encountered post-launch errors.

---

## Reliability Improvement Loop

1. **Measure**: Collect wave outcomes (`advanceWave` updates deployed/failed deltas)
2. **Analyze**: Identify patterns in failures by gate category and cluster
3. **Adjust**: Update gate thresholds or wave batch sizes based on failure patterns
4. **Validate**: Confirm adjustments with replay before next wave launch

---

## Gate Reliability by Category

| Gate Category | Reliability Priority | Zero-Tolerance |
|--------------|----------------------|----------------|
| `replay`     | Critical             | Yes            |
| `governance` | Critical             | Yes            |
| `onboarding` | High                 | No             |
| `infra`      | High                 | No             |
| `data`       | Medium               | No             |

Zero-tolerance gates must all pass regardless of the overall pass rate. A 99% pass rate does NOT satisfy a failed replay gate.

---

## Continuous Improvement Protocol

After each wave completes or is aborted:
1. Compute wave success rate
2. Review failed deployments for common root causes
3. If replay was not validated: Add replay validation as a pre-wave gate
4. Adjust wave batch size if failures cluster on resource contention
5. Update launch gate thresholds if systematic over/under-reporting detected
6. Document changes in the wave's completion notes

---

## Database Tables

| Table                          | Description                                          |
|-------------------------------|------------------------------------------------------|
| `pga_rollout_waves`           | Wave records with deployed/failed counters           |
| `pga_tenant_launch_records`   | Per-tenant readiness and deployment status           |
| `pga_launch_gates`            | Gate results with historical audit trail             |
