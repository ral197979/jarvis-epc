# Operational Cadence Calendar

**Program:** Operational Stewardship  
**Owner:** Denver Engineering  

This document defines the recurring operational rhythm for the Ava/Denver platform. Every item has an owner service, a specific operation to run, and a pass/fail criterion.

---

## Daily (Every Business Day)

### D1 — Replay Drift Alert Check
- **Run:** `getOpenReplayDriftAlerts()`
- **Pass:** Zero open alerts
- **Warn:** 1–2 open alerts (investigate within 4h)
- **Fail:** Any alert > 24h old without resolution
- **Owner:** Governance team

### D2 — Telemetry Severe Drift Check
- **Run:** `getRecentAlerts(since: yesterday)` → filter `driftSeverity === 'severe'`
- **Pass:** Zero severe records
- **Warn:** 1 severe record (investigate same day)
- **Fail:** > 1 severe records or any replay-related severe drift
- **Owner:** SRE on-call

### D3 — Open Support Incidents
- **Run:** `getOpenOperations()`
- **Pass:** All open incidents < 4h old
- **Warn:** Any incident 4–8h old without update
- **Fail:** Any incident > 8h without resolution attempt
- **Owner:** Support team

### D4 — Moderation Queue Depth
- **Run:** `getModerationQueue('critical')`
- **Pass:** Zero critical items
- **Warn:** 1–3 critical items (review before end of day)
- **Fail:** > 3 critical items, or any item pending > 48h
- **Owner:** Ecosystem integrity team

---

## Weekly (Every Monday)

### W1 — Governance Durability Audit
- **Run:** `recordDurabilityCheck()` for all 6 dimensions
- **Check:** `passRate >= 0.98` for each
- **Action if < 0.98:** Identify degrading dimension; engage dimension owner; target restoration within one cycle
- **Action if < 0.95:** Immediate incident; halt evolution proposals
- **Owner:** Governance team

### W2 — Wave Success Rate Review
- **Run:** `getActiveWaves()` → compute `deployedCount / (deployedCount + failedCount)` per wave
- **Pass:** All active waves ≥ 0.80
- **Fail:** Any wave < 0.80 → evaluate abort criteria
- **Owner:** Reliability engineering

### W3 — At-Risk Tenant Review
- **Run:** `getAtRiskTenants()` (churnRisk ≥ 0.35)
- **Action:** For each at-risk tenant, assign intervention from `recommendedInterventions`
- **Response SLA:** Customer success contact within 72h of identification
- **Owner:** Customer success team

### W4 — Ecosystem Trust Signal
- **Run:** `computeEcosystemTrustSignal(records)` across all active entities
- **Pass:** Signal ≥ 0.75
- **Warn:** 0.65 ≤ signal < 0.75
- **Fail:** Signal < 0.65 → freeze new ecosystem approvals, escalate to governance
- **Owner:** Ecosystem integrity team

### W5 — Support Cluster Analysis
- **Run:** `buildIncidentClusters(resolvedRecords)`
- **Check:** Any cluster type showing > 3 incidents this week
- **Action if `replay_failure` spike:** Escalate to replay integrity team immediately
- **Action if `governance_violation` spike:** Escalate to governance owner within 24h
- **Owner:** Support team

### W6 — Operational Telemetry Trend Review
- **Run:** `getRecentAlerts(since: lastWeek)` → identify moderate drift patterns
- **Check:** Any metric with 3+ consecutive moderate records
- **Action:** Investigate root cause; adjust baseline if operational change is deliberate
- **Owner:** SRE team

---

## Monthly (First Week of Each Month)

### M1 — Complexity Budget Review
- **Run:** `recordComplexityTrend(environment, previousScore, currentScore)` per environment
- **Check:** `isOverLimit === false` for all environments
- **Action if over limit:** Freeze new evolution proposals; schedule council review within 2 weeks
- **Owner:** Platform Evolution Council

### M2 — Full Ecosystem Moderation Audit
- **Review:** All entities moderated this month (approve/reject/revoke distribution)
- **Check:** No entities approved without human reviewer ID
- **Check:** All `isImmutable` flags correctly set on actioned records
- **Check:** Trust signal trend direction (improving/stable/degrading)
- **Owner:** Ecosystem integrity team

