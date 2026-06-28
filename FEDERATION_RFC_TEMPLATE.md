# Federation RFC Template

Copy this file to `docs/rfc/RFC-NNNN-short-title.md` for any federation-wide change. See
`FEDERATION_CHANGE_POLICY.md` §5 for when an RFC is required and §6 for approval.

---

```
RFC:            NNNN
Title:          <short imperative title>
Author(s):      <name(s) / repo owner(s)>
Status:         Draft | In Review | Approved | Rejected | Withdrawn | Implemented
Created:        <YYYY-MM-DD>
Targets:        Federation Specification <vX.Y → vX.Z>
Contracts:      <Event | Object Service | AI Governance | API | Security | Capability | Thread | Graph>
Change class:   Additive (minor) | Breaking (major) | Clarification (patch)
```

## 1. Summary
One paragraph: what changes and why, in plain language.

## 2. Background
The context a reader needs. Link the relevant `ECOSYSTEM_INTEGRATION_CONTRACT.md` sections and any prior
RFCs/ADRs.

## 3. Current behavior
How the contract works today (the `[observed]` reality). Include the current shape (event envelope,
object record, API, etc.).

## 4. Proposed behavior
The new contract. Show the new shape concretely. Mark every field/event as added / changed / removed.

## 5. Alternatives
Other designs considered and why they were rejected. "Do nothing" is a valid alternative — state its cost.

## 6. Compatibility
- Change class (additive / breaking / clarification) and resulting version bump.
- Forward/backward compatibility analysis. Confirm "consumers ignore unknown fields" still holds.
- `spec_version` impact for events, if any.
- Which repositories are affected, and at which compliance level.

## 7. Migration
- Step-by-step migration for each affected repo.
- Coexistence period (dual-read/dual-write or version negotiation) and its length.
- Deprecation notices and timeline.
- Data backfill / re-keying, if any (must be additive and reversible).

## 8. Rollback
How to revert if the change misbehaves — at the contract level and per repo. State the point of no return,
if any, and how it is avoided during the coexistence period.

## 9. Security
Authn/authz, tenancy, audit, secret, and least-privilege implications. New trust relationships or
service-to-service paths. Threats introduced and mitigations.

## 10. AI implications
Does this touch AI-generated artifacts? Confirm the AI Governance envelope (§11) still applies and that
nothing becomes authoritative without review/approval. Note model/prompt-version or provenance impacts.

## 11. Open questions
Unresolved points blocking approval, with owners.

## 12. Approval
| Role | Name | Decision | Date |
|---|---|---|---|
| Primary approver | | | |
| Co-approver | | | |
| Co-approver | | | |

Approval requirements follow `FEDERATION_CHANGE_POLICY.md` §6 (more approvers for breaking changes).
