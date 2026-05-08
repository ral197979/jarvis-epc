# Controlled Evolution Framework

**Denver Engineering — Phase 12**  
**Status:** Active | **Version:** 12.0.0

---

## Overview

All architectural changes to the platform must pass through the evolution framework before being accepted. Four services enforce safety gates, budget limits, coupling analysis, and governance impact estimation to prevent uncontrolled growth.

---

## Services

| Service | Purpose |
|---------|---------|
| `architectureEvolutionGuard` | Validates changes against guard check rules |
| `complexityBudgetEngine` | Enforces complexity budget limits |
| `subsystemDependencyAnalyzer` | Analyzes coupling between subsystems |
| `governanceImpactEstimator` | Estimates governance risk of proposed changes |

---

## Architecture Evolution Guard

### Check Evaluation
```
passed = currentValue ≤ threshold
```

### Pass Rate
```
guardPassRate = passed / total   (1.0 for empty set)
```

### Blocking Failures
```
hasBlockingFailures = any failed check with category in ('governance_risk', 'replay_surface')
```

Blocking failures prevent the change from proceeding, regardless of other checks.

---

## Complexity Budget

### Scoring Formula
```
complexityScore = serviceCount × 3
               + averageDependencies × 10
               + replaySurface × 5
               + pluginCount × 2
```

```
COMPLEXITY_BUDGET_LIMIT = 1000

isOverBudget = complexityScore > 1000
budgetUtilization = complexityScore / 1000
```

### Risk Classification

| Utilization | Risk |
|-------------|------|
| > 100% | `critical` |
| > 85% | `high` |
| > 65% | `medium` |
| ≤ 65% | `low` |

---

## Subsystem Dependency Analysis

### Tight Coupling
```
isTightlyCoupled = couplingScore ≥ 0.70
```

### Average Coupling
```
avgCoupling = sum(couplingScores) / count   (0 for empty)
```

### High-Risk Dependencies
```
isHighRisk = couplingScore ≥ 0.70 AND (replayDependent OR governanceDependent)
```

### Coupling Risk

| Condition | Risk |
|-----------|------|
| avgCoupling ≥ 0.70 OR highRiskCount ≥ 5 | `high` |
| avgCoupling ≥ 0.45 OR highRiskCount ≥ 2 | `medium` |
| Otherwise | `low` |

---

## Governance Impact Estimation

### Overall Risk
```
overallRisk = max(replayImpact, governanceRisk, tenantImpact)
```

Risk rank: `none (0) < low (1) < medium (2) < high (3)`

### Approval Requirements
```
requiresApproval = overallRisk ∈ {'medium', 'high'}

isChangeBlocked = overallRisk = 'high' AND approved = false
```

---

## Change Acceptance Criteria

For a change to be accepted, all of the following must hold:

| Check | Requirement |
|-------|-------------|
| Guard checks | No blocking failures in `governance_risk` or `replay_surface` categories |
| Complexity budget | Resulting score ≤ 1000 |
| Coupling risk | Not `high` (or approved exception) |
| Governance impact | Not `high` OR `approved = true` |
| Replay surface | Guard check passes |

---

## Key Tables

| Table | Description |
|-------|-------------|
| `p12_evolution_guard_checks` | Per-check validation records |
| `p12_complexity_budget` | Environment complexity snapshots |
| `p12_subsystem_dependencies` | Subsystem coupling scores |
| `p12_governance_impact_estimates` | Change impact assessments |

---

## Operational Guidance

- **Blocked changes** (`high` risk, unapproved) require written approval from the governance committee.
- Complexity budget violations trigger a mandatory architecture review sprint before the change is accepted.
- Coupling risk of `high` triggers a decomposition proposal — tight coupling to replay or governance subsystems must be addressed within 2 sprints.
- Guard checks run on every PR that touches service count, dependency count, replay surface, or plugin count.
- All guard check records are append-only for audit traceability.
