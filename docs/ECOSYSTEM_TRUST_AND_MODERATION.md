# Ecosystem Trust and Moderation (Post-GA)

**Program:** Post-GA Operationalization  
**Domain:** Plugin, Workflow, and Partner Trust Governance  
**Service:** `ecosystemTrustOperations`  
**Component:** `EcosystemHealthGrid`  
**Owner:** Denver Engineering — Ecosystem Integrity  

---

## Purpose

The Ecosystem Trust and Moderation program ensures that every entity operating within the Ava/Denver platform — plugins, workflows, agents, and partners — maintains verifiable trustworthiness. It enforces a moderation-required model where no entity is auto-approved, and every trust action is auditable and immutable.

---

## Ecosystem Entity Types

| Entity Type | Description                                    |
|------------|------------------------------------------------|
| `plugin`   | Third-party capability extensions              |
| `workflow` | Automated process definitions                  |
| `agent`    | AI-powered autonomous agents                   |
| `partner`  | Integration and distribution partners          |
| `playbook` | Industry-specific operational templates        |

---

## Trust Score

Trust scores range from 0 to 100. The platform defines:
- **Trust sufficient**: `trustScore >= 75` (`ECOSYSTEM_TRUST_MIN_SIGNAL × 100`)
- **Auto-reject eligible**: `flagCount >= 5` OR `trustScore < 10`
- **Auto-approve**: Never (non-negotiable rule)

The `canAutoApprove()` function **always returns `false`**. This is an immutable constraint — all moderation actions require a human reviewer.

---

## Moderation Priority Queue

When an entity requires review, it is placed in the moderation queue with a computed priority:

| Priority   | Trigger Conditions                              |
|-----------|--------------------------------------------------|
| `critical` | `flagCount >= 3` OR `trustScore < 30`           |
| `high`     | `flagCount >= 1` OR `trustScore < 50`           |
| `medium`   | `entityType === 'agent'` OR `trustScore < 70`   |
| `low`      | Clean entity with `trustScore >= 70`            |

Priority is re-evaluated each time an entity is flagged or its trust score changes.

---

## Moderation Actions

| Action    | Description                                         |
|----------|-----------------------------------------------------|
| `approve` | Entity is verified and permitted to operate        |
| `reject`  | Entity is denied; removed from active use          |
| `revoke`  | Previously approved entity has approval revoked    |
| `flag`    | Entity is flagged for elevated review              |
| `escalate`| Routed to senior moderation team                   |

All actions set `isImmutable = true` on the trust record, preventing further modification. This preserves the audit trail and prevents action reversal without a new trust record cycle.

---

## Ecosystem Trust Signal

The aggregate ecosystem trust signal measures the health of the entire entity population:

```
trustSignal = trustedCount / totalCount
```

Where `trustedCount` = entities with `trustScore >= 75` AND `moderationAction NOT IN ('reject', 'revoke')`.

The signal returns `1.0` for an empty population. A trust signal below `0.75` is a platform-level governance concern.

---

## Non-Negotiable Rules

1. **No auto-approval.** Every entity activation requires a human reviewer.
2. **Moderation actions are immutable.** Once actioned, a trust record cannot be modified — only superseded by a new record.
3. **Auto-reject is advisory, not automatic.** Even `isAutoRejectEligible` entities require a reviewer to apply the `reject` action.
4. **Reviewers are always recorded.** `reviewerId` is required for all `applyModerationAction` calls.

---

## Operational Runbook

**Reviewing the moderation queue:**
1. `getModerationQueue()` — all items ordered by priority
2. `getModerationQueue('critical')` — critical items first
3. For each item: review entity profile, flag history, trust score
4. Apply action via `applyModerationAction(recordId, action, reason, reviewerId)`

**Handling an auto-reject eligible entity:**
1. Confirm `isAutoRejectEligible(trustScore, flagCount)` is true
2. Assign a reviewer
3. Reviewer applies `reject` action with documented reason
4. Record becomes immutable

**Monitoring ecosystem health:**
1. `computeEcosystemTrustSignal(records)` — track weekly
2. If signal < 0.75: escalate to governance team
3. Review all entities with `trustScore < 50` for remediation opportunities

---

## Database Tables

| Table                          | Description                                      |
|-------------------------------|--------------------------------------------------|
| `pga_ecosystem_trust_records` | Trust records with moderation actions            |
| `pga_moderation_queue`        | Active moderation work queue                     |
