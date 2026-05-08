# Pilot Operations Guide — Phase 11

**Denver Engineering · GA Operations**
**Version:** 11.0.0

---

## Overview

This guide covers the end-to-end lifecycle for pilot tenant operations: onboarding, health monitoring, churn risk management, and graduation to GA conversion.

---

## Pilot Lifecycle States

```
invited → provisioned → onboarding → active → converted
                                    ↓
                                 at_risk
```

| State | Description | Actions Available |
|---|---|---|
| `invited` | Tenant created, credentials sent | Advance to provisioned |
| `provisioned` | Infrastructure ready | Begin onboarding |
| `onboarding` | Actively completing checklist | Monitor health |
| `active` | Onboarding complete, using platform | Activate, escalate |
| `at_risk` | Health score < 70 or churn risk elevated | Escalate to CSM, intervene |
| `converted` | Pilot graduated to paid GA | Archive pilot record |

---

## Health Score Calculation

Pilot health is computed by `pilotOperationsService.computeHealthScore`:

```
healthScore = (onboardingScore × 0.30)
            + (trainingScore × 0.20)
            + (adoptionScore × 0.40)
            - min(incidentCount × 2, 10)

Range: 0–100, clamped at minimum 0
```

| Score Range | Status | Action |
|---|---|---|
| ≥ 70 | Healthy | Standard monitoring |
| 40–69 | At Risk | CSM outreach within 48h |
| < 40 | Critical | Escalate immediately |

**Example:** onboarding=100, training=100, adoption=100, incidents=5 → score=80

---

## Churn Risk Assessment

`computeChurnRisk` evaluates:

| Condition | Risk Level |
|---|---|
| `adoptionScore < 20%` OR `healthScore < 40` | `high` |
| `adoptionScore < 40%` OR `healthScore < 70` | `medium` |
| Otherwise | `low` |

`isPilotAtRisk` returns true when:
- `healthScore < 70` OR
- `churnRisk === 'high'`

---

## Adoption Metrics

Tracked via `getPilotAdoptionMetrics` (uses `tenantQuery` for RLS isolation):

| Metric | Description | Target for Graduation |
|---|---|---|
| `feature_adoption` | % of features used at least once | ≥ 60% |
| `workflow_completion` | % of started workflows completed | ≥ 70% |
| `ai_acceptance` | % of AI suggestions accepted | ≥ 50% |
| `onboarding_completion` | % of onboarding steps done | 100% |
| `tenant_maturity` | Composite maturity score | ≥ 65% |

---

## Go-Live Checklist

The `deploymentReadinessChecklist` tracks 8 checklist items, 6 of which are required for go-live:

| Key | Required | Description |
|---|---|---|
| `infrastructure_provisioned` | ✅ | Infrastructure fully provisioned |
| `data_migration_complete` | ✅ | All data migrated and validated |
| `user_training_done` | ✅ | Users trained on platform |
| `integrations_verified` | ✅ | All integrations tested |
| `security_review_passed` | ✅ | Security review cleared |
| `performance_baseline_met` | ✅ | Meets performance requirements |
| `disaster_recovery_tested` | — | DR runbook tested |
| `rollback_plan_documented` | — | Rollback procedure documented |

`isReadyForGoLive` requires all 6 required items completed.

---

## Pilot Monitoring Cadence

| Frequency | Activity |
|---|---|
| Daily | Review health scores for all at_risk pilots |
| Weekly | Full pilot health report across all active pilots |
| Weekly | Churn risk review with CSM team |
| Bi-weekly | Adoption trend analysis via `telemetryTrendAnalyzer` |
| Monthly | Graduation eligibility review |

### Daily Health Check Query

```typescript
import { getAllPilots, computeHealthScore, isPilotAtRisk } from '../services/phase11/pilotOperationsService'

const pilots = await getAllPilots()
const atRisk = pilots.filter(p => isPilotAtRisk({
  healthScore: computeHealthScore(p),
  churnRisk: computeChurnRisk(p),
}))
// Escalate atRisk pilots to CSM queue
```

---

## Escalation Procedures

### Level 1: CSM Outreach (health 40–69)
- CSM contacts tenant within 48 hours
- Review onboarding blockers
- Schedule training session if `trainingScore < 60`
- Document outreach in pilot notes

### Level 2: Engineering Escalation (health < 40)
- Escalate to engineering and CSM simultaneously
- Root cause investigation within 24 hours
- May pause billing during remediation
- Update pilot status to `at_risk`

### Level 3: Churn Recovery (churnRisk = 'high')
- Executive involvement within 72 hours
- Custom remediation plan with specific milestones
- Weekly check-ins until health score recovers to ≥ 70

---

## Graduation to GA

A pilot is eligible for GA conversion when:
1. `healthScore ≥ 70` for ≥ 30 consecutive days
2. `churnRisk === 'low'`
3. All 6 required checklist items complete
4. `adoptionScore ≥ 40%`
5. No open critical incidents

Graduation process:
1. CSM confirms tenant is ready
2. Run `updatePilotStatus(tenantId, 'converted')` — sets `converted_at = NOW()`
3. Migrate tenant to production billing tier
4. Archive pilot monitoring record
5. Hand off to standard customer success process
