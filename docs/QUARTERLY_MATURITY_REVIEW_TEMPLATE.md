# Quarterly Operational Maturity Review — Template

**Program:** Operational Stewardship  
**Review Period:** Q[X] [YEAR] (e.g., Q2 2026)  
**Prepared By:** [Name]  
**Review Date:** [Date]  
**Platform Version:** [e.g., v13.2.0]  

---

## Executive Summary

> One paragraph: overall platform health this quarter, top 3 wins, top 3 risks, recommended focus for next quarter.

**Overall Health Rating:** ☐ Excellent (90–100) ☐ Good (75–89) ☐ Concerning (60–74) ☐ At Risk (<60)

**Composite Score:** [X] / 100

---

## Scoring Rubric

Each domain is scored 0–10. Composite = weighted average (weights shown per section).

| Score | Meaning |
|-------|---------|
| 9–10 | Exceeding target; exemplary |
| 7–8 | Meeting target; healthy |
| 5–6 | Near threshold; watch |
| 3–4 | Below threshold; intervene |
| 0–2 | Critical; immediate action required |

---

## Section 1 — Governance Durability (Weight: 20%)

**Score: [X] / 10**

| Dimension | Pass Rate | Status | Trend |
|-----------|-----------|--------|-------|
| `replay_integrity` | [X]% | ☐ Durable ☐ At Risk | ☐ Improving ☐ Stable ☐ Degrading |
| `approval_enforcement` | [X]% | ☐ Durable ☐ At Risk | ☐ Improving ☐ Stable ☐ Degrading |
| `plugin_isolation` | [X]% | ☐ Durable ☐ At Risk | ☐ Improving ☐ Stable ☐ Degrading |
| `tenant_isolation` | [X]% | ☐ Durable ☐ At Risk | ☐ Improving ☐ Stable ☐ Degrading |
| `explainability` | [X]% | ☐ Durable ☐ At Risk | ☐ Improving ☐ Stable ☐ Degrading |
| `policy_drift` | [X]% | ☐ Durable ☐ At Risk | ☐ Improving ☐ Stable ☐ Degrading |

**Open replay drift alerts this quarter:** [X]  
**Longest alert duration:** [X] days  
**All alerts resolved before new activations?** ☐ Yes ☐ No — [explain]

**Governance incidents this quarter:** [X]  
**Any governance bypass events?** ☐ No ☐ Yes — [document each one]

**Notes:**

---

## Section 2 — Replay Integrity (Weight: 15%)

**Score: [X] / 10**

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Replay gate pass rate | [X]% | ≥ 95% | ☐ Pass ☐ Fail |
| Zero-tolerance replay gates passing | [X] / [X] | 100% | ☐ Pass ☐ Fail |
| Avg replay drift detected | [X]% | ≤ 1% | ☐ Pass ☐ Fail |
| Replay-assisted support rate | [X]% | Maximize | — |
| Replay validation before waves | [X] / [X] waves | 100% | ☐ Pass ☐ Fail |

**SEV events triggered by replay failures:** [X]  
**Replay optimizations shipped this quarter:** [list or "None"]

**Notes:**

---

## Section 3 — Customer Deployment & Reliability (Weight: 15%)

**Score: [X] / 10**

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Wave success rate | [X]% | ≥ 80% | ☐ Pass ☐ Fail |
| Waves aborted | [X] | 0 ideal | — |
| Avg readiness score at launch | [X] | ≥ 80 | ☐ Pass ☐ Fail |
| Deployment rollback frequency | [X] | Minimize | — |
| Rollback recovery time (avg) | [X] min | < 30 min | ☐ Pass ☐ Fail |

**Waves completed this quarter:** [X]  
**Tenants successfully deployed:** [X]  
**Tenants failed deployment:** [X]  
**Root cause documented for all failures?** ☐ Yes ☐ No

**Notes:**

---

## Section 4 — Customer Success & Adoption (Weight: 15%)

**Score: [X] / 10**

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Platform adoption score (avg) | [X] | ≥ 65 | ☐ Pass ☐ Fail |
| At-risk tenant count | [X] | 0 | — |
| Champion tenant count | [X] | Maximize | — |
| Avg churn risk | [X] | < 0.35 | ☐ Pass ☐ Fail |
| Onboarding completion rate | [X]% | Maximize | — |

**Tier distribution:**

| Tier | Count | % |
|------|-------|---|
| `new` (0–24) | | |
| `activating` (25–49) | | |
| `active` (50–69) | | |
| `power` (70–84) | | |
| `champion` (85–100) | | |

**Interventions triggered this quarter:** [X]  
**Interventions resolved:** [X]  

**Notes:**

---

## Section 5 — Ecosystem Trust (Weight: 10%)

