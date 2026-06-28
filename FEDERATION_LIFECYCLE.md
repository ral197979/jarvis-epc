# Federation Contract Lifecycle

How a federation contract (or a change to one) moves from idea to retirement. Governed by
`FEDERATION_CHANGE_POLICY.md`; proposals use `FEDERATION_RFC_TEMPLATE.md`.

```
Draft → RFC → Review → Approved → Implemented → Certified → Deprecated → Retired
```

A change may be abandoned at any pre-Approved stage (Withdrawn/Rejected) without consequence.

---

## Stages & responsibilities

### 1. Draft
- **What:** an idea captured as a rough proposal or contract `[proposed]` note.
- **Owner:** the author (any repo owner or the Federation Architect).
- **Exit:** enough substance to open an RFC.

### 2. RFC
- **What:** a complete proposal per `FEDERATION_RFC_TEMPLATE.md` (motivation, impact, compatibility,
  migration, rollback).
- **Owner:** author.
- **Exit:** RFC submitted, change class and target version declared.

### 3. Review
- **What:** approvers per the matrix (`FEDERATION_CHANGE_POLICY.md` §6) assess correctness, compatibility,
  security, and AI implications. Affected repo owners weigh in.
- **Owner:** Federation Architect coordinates; domain approvers decide.
- **Exit:** consensus to accept, reject, or revise.

### 4. Approved
- **What:** sign-off recorded in the RFC approval table; version assigned; changelog entry queued.
- **Owner:** primary approver.
- **Exit:** the contract document is updated (the normative text) and tagged at the new version.

### 5. Implemented
- **What:** repositories implement the contract behind flags; additive and reversible; no behavior change
  until enabled. Coexistence period begins for breaking changes.
- **Owner:** each affected repo owner.
- **Exit:** at least the reference implementation (and all required publishers/subscribers) ship it.

### 6. Certified
- **What:** implementations are verified against `FEDERATION_COMPLIANCE_CHECKLIST.md`; the contract is the
  active standard at its version. Members declare/renew their compliance level.
- **Owner:** Federation Architect + Security Lead.
- **Exit:** marked active/current in `ECOSYSTEM_INTEGRATION_CONTRACT.md`.

### 7. Deprecated
- **What:** superseded by a newer version; still supported through its compatibility window. Deprecation
  is announced with a migration path; no new adoption.
- **Owner:** Federation Architect.
- **Exit:** compatibility window elapses and all members have migrated.

### 8. Retired
- **What:** removed from the active specification (only at a major version). Kept in history/changelog for
  the record. Nothing in the federation may depend on it.
- **Owner:** Federation Architect.
- **Exit:** terminal.

---

## Invariants across all stages
- A contract never changes meaning without moving through Review → Approved at a new version.
- Nothing reaches **Retired** without passing through **Deprecated** for a full compatibility window.
- Every stage transition for an Approved+ change is recorded (RFC status + changelog).
