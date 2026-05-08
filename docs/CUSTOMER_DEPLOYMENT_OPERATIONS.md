# Customer Deployment Operations (Post-GA)

**Program:** Post-GA Operationalization  
**Domain:** Tenant Launch & Rollout Wave Management  
**Services:** `deploymentOperationsCoordinator`, `rolloutWaveManager`, `tenantLaunchValidator`  
**Owner:** Denver Engineering — Deployment Operations  

---

## Purpose

The Customer Deployment Operations program ensures every tenant activation in production meets verified readiness criteria before launch. It replaces ad-hoc deployment decisions with a structured gate system that enforces replay validation, governance verification, and onboarding completeness as launch preconditions.

---

## Readiness Score Formula

The deployment readiness score for each tenant is computed as:

```
readinessScore = min(100, round(gatePassRate × 60 + bonus))

bonus = (onboardingComplete ? 15 : 0)
      + (replayValidated    ? 15 : 0)
      + (governanceVerified ? 10 : 0)
```

| Component         | Max Points | Condition                         |
|-------------------|-----------|-----------------------------------|
| Gate pass rate    | 60        | Scales with fraction of gates passing |
| Onboarding        | 15        | All onboarding steps completed    |
| Replay validation | 15        | Replay sessions verified          |
| Governance        | 10        | Governance checks verified        |
| **Total**         | **100**   |                                   |

A tenant is ready to launch when `readinessScore >= 80` AND `replayValidated = true` AND `governanceVerified = true`.

---

## Launch Gate Validation

Each tenant must pass a set of named launch gates before activation. Gates are categorized as:

| Category     | Purpose                                      |
|-------------|----------------------------------------------|
| `replay`    | Replay determinism and session consistency   |
| `governance`| Policy enforcement and audit trail integrity |
| `onboarding`| Account setup and user provisioning          |
| `infra`     | Infrastructure health and capacity           |
| `data`      | Data migration and schema compatibility      |

Gate evaluation uses a tolerance-aware comparison:
- **Pass**: `currentValue >= requiredValue`
- **Warn**: `currentValue >= requiredValue × (1 - tolerance)` (default tolerance = 5%)
- **Fail**: Below warn threshold

Overall validation passes when:
1. Pass rate ≥ 95% across all gates
2. All `replay` category gates pass (zero tolerance)
3. All `governance` category gates pass (zero tolerance)

---

## Rollout Wave Strategy

Tenants are activated in controlled waves to limit blast radius:

```
Wave lifecycle: pending → active → completed
                              └─→ aborted (if shouldAbortWave)
```

A wave should be aborted when:
- `replayValidated = false` on the wave record, OR
- Wave success rate drops below 80% (`deployedCount / (deployedCount + failedCount) < 0.80`)

Wave progress is reported as: `round(deployedCount / targetCount × 100)%`

---

## Non-Negotiable Rules

- A tenant cannot be launched unless ALL replay gates pass. There is no override path.
- Governance gates must also all pass. Partial governance compliance is not accepted.
- The `markLaunched` service function enforces that only tenants in `ready` status can be activated.
- Wave abort decisions are computed deterministically and cannot be suppressed.

---

## Database Tables

| Table                          | Description                              |
|-------------------------------|------------------------------------------|
| `pga_tenant_launch_records`   | Per-tenant readiness state and status    |
| `pga_rollout_waves`           | Wave definitions and deployment counters |
| `pga_launch_gates`            | Per-tenant gate results                  |

---

## Operational Runbook

**Launch a tenant:**
1. Collect gate measurements → `runLaunchValidation(tenantId, gates)`
2. Verify `isValidationPassing(gates) === true`
3. Create launch record → `createLaunchRecord(tenantId, waveId, ...)`
4. Confirm `record.status === 'ready'`
5. Activate → `markLaunched(tenantId)`

**Handle a failing gate:**
1. `getFailedGates(gates)` to identify failures
2. Investigate the specific gate category
3. For replay failures: escalate to replay integrity team immediately
4. For governance failures: escalate to governance team
5. Re-run validation after remediation

**Monitor wave health:**
1. `getActiveWaves()` — list all in-flight waves
2. Check `shouldAbortWave(wave)` for each
3. If abort triggered: pause wave, notify tenant success team