**Score: [X] / 10**

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Ecosystem trust signal | [X] | ≥ 0.75 | ☐ Pass ☐ Fail |
| Entities moderated this quarter | [X] | — | — |
| Approve rate | [X]% | — | — |
| Reject/revoke rate | [X]% | — | — |
| Critical queue items (avg) | [X] | 0 | — |
| Any auto-approval events? | ☐ No ☐ Yes | Never | — |

**Entity breakdown:**

| Entity Type | Moderated | Approved | Rejected | Revoked |
|------------|-----------|----------|----------|---------|
| `plugin` | | | | |
| `workflow` | | | | |
| `agent` | | | | |
| `partner` | | | | |
| `playbook` | | | | |

**Notes:**

---

## Section 6 — Support Operations (Weight: 10%)

**Score: [X] / 10**

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| SLA breach rate | [X]% | → 0% | — |
| Avg resolution time | [X] ms | < 14,400,000 | ☐ Pass ☐ Fail |
| Root cause rate | [X]% | Maximize | — |
| Replay-assisted resolution rate | [X]% | Maximize | — |
| Avg satisfaction score | [X] | Maximize | — |

**Incident cluster activity:**

| Cluster | Count | Avg Resolution (ms) | Root Cause Rate |
|---------|-------|---------------------|----------------|
| `replay_failure` | | | |
| `onboarding_blocker` | | | |
| `performance_degradation` | | | |
| `governance_violation` | | | |
| `integration_failure` | | | |

**Notes:**

---

## Section 7 — Production Telemetry Health (Weight: 5%)

**Score: [X] / 10**

**Overall drift score:** [X] / 100 (target ≥ 70)

| Metric | Drift % | Severity | Trend |
|--------|---------|----------|-------|
| `recommendation_acceptance` | | | |
| `workflow_abandonment` | | | |
| `replay_latency` | | | |
| `support_escalation` | | | |
| `onboarding_friction` | | | |
| `plugin_adoption` | | | |
| `deployment_rollback` | | | |
| `operational_bottleneck` | | | |

**Severe drift events this quarter:** [X]  
**Notes:**

---

## Section 8 — Complexity Governance (Weight: 5%)

**Score: [X] / 10**

| Environment | Growth % | Over Limit? | Trend |
|------------|---------|-------------|-------|
| production | [X]% | ☐ Yes ☐ No | |
| staging | [X]% | ☐ Yes ☐ No | |

**Proposals reviewed this quarter:** [X]  
**Proposals approved:** [X]  
**Proposals rejected/blocked:** [X]  
**Proposals requiring council review:** [X]  
**Any complexity budget violations?** ☐ No ☐ Yes — [explain]

**Notes:**

---

## Section 9 — Industry Expansion (Weight: 3%)

**Score: [X] / 10**

| Vertical | Playbook Version | Certification Status | Readiness Score | Tenants Deployed |
|---------|-----------------|----------------------|----------------|-----------------|
| water_wastewater | | | | |
| manufacturing | | | | |
| facilities | | | | |
| utilities | | | | |
| energy | | | | |
| industrial_operations | | | | |
| infrastructure | | | | |

**New verticals certified this quarter:** [X]  
**Templates added:** [X]  
**Any non-deployable templates shipped to production?** ☐ No ☐ Yes — [remediate]

**Notes:**

---

## Section 10 — Long-Term Evolution (Weight: 2%)

**Score: [X] / 10**

**Evolution proposals this quarter:**

| Title | Governance Risk | Complexity Impact | Replay Surface | Status |
|-------|----------------|------------------|----------------|--------|
| | | | | |

**Council reviews conducted:** [X]  
**Any blocked proposals outstanding?** ☐ No ☐ Yes — [list]  
**Architecture health concerns:** [list or "None"]  

**Notes:**

---

## Composite Score Calculation

| Section | Weight | Score | Weighted |
|---------|--------|-------|---------|
| Governance Durability | 20% | | |
| Replay Integrity | 15% | | |
| Customer Deployment | 15% | | |
| Customer Success | 15% | | |
| Ecosystem Trust | 10% | | |
| Support Operations | 10% | | |
| Telemetry Health | 5% | | |
| Complexity Governance | 5% | | |
| Industry Expansion | 3% | | |
| Long-Term Evolution | 2% | | |
| **Total** | **100%** | — | **[X]** |

---

## Top 3 Wins This Quarter

1. [Win]
2. [Win]
3. [Win]

---

## Top 3 Risks Entering Next Quarter

1. [Risk] — Proposed response: [action]
2. [Risk] — Proposed response: [action]
3. [Risk] — Proposed response: [action]

---

## Focus Areas for Next Quarter

1. [Domain] — [Specific goal and success metric]
2. [Domain] — [Specific goal and success metric]
3. [Domain] — [Specific goal and success metric]

---

## Sign-Off

| Role | Name | Date |
|------|------|------|
| Engineering Lead | | |
| Governance Owner | | |
| Customer Success Lead | | |
| Reliability Engineering | | |
