# Customer Success Optimization

**Denver Engineering — Phase 12**  
**Status:** Active | **Version:** 12.0.0

---

## Overview

Three services work together to score tenant health, predict churn, identify adoption gaps, and generate acceleration plans. Together they provide CSMs with quantified signals and concrete next actions.

---

## Services

| Service | Purpose |
|---------|---------|
| `customerSuccessOptimizer` | Computes overall success score and churn risk |
| `adoptionAccelerationEngine` | Identifies adoption gaps and generates action plans |
| `operationalMaturityScorer` | Measures tenant operational maturity across 5 dimensions |

---

## Customer Success Score

### Formula
```
overallScore = round(
  onboardingScore × 0.20 +
  adoptionScore   × 0.30 +
  maturityScore   × 0.25 +
  supportHealth   × 0.15 +
  aiUsageScore    × 0.10
)
```

All inputs are 0–100.

### Churn Risk Score
```
churnRisk = (1 − overall/100)
          + (adoptionScore < 40 ? +0.20 : 0)
          + (supportHealth < 50 ? +0.15 : 0)

Capped at 1.0
```

```
CHURN_RISK_SCORE_THRESHOLD = 0.35
isAtChurnRisk = churnRisk ≥ 0.35
```

---

## Maturity Level Classification

| Score | Level |
|-------|-------|
| ≥ 90 | `optimized` |
| ≥ 75 | `advanced` |
| ≥ 60 | `proficient` |
| ≥ 40 | `developing` |
| < 40 | `starter` |

---

## Adoption Acceleration

### Gap and Velocity
```
adoptionGap = max(0, targetAdoption − currentAdoption)
daysToTarget = ceil(gap / dailyGrowthRate)
             = 999 if dailyGrowthRate = 0
             = 0   if gap = 0
```

### Recommendation Triggers

| Condition | Recommendation |
|-----------|---------------|
| `onboardingFrictionScore > 0.4` | Reduce onboarding friction |
| `aiAcceptanceRate < 0.5` | Improve AI recommendation quality |
| `workflowCompletionRate < 0.7` | Address workflow completion blockers |
| `adoptionScore < 30` | Activate adoption coaching program |

Up to all 4 recommendations may be generated simultaneously.

---

## Operational Maturity Score

### Formula
```
overallMaturity = round(
  workflowScore    × 0.25 +
  governanceScore  × 0.25 +
  integrationScore × 0.20 +
  aiUsageScore     × 0.15 +
  supportScore     × 0.15
)
```

### Maturity Gate
```
MATURITY_SCORE_THRESHOLD = 65

isOperationallyMature = overallMaturity ≥ 65 AND governanceScore ≥ 70
```

### Weakest Dimension
Returns the dimension name with the lowest score across: `workflow`, `governance`, `integration`, `aiUsage`, `support`.

---

## Intervention Playbooks

| Trigger | Intervention |
|---------|-------------|
| churnRisk ≥ 0.35 | Churn recovery plan — CSM executive sponsor outreach |
| adoptionScore < 40 | Adoption coaching — scheduled feature walkthroughs |
| supportHealth < 50 | Support review — ticket audit + dedicated support slot |
| onboardingScore < 50 | Onboarding assistance — guided setup session |

---

## Key Tables

| Table | Description |
|-------|-------------|
| `p12_customer_success_scores` | Per-tenant scored records |
| `p12_adoption_acceleration_plans` | Generated plans with target/gap/recommendations |
| `p12_operational_maturity_scores` | Per-tenant maturity assessments |

---

## Operational Guidance

- **At-risk tenants** (`churnRisk ≥ 0.35`) receive a CSM contact within 24 hours.
- **Maturity score below 40** triggers enrollment in the onboarding assistance program.
- Acceleration plans are regenerated automatically when adoption metrics change by ≥ 10 points.
- All score records are append-only; never overwrite historical scores.
