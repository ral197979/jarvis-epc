# Deployment Reliability Improvement

**Denver Engineering — Phase 12**  
**Status:** Active | **Version:** 12.0.0

---

## Overview

Three services provide end-to-end deployment confidence: pre-deployment confidence scoring, rollout health verification, and migration replay safety validation. Together they enforce that no deployment proceeds with unsafe replay or rollback posture.

---

## Services

| Service | Purpose |
|---------|---------|
| `deploymentReliabilityEngine` | Computes weighted deployment confidence score |
| `rolloutVerificationService` | Verifies rollout health via error rates and checks |
| `migrationReplayValidator` | Validates replay hash integrity across migrations |

---

## Deployment Confidence Score

### Formula
```
overallConfidence = round(
  canaryHealthScore      × 0.30 +
  migrationSafetyScore   × 0.25 +
  rollbackReadinessScore × 0.20 +
  replayVerificationScore × 0.25
)
```

### Deployment Action

| Condition | Recommendation |
|-----------|---------------|
| replayVerification < 70 OR rollback < 50 | `abort` |
| overallConfidence ≥ 80 | `proceed` |
| Otherwise | `pause` |

`abort` conditions are checked first and take priority over confidence level.

```
DEPLOYMENT_CONFIDENCE_THRESHOLD = 80
```

### Safety Gate
```
isDeploymentSafe = recommendation = 'proceed' AND replayVerificationScore ≥ 80
```

---

## Rollout Verification

### Verified Conditions (ALL must hold)
1. `errorRateInWindow ≤ 0.01`
2. `p95InWindow ≤ 300ms`
3. `checksRun > 0`
4. `checksPassed / checksRun ≥ 0.95`

### Check Pass Rate
```
verificationCheckRate = checksPassed / checksRun   (0 if checksRun = 0)
```

### Rollout Health Classification
| Condition | Health |
|-----------|--------|
| errorRate > 0.05 OR p95 > 500ms | `failing` |
| errorRate > 0.01 OR p95 > 300ms | `degraded` |
| Otherwise | `healthy` |

`failing` takes priority over `degraded`.

---

## Migration Replay Validation

### Data Hash
```
migrationDataHash = SHA-256(
  rows.map(r => JSON.stringify(r, Object.keys(r).sort())).join('\n')
)  →  64-char hex
```

Keys are sorted at every row for canonical consistency.

### Safe Migration Conditions
```
isMigrationReplaySafe = hashMatch AND rowsMismatched === 0
```

### Mismatch Rate
```
mismatchRate = rowsMismatched / rowsValidated   (0 if rowsValidated = 0)
```

---

## Key Tables

| Table | Description |
|-------|-------------|
| `p12_deployment_confidence` | Per-deployment confidence records |
| `p12_rollout_verifications` | Rollout health check results |
| `p12_migration_replay_checks` | Pre/post migration hash comparisons |

---

## Deployment Gate Checklist

Before any production deployment, confirm:

- [ ] `deploymentReliabilityEngine` recommendation = `proceed`
- [ ] `replayVerificationScore ≥ 80`
- [ ] `rolloutVerificationService.isRolloutVerified = true`
- [ ] Migration replay check: `hashMatch = true` AND `rowsMismatched = 0`
- [ ] No open critical governance regressions
- [ ] Complexity budget utilization < 100%

---

## Operational Guidance

- An `abort` recommendation **blocks the deployment pipeline** automatically.
- `pause` recommendations require a deployment review meeting before proceeding.
- Migration hash mismatches are **never auto-corrected** — always escalate to engineering.
- Rollout verifications run against a tenant sample; sample size must be ≥ 5% of active tenants.
- All deployment records are append-only for full post-mortem auditability.
