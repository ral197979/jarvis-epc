# Customer Success and Adoption (Post-GA)

**Program:** Post-GA Operationalization  
**Domain:** Customer Engagement & Retention  
**Service:** `customerAdoptionOptimizer`  
**Component:** `OperationalMaturityHeatmap`  
**Owner:** Denver Engineering — Customer Success  

---

## Purpose

The Customer Success and Adoption program moves beyond launch to measure real-world value delivery. It tracks behavioral signals across all tenants, computes adoption health scores, identifies churn risk early, and generates targeted intervention recommendations to maximize long-term retention.

---

## Adoption Score Formula

The adoption score is a weighted composite of three behavioral signals:

```
adoptionScore = round(
    dailyActiveRate     × 100 × 0.40 +
    workflowCompletion  × 100 × 0.35 +
    aiAcceptanceRate    × 100 × 0.25
)
```

| Signal                | Weight | Rationale                                       |
|----------------------|--------|-------------------------------------------------|
| Daily active rate     | 40%    | Primary engagement signal — are users returning? |
| Workflow completion   | 35%    | Value delivery signal — are workflows finishing? |
| AI acceptance rate    | 25%    | Trust signal — are users accepting AI guidance?  |

---

## Adoption Tier Classification

| Tier         | Score Range | Description                               |
|-------------|-------------|-------------------------------------------|
| `new`       | 0 – 24      | Just onboarded, minimal engagement        |
| `activating`| 25 – 49     | Beginning to use core features            |
| `active`    | 50 – 69     | Regular use of primary workflows          |
| `power`     | 70 – 84     | Deep engagement across feature set        |
| `champion`  | 85 – 100    | Maximum value realization                 |

The platform adoption target is **maturity score ≥ 65** (`ADOPTION_TARGET_MATURITY`).

---

## Churn Risk Model

Churn risk is computed from adoption score and engagement signals:

```
baseRisk = (1 - adoptionScore / 100) × 0.60
if dailyActiveRate < 0.30: baseRisk += 0.20
if workflowCompletion < 0.50: baseRisk += 0.20
churnRisk = min(1.0, baseRisk)
```

A tenant is **at risk** when `churnRisk >= 0.35`.

---

## Intervention System

The intervention engine generates targeted actions based on tenant signals:

| Intervention           | Trigger Condition                            |
|-----------------------|----------------------------------------------|
| `churn_recovery`      | `churnRisk >= 0.35`                          |
| `onboarding_assist`   | `adoptionScore < 25`                         |
| `feature_enablement`  | `aiAcceptanceRate < 0.50`                    |
| `adoption_coaching`   | `workflowCompletionRate < 0.60`              |

Multiple interventions can apply simultaneously. The intervention list is ordered by priority in the response.

---

## Adoption Health Definition

A tenant is **adoption healthy** when:
- `adoptionScore >= 65` AND
- `churnRisk < 0.35`

Both conditions must hold. A high-scoring tenant with elevated churn risk is still flagged for intervention.

---

## Tenant Isolation

- `assessTenantAdoption()` uses `pool.query()` (customer success writes to centralized table)
- `getTenantAdoption()` uses `tenantQuery()` for RLS-enforced reads
- `getAtRiskTenants()` is an admin-level query using `pool.query()`

---

## Operational Runbook

**Weekly adoption assessment:**
1. For each active tenant, call `assessTenantAdoption(tenantId, dailyActive, workflowCompletion, aiAcceptance, maturityLevel)`
2. `getAtRiskTenants()` — retrieve all tenants with `churnRisk >= 0.35`
3. Review `recommendedInterventions` per tenant
4. Assign customer success actions based on intervention type

**Responding to churn risk:**
- `churn_recovery`: Schedule executive business review within 72 hours
- `onboarding_assist`: Assign dedicated onboarding specialist
- `feature_enablement`: Schedule feature training session
- `adoption_coaching`: Deliver workflow optimization consultation

---

## Database Tables

| Table                    | Description                                          |
|-------------------------|------------------------------------------------------|
| `pga_customer_adoption` | Per-tenant adoption snapshots with intervention recs |
