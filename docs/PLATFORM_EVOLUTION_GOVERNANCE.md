# Platform Evolution Governance (Post-GA)

**Program:** Post-GA Operationalization  
**Domain:** Controlled Platform Evolution  
**Service:** `platformEvolutionCouncil`  
**Component:** N/A (backend service only)  
**Owner:** Denver Engineering — Governance  

---

## Purpose

The Platform Evolution Council governs all changes to the Ava/Denver platform after GA. It enforces complexity budgets, requires council approval for high-risk proposals, and monitors complexity growth trends to ensure the platform does not drift into an ungovernable state. Evolution without oversight is treated as a governance failure.

---

## Evolution Proposals

An `EvolutionProposal` is a formal request to change the platform in a way that affects complexity, replay surface, or governance risk:

| Field                  | Description                                              |
|-----------------------|----------------------------------------------------------|
| `title`               | Short descriptive title                                  |
| `description`         | Full description of the proposed change                  |
| `complexityImpact`    | Estimated complexity score delta (0–100+)                |
| `replaySurfaceImpact` | Estimated impact on replay surface area (0–100+)         |
| `governanceRisk`      | `'low' | 'medium' | 'high'`                             |
| `status`              | Lifecycle stage: `draft`, `under_review`, `approved`, `rejected`, `implemented` |
| `approvedBy`          | Reviewer ID (null until approved)                        |
| `proposedAt`          | Proposal submission timestamp                            |
| `reviewedAt`          | Council review timestamp (null until reviewed)           |

---

## Proposal Lifecycle

```
draft ──→ under_review ──→ approved ──→ implemented
                       └──→ rejected
```

- Proposals are submitted in `draft` status
- `approveProposal(proposalId, approvedBy)` transitions from `draft` or `under_review` to `approved`
- Rejected and implemented statuses are terminal — no further transitions

---

## Council Approval Requirement

A proposal **requires council approval** when any of the following conditions are true:

| Condition                         | Trigger                          |
|----------------------------------|----------------------------------|
| Governance risk                   | `governanceRisk === 'medium'` OR `'high'` |
| High complexity impact            | `complexityImpact > 50`          |
| High replay surface impact        | `replaySurfaceImpact > 10`       |

Low-risk, low-complexity proposals (`governanceRisk === 'low'`, `complexityImpact <= 50`, `replaySurfaceImpact <= 10`) may proceed without council review.

---

## Blocked Proposals

A proposal is **blocked** when BOTH conditions hold:

```
isBlocked = (governanceRisk === 'high') AND (approvedBy === null)
```

High-governance-risk proposals cannot advance without an explicit approver. `getBlockedProposals()` surfaces all such proposals for council attention.

---

## Complexity Trend Monitoring

The council monitors platform complexity over time using `ComplexityTrendRecord`:

| Field           | Description                                       |
|----------------|---------------------------------------------------|
| `environment`  | Target environment (e.g., `production`, `staging`)|
| `currentScore` | Complexity score at measurement time              |
| `previousScore`| Prior measurement's complexity score             |
| `growthPct`    | Computed growth rate (signed decimal)            |
| `trend`        | Classified trend direction                        |
| `isOverLimit`  | Whether growth exceeded the 10% limit            |
| `measuredAt`   | Measurement timestamp                             |

### Growth Percentage Formula

```
growthPct = (currentScore - previousScore) / previousScore
```

Special case: if `previousScore === 0`, then `growthPct = 1.0` when `currentScore > 0`, else `0`.

### Trend Classification

```
growthPct < -0.01        → 'decreasing'
-0.01 ≤ growthPct ≤ 0.02 → 'stable'
0.02 < growthPct ≤ 0.10  → 'growing'
growthPct > 0.10          → 'accelerating'
```

The complexity growth limit is **10%** (`COMPLEXITY_GROWTH_LIMIT_PCT = 0.10`). Growth exceeding this threshold sets `isOverLimit = true` and requires council intervention.

---

## Non-Negotiable Rules

1. **High-risk proposals require approval.** A proposal with `governanceRisk === 'high'` is blocked until a named reviewer approves it.
2. **Complexity growth > 10% is a governance event.** `isOverLimit = true` on a trend record requires a council review of active proposals before the next evolution cycle.
3. **Proposals are approved by named reviewers.** Anonymous approval is not permitted — `approvedBy` must contain a real reviewer ID.
4. **Replay surface impact is tracked independently.** A low-complexity change with high replay surface impact still requires council approval.

---

## Operational Runbook

**Submitting a proposal:**
1. `submitProposal(title, description, complexityImpact, replaySurfaceImpact, governanceRisk)`
2. Check `requiresCouncilApproval(proposal)` — if true, route to council queue
3. Check `isProposalBlocked(proposal)` — if true, do not proceed until approved

**Reviewing and approving proposals:**
1. `getBlockedProposals()` — all high-risk unapproved proposals
2. Council reviews each proposal's complexity and replay surface impact
3. `approveProposal(proposalId, approvedBy)` — requires named reviewer

**Monitoring complexity trends:**
1. `recordComplexityTrend(environment, previousScore, currentScore)` — run after each platform change cycle
2. `getComplexityTrends(environment, limit)` — review recent trend history
3. If `isOverLimit === true`: freeze new evolution proposals pending council review
4. If `trend === 'accelerating'`: initiate complexity reduction sprint

---

## Database Tables

| Table                         | Description                                         |
|------------------------------|-----------------------------------------------------|
| `pga_evolution_proposals`    | Proposal records with approval status               |
| `pga_complexity_trends`      | Per-environment complexity measurements over time   |
