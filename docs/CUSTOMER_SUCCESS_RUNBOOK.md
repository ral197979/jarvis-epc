# Customer Success Runbook — Phase 11

**Denver Engineering · GA Operations**
**Version:** 11.0.0

---

## Overview

This runbook guides CSM and Support teams through standard customer success workflows: activation tracking, health monitoring, escalation, and churn recovery. All procedures are backed by Phase 11 services.

---

## Activation Board (5-Stage Kanban)

The `CustomerActivationBoard` component and `customerGoLiveTracker` track customers through:

```
Invited → Provisioned → Onboarding → Active → Converted
```

Activation progress:
```typescript
computeActivationProgress(milestones) = round((achieved / total) × 100)
```

A customer is considered **activated** when `status === 'active'` OR `status === 'converted'`.

Days to go-live:
```typescript
computeDaysToGoLive(targetDate) = ceil((targetDate - now) / 86400000)
```

---

## Daily CSM Workflow

### 1. Morning Health Review (15 min)
- Open `PilotLaunchCenter` — filter to `at_risk` tab
- For each at-risk tenant: check `healthScore`, `churnRisk`, `incidentCount`
- Priority order: `churnRisk='high'` → `healthScore < 40` → `healthScore < 70`

### 2. Activation Board Sweep (10 min)
- Open `CustomerActivationBoard`
- Identify any tenants stuck in a stage for > 7 days
- Follow up with implementation contact or push to next stage

### 3. Incident Review (10 min)
- Check `SupportCommandCenter` triage queue
- Review any `shouldEscalateToEngineering = true` items with engineering
- Close resolved tickets with root cause note

---

## Health Intervention Playbooks

### Playbook A: Low Onboarding Score (< 60)

**Trigger:** `pilotTenant.onboardingScore < 60` after 7 days in `onboarding` state

Steps:
1. Schedule 30-min walkthrough call with primary contact
2. Share onboarding guide and video resources
3. Complete the go-live checklist `user_training_done` item together
4. Set 3-day follow-up to verify progress
5. If no improvement after 14 days → escalate to Level 2

---

### Playbook B: Low Adoption Score (< 40%)

**Trigger:** `adoptionScore < 0.40` after 14 days `active`

Steps:
1. Review which features are unused via `AdoptionReadinessPanel`
2. Identify blockers (configuration, permission, integration issues)
3. Schedule feature-specific training for underused workflows
4. Assign "adoption champion" contact at tenant
5. Set weekly adoption check-ins for 30 days

---

### Playbook C: Churn Risk = High

**Trigger:** `computeChurnRisk` returns `'high'`
Conditions: `adoptionScore < 20%` OR `healthScore < 40`

Steps:
1. **Immediate:** Executive sponsor call within 24 hours
2. Document all open concerns from tenant
3. Create dedicated remediation plan with 3 measurable milestones
4. Weekly engineering + CSM check-in until health recovers
5. If no improvement in 30 days → review contract terms with leadership

---

### Playbook D: Adoption Stall

**Trigger:** `evaluateAdoptionStall` returns warning or critical

| Condition | Alert Level |
|---|---|
| Days ≥ 30 OR adoptionScore < 20% | Critical |
| Days ≥ 14 OR adoptionScore < 40% | Warning |

Steps:
1. Audit workflow completion logs to identify stall point
2. Check for integration failures blocking workflow
3. Review AI acceptance rate — low rate may indicate training gap
4. Offer a joint workflow workshop

---

## Incident Cluster Monitoring

The `IncidentClusterViewer` groups incidents by type and tenant impact.

Key thresholds:
- `isClusterSignificant`: ≥ 3 incidents in cluster
- Severity: ≥ 10 tenants OR ≥ 20 incidents → critical

CSM response by cluster severity:

| Severity | Response |
|---|---|
| `low` | Monitor; no action unless cluster grows |
| `medium` | Proactive communication to affected tenants |
| `high` | Outbound call to affected tenant contacts |
| `critical` | Executive notification + status page update |

### Auto-Escalation Rules

`shouldEscalateToEngineering` returns `true` when:
- `priority === 'critical'`
- `clusterType === 'replay_divergence'`
- `clusterType === 'unknown'`

These always go directly to the engineering on-call queue, bypassing CSM triage.

---

## Tenant Health Alerts

Three alert types from `tenantHealthEscalation`:

| Alert Type | Condition | CSM Action |
|---|---|---|
| Health warning | score 40–69 | Contact within 48h |
| Health critical | score < 40 | Contact within 4h |
| Adoption stall warning | 14+ days stalled | Review adoption plan |
| Adoption stall critical | 30+ days OR score < 20% | Emergency intervention |
| Incident spike warning | 3–9 incidents | Monitor closely |
| Incident spike critical | ≥ 10 incidents | Coordinate with engineering |

---

## Reporting

### Weekly Pilot Health Report

Compile weekly from `pilotOperationsService`:
- Total active pilots
- Count by status (at_risk, healthy, converting)
- Average health score across all pilots
- Churn risk distribution (high/medium/low)
- Pilots graduated this week

### Monthly Activation Metrics

From `customerGoLiveTracker.getActivationSummary`:
- Funnel conversion rates by stage
- Average days per stage
- Go-lives completed
- Churn rate (at-risk that converted to churned)
