# Stewardship Incident Protocol

**Program:** Operational Stewardship  
**Owner:** Denver Engineering — Governance + Reliability  

This document defines how governance-level incidents are classified, responded to, and resolved. These are not standard operational incidents — they are events that threaten the platform's trust guarantees. They are treated with higher urgency and stricter protocols than routine production issues.

---

## SEV Classification

| Level | Name | Response SLA | Examples |
|-------|------|-------------|---------|
| SEV-1 | **Governance Critical** | Immediate (< 15 min) | Replay gate bypassed, cross-tenant leak, `canAutoApprove()` returned `true` |
| SEV-2 | **Governance High** | < 4 hours | Replay drift alert, wave abort, governance dimension < 95% |
| SEV-3 | **Governance Elevated** | < 24 hours | Ecosystem trust signal < 0.65, complexity > 15%, SLA breach spike |
| SEV-4 | **Operational Warning** | < 72 hours | Governance dimension 95–97%, moderate drift, at-risk tenant spike |

---

## SEV-1 Incidents

SEV-1 events require immediate action regardless of time of day. All release pipeline activity halts until the incident is resolved.

### 1A — Cross-Tenant Data Access Detected

**Trigger:** Any query that reads tenant A data from tenant B's context (RLS failure or `pool.query` used where `tenantQuery` is required)

**Immediate response:**
1. Halt all active rollout waves
2. Identify affected tenants
3. Disable affected API endpoints or routes
4. Notify all affected tenants within 1 hour
5. Preserve full query logs for audit

**Resolution criteria:**
- Root cause identified and documented
- Code fix deployed and replay-validated
- Full tenant isolation test suite passes
- Affected tenants notified of remediation

---

### 1B — `canAutoApprove()` Returns True

**Trigger:** Any code path where `ecosystemTrustOperations.canAutoApprove()` evaluates to `true`

**Immediate response:**
1. Rollback the release that introduced the change
2. Block all ecosystem entity activations until fixed
3. Audit: did any entity get auto-approved?
4. If auto-approvals occurred: revoke all auto-approved entities and re-submit for human review

**Resolution criteria:**
- `canAutoApprove()` returns `false` in all code paths
- All auto-approved entities revoked and re-moderated
- Root cause documented with postmortem

---

### 1C — Governance Dimension Pass Rate < 95%

**Trigger:** Any governance dimension falling below 95% (below the durable threshold AND below the emergency threshold)

**Immediate response:**
1. Halt all evolution proposal work
2. Halt all new ecosystem entity approvals
3. Identify the degrading dimension
4. Page governance owner and engineering lead

**Resolution criteria:**
- Degrading dimension restored to ≥ 98%
- Root cause documented
- Corrective controls added to prevent recurrence
- Council sign-off before proposals resume

---

### 1D — Replay Gate Bypassed in Deployment

**Trigger:** A tenant deployment completes with `replayValidated === false` or a replay-category gate in `fail` status

**Immediate response:**
1. Halt the affected wave immediately
2. Mark affected tenants as `failed` status
3. Do not attempt re-deployment until replay is validated

**Resolution criteria:**
- Root cause of bypass identified
- Replay validation confirmed for all affected tenants
- Wave aborted; new wave created after replay fix
- Zero-tolerance replay gate re-verified in test suite

---

## SEV-2 Incidents

SEV-2 events require response within 4 hours. Release pipeline is suspended for related domains.

### 2A — Replay Drift Alert Fires

**Protocol:**
1. `getOpenReplayDriftAlerts()` — retrieve all active alerts
2. Identify stream/tenant pair triggering the alert
3. Compare `currentDeterminismRate` vs `baselineDeterminismRate`
4. Block new tenant activations until alert is resolved
5. Investigate: recent replay pipeline changes, infrastructure drift, config changes
6. After fix: resolve alert record (`resolvedAt` set), re-run replay pipeline, confirm determinism restored

**Resolution criteria:**
- `driftPct <= 0.01` confirmed in post-fix validation
- Alert resolved (not deleted — records are append-only)
- New activations unblocked only after resolution

---

### 2B — Wave Success Rate < 80%

**Protocol:**
1. Evaluate abort criteria: `waveSuccessRate < 0.80` → wave must abort
2. `advanceWave()` should not be called on a wave eligible for abort
3. Review failed tenant deployments for common root cause
4. Perform root cause analysis before creating a new wave
5. Document findings in wave completion notes

**Resolution criteria:**
- Wave aborted via `abortWave()`
- Root cause documented
- Fix deployed and replay-validated
- New wave created with corrected configuration
- New wave passes replay validation before first advance

---

### 2C — Ecosystem Trust Signal < 0.75

**Protocol:**
1. Freeze all new ecosystem entity approvals
2. `getModerationQueue()` — review critical and high-priority items
3. Identify entities dragging down the signal (`trustScore < 75` or `moderationAction IN ('reject','revoke')`)
4. Prioritize moderation of pending trusted entities
5. Review for systematic trust dilution (batch of low-quality plugin submissions)

**Resolution criteria:**
- Signal ≥ 0.75 for 3 consecutive weekly checks
- New approvals resume after signal restoration

---

### 2D — SLA Breach Rate Exceeds 20% (Single Week)

**Protocol:**
1. `getOpenOperations()` — all unresolved incidents
2. Identify pattern: cluster type, escalation tier, tenant cohort
3. If `replay_failure` cluster is dominant → escalate to SEV-2A replay protocol
4. Assign dedicated resolution team if backlog > 10 incidents
5. `resolveSupportOperation()` with `rootCauseIdentified: true` required for all resolved items

---

## SEV-3 Incidents

SEV-3 events require response within 24 hours. Documentation is required but pipeline suspension is domain-specific.

### 3A — Complexity Growth > 15%

**Protocol:**
1. `getComplexityTrends(environment)` — identify environments over limit
2. Freeze new evolution proposals for affected environments
3. Schedule Platform Evolution Council review within 1 week
4. Identify proposals that contributed to growth spike
5. Consider complexity reduction sprint

---

### 3B — Ecosystem Trust Signal 0.60–0.74

**Protocol:**
1. Weekly ecosystem trust signal is in warn zone
2. Accelerate moderation of pending high-quality entities
3. Review recent rejections/revocations for systemic causes
4. No new ecosystem entity categories added until signal recovers

---

## Postmortem Requirements

Every SEV-1 and SEV-2 incident requires a written postmortem filed within 5 business days of resolution.

**Required sections:**
1. Incident summary (what happened, when, impact)
2. Timeline (detection → response → resolution)
3. Root cause analysis
4. Was any non-negotiable constraint violated? (auto-approve, replay bypass, tenant isolation)
5. Contributing factors
6. Corrective actions (with owners and deadlines)
7. Controls added to prevent recurrence
8. Governance review required? (if SEV-1: yes, always)

Postmortems are stored in `docs/remediation/` and referenced in the quarterly maturity review.

---

## Non-Negotiable Constraint Violations

If a postmortem concludes that any of the following occurred, it requires Platform Evolution Council review before any new evolution proposals are approved:

1. `canAutoApprove()` returned `true` for any entity
2. A moderation action was reversed without a new trust record cycle
3. A replay drift alert record was deleted (not resolved)
4. A `GovernanceDurabilityRecord` was modified after insertion
5. Cross-tenant data was accessed via `pool.query` instead of `tenantQuery`
6. A replay-category gate was overridden or bypassed

These are not operational mistakes — they are trust violations. The platform's integrity guarantees depend on these constraints being genuinely unbreakable.
