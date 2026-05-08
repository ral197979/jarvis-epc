# Denver Engineering — Remediation Artifact Index

**Program:** 90-day competitor-gap closure, v4.31.0 → v4.33.0
**Parent doc:** `../../REMEDIATION_ROADMAP.md`
**Status:** DRAFT — each artifact awaits owner approval before any code change executes

---

## What's in this folder

These are the **AUTO-column deliverables** from the remediation capability map: design specs, ADRs, schemas, policy drafts, and triage lists. All docs-only — zero runtime impact — producible without per-gap code approval.

They serve two purposes:
1. **Give the owner a concrete thing to approve or reject per gap** before any code is written.
2. **Serve as the implementation spec** for whichever engineer (human or AI) executes the sprint after approval.

---

## Index

| Gap | Artifact | File | Class | Release slot |
|---|---|---|---|---|
| G5 | Monolith Sprints 5–9 migration guide | [G5_MONOLITH_SPRINTS_5_9.md](./G5_MONOLITH_SPRINTS_5_9.md) | LAG (internal) | v4.31.0 |
| G1 | Mobile PWA + Capacitor spec | [G1_MOBILE_SPEC.md](./G1_MOBILE_SPEC.md) | LAG | v4.31.0 → v4.32.0 |
| G2 | BIM via Autodesk APS integration spec | [G2_BIM_APS_SPEC.md](./G2_BIM_APS_SPEC.md) | LAG | v4.32.0 |
| G3 | Plant-engineering file-import spec | [G3_PLANT_IMPORT_SPEC.md](./G3_PLANT_IMPORT_SPEC.md) | LAG (integrate) | v4.32.0 |
| G4 | Partner marketplace v0 spec | [G4_MARKETPLACE_SPEC.md](./G4_MARKETPLACE_SPEC.md) | LAG | v4.33.0 |
| P1 | CPM scheduling ADR | [P1_SCHEDULING_ADR.md](./P1_SCHEDULING_ADR.md) | PARITY → LEAD | v4.32.0 |
| P2 | Field UX audit findings | [P2_FIELD_UX_AUDIT.md](./P2_FIELD_UX_AUDIT.md) | PARITY → LEAD | v4.32.0 |
| P3 | SOC 2 Type II readiness pack | [P3_SOC2_READINESS_PACK.md](./P3_SOC2_READINESS_PACK.md) | PARITY → LEAD | v4.33.0 |
| P4 | Coming-Soon stub triage | [P4_COMING_SOON_TRIAGE.md](./P4_COMING_SOON_TRIAGE.md) | PARITY (internal) | rolling |
| P5 | Coverage gap plan (79% → 90%) | [P5_COVERAGE_PLAN.md](./P5_COVERAGE_PLAN.md) | PARITY (internal) | v4.33.0 |

---

## Owner approval workflow

Per artifact, one of:

- [ ] Approved as-is — proceed to implementation
- [ ] Approved with adjustments (attached in PR / comment)
- [ ] Rejected — reason documented
- [ ] Deferred — re-review at date: ____________

Each artifact carries its own approval block at the bottom. Nothing in `src/` or `api/` changes until the block is signed for that gap.

---

## Governance reminder

Per project rules (priority: OWNER > Project > Skill > Chat):
- These docs are advisory only.
- No destructive action unless explicitly allowed.
- No autonomous execution unless explicitly stated.
- Every gap is executed as a bounded, auditable sprint with an owner checkpoint.