### M3 — Customer Adoption Report
- **Run:** Full adoption tier distribution across all tenants
- **Produce:** Tier counts (new/activating/active/power/champion)
- **Check:** Platform adoption score ≥ 65
- **Check:** Intervention coverage — every at-risk tenant has an assigned intervention
- **Owner:** Customer success team

### M4 — AI Cost Efficiency Review
- **Review:** AI routing cost per recommendation (compare to prior month)
- **Review:** Replay compute cost per session
- **Check:** Costs growing sub-linearly with tenant count
- **Action if super-linear growth:** Identify optimization candidates (caching, batching, routing)
- **Owner:** SRE + engineering

### M5 — Rollback & Failover Drills
- **Execute:** Rollback rehearsal against staging environment
- **Execute:** Failover drill for primary-to-secondary
- **Pass criteria:** Rollback completes in < 30 minutes; replay validation passes after recovery
- **Owner:** Reliability engineering

### M6 — Industry Playbook Review
- **Run:** `getPlaybooksByIndustry()` per active vertical
- **Check:** All production-facing playbooks have `certificationStatus === 'certified'`
- **Check:** All active templates: `isTemplateDeployable === true`
- **Owner:** Industry solutions team

---

## Quarterly (First Month of Each Quarter)

### Q1 — Full Quarterly Maturity Review
- **Template:** [`QUARTERLY_MATURITY_REVIEW_TEMPLATE.md`](QUARTERLY_MATURITY_REVIEW_TEMPLATE.md)
- **Scope:** All 10 stewardship domains
- **Output:** Composite score, top wins, top risks, next-quarter focus
- **Sign-off required:** Engineering lead, governance owner, customer success lead
- **Owner:** All domain owners

### Q2 — Platform Evolution Council Review
- **Review:** All proposals from prior quarter (approved, rejected, blocked)
- **Review:** Complexity trends across all environments
- **Set:** Evolution roadmap for next quarter
- **Action:** Unblock or formally reject any proposals pending > 90 days
- **Owner:** Platform Evolution Council

### Q3 — Ecosystem Trust Deep Audit
- **Run:** Full trust record history review (approved/rejected/revoked distribution)
- **Run:** Revocation drill — simulate revocation of a test entity and verify replay-safe outcome
- **Run:** External agent audit — all active agents reviewed for risk profile changes
- **Owner:** Ecosystem integrity team

### Q4 — Tenant Isolation Validation
- **Execute:** Full tenant isolation test suite (`TENANT_ISOLATION_VALIDATION.md`)
- **Pass criteria:** Zero cross-tenant data access, all RLS checks enforced
- **Any regression:** Blocks all wave launches until resolved
- **Owner:** Security engineering

### Q5 — Dependency & Coupling Audit
- **Review:** Subsystem coupling changes since last quarter
- **Review:** Replay surface area growth
- **Run:** `check:monolith` (`node scripts/check-monolith-size.js`)
- **Owner:** Engineering lead

---

## Annual

### A1 — Architecture Health Assessment
- Full review of subsystem boundaries, coupling, technical debt
- Replay surface area growth over the year
- Governance complexity growth assessment
- Long-term evolution recommendations for next 4 quarters
- **Owner:** Engineering lead + Platform Evolution Council

### A2 — Security Architecture Review
- Full review against [`SECURITY_ARCHITECTURE_REVIEW.md`](SECURITY_ARCHITECTURE_REVIEW.md)
- SOC2 readiness assessment
- ISO27001 alignment check
- **Owner:** Security engineering + governance

---

## Escalation Reference

| Situation | Escalation | SLA |
|-----------|-----------|-----|
| Replay drift alert > 24h | Governance owner + engineering | Immediate |
| Governance dimension < 95% | SEV-1 incident | Same day |
| Wave success rate < 60% | Abort wave; reliability engineering | Same day |
| Ecosystem trust signal < 0.60 | Freeze approvals; governance | Within 4h |
| Cross-tenant access detected | SEV-1; halt affected tenants | Immediate |
| `canAutoApprove()` returns true | SEV-1 code rollback | Immediate |
| Complexity growth > 15% | Freeze proposals; council review | Within 48h |
