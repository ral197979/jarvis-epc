# G5 — Monolith Sprints 5–9 Migration Guide

**Gap class:** LAG (internal technical debt)
**Release slot:** v4.31.0
**Parent:** `EXTRACTION_ROADMAP.md` §Remaining Work
**Status:** DRAFT — awaiting owner approval

---

## Starting state (v4.30.0)

- `src/jarvis/JarvisCore.jsx` — **1,173 lines** (was 6,540 at v4.22.0; −82%)
- Target: ≤ 500 lines (thin orchestration shell only)
- Residual inline blocks total ~673 lines across 11 named concerns

---

## Sprint 5 — Extract `JARVIS_ACTIONS` constant + `_domainReducer` stub cleanup

**Estimated effort:** 0.5 day

**Moves:**

| Inline symbol | Estimated lines | Target file |
|---|---|---|
| `JARVIS_ACTIONS` constant map | ~55 | `src/modules/biz/constants.ts` (new) |
| `_domainReducer` stub | ~10 | Delete — duplicated in `src/modules/biz/reducer.ts` |

**Implementation checklist:**

- [ ] Create `src/modules/biz/constants.ts` exporting `JARVIS_ACTIONS` as a typed `const` object
- [ ] Update `src/modules/biz/reducer.ts` to re-export `JARVIS_ACTIONS` for backward compatibility
- [ ] Delete inline `JARVIS_ACTIONS` and `_domainReducer` from `JarvisCore.jsx`
- [ ] Add import of `JARVIS_ACTIONS` from new location in JarvisCore
- [ ] Run `npm run typecheck:all` — must pass
- [ ] Run `npm test` — all existing tests must remain green
- [ ] Run `npm run check:monolith` — must show ~65 line reduction
- [ ] Update `COMPONENT_MAP.md` if new files expose components

**Rollback plan:** Git revert the single PR. No database or config impact.

---

## Sprint 6 — Extract `useJarvis` hook + `JarvisContext` provider

**Estimated effort:** 1 day

**Moves:**

| Inline symbol | Estimated lines | Target file |
|---|---|---|
| `useJarvis()` hook | ~20 | `src/hooks/useJarvis.ts` (new) |
| `JarvisContext` provider | ~10 | `src/contexts/JarvisContext.ts` (new) |

**Implementation checklist:**

- [ ] Create `src/contexts/JarvisContext.ts` exporting the context + provider
- [ ] Create `src/hooks/useJarvis.ts` consuming the context with type-safe default
- [ ] Replace inline hook/context in `JarvisCore.jsx` with imports
- [ ] Ensure all consumers (`src/components/*View.tsx`) still import from the same logical path — add barrel re-export in `JarvisCore.jsx` if needed
- [ ] `typecheck:all` green; all 1,800+ tests green
- [ ] Add 6–8 unit tests for `useJarvis` covering default, undefined provider, typed return

**Rollback plan:** Revert PR. Consumers continue to import from JarvisCore until re-export barrel updated.

---

## Sprint 7 — Extract `Bi` / `Ki` / `Zi` modal triad → `ActionModals.tsx`

**Estimated effort:** 1 day

**Moves:**

| Inline symbol | Estimated lines | Target file |
|---|---|---|
| `Bi()` modal shell | ~35 | `src/components/ActionModals.tsx` (new) |
| `Ki()` action form | ~30 | same file |
| `Zi()` drawer | ~15 | same file |

**Implementation checklist:**

- [ ] Rename on extraction: `Bi` → `ActionModalShell`, `Ki` → `ActionForm`, `Zi` → `ActionDrawer`
- [ ] New file `src/components/ActionModals.tsx` exports all three as named exports
- [ ] Types for all props (no `any`); migrate any loose refs to typed refs
- [ ] Replace inline usage in `JarvisCore.jsx` with `<ActionModalShell />` etc.
- [ ] Accessibility: jest-axe test must show zero WCAG 2.1 AA violations
- [ ] Add 10–12 unit tests across the three components
- [ ] Visual regression: Playwright smoke test on the action-items flow must pass

**Rollback plan:** Revert PR. Inline block is preserved in git history for re-paste.

---

## Sprint 8 — Extract `_dispatch` / `mutateBiz` orchestration → `biz/actions.ts`

**Estimated effort:** 1 day

**Moves:**

| Inline symbol | Estimated lines | Target file |
|---|---|---|
| `_dispatch`, `mutateBiz`, `_setTab`, `fe()`, `ce()`, `E()`, `D()`, `Y()`, `be()` | ~120 | `src/modules/biz/actions.ts` (new) |

**Risk note:** These functions share closure state with `JarvisApp`. Phase 19 pre-condition (Zustand migration) is complete per `EXTRACTION_ROADMAP.md` v4.29.0 update, so this should be safe — but verify before starting that all 8 state vars (`_authOk`, `_oCfg`, `_oPanelOpen`, `_apiStats`, `_auditLog`, `_gwEnabled`, `_cmdOpen`, active tab) are consumed through the Zustand store, not closure refs.

**Implementation checklist:**

- [ ] Pre-check: grep `JarvisCore.jsx` for closure references to the 8 Zustand-migrated vars — expect zero residual refs
- [ ] Create `src/modules/biz/actions.ts` exporting typed action creators + dispatch
- [ ] Migrate each function one at a time, running tests between each
- [ ] Verify no new circular imports (use `eslint` import/no-cycle rule)
- [ ] All tests green; undo/redo still works (biz store has `undo`/`canUndo`)
- [ ] Add 15–20 unit tests for the new actions module (pure function tests)

**Rollback plan:** Revert PR. Actions file is pure — no database or runtime state impact.

---

## Sprint 9 — Extract `_exportAll` / `_importAll` / `_resetAll` → `biz/dataIO.ts`

**Estimated effort:** 0.5 day

**Moves:**

| Inline symbol | Estimated lines | Target file |
|---|---|---|
| `_exportAll` | ~30 | `src/modules/biz/dataIO.ts` (new) |
| `_importAll` | ~30 | same file |
| `_resetAll` | ~20 | same file |

**Implementation checklist:**

- [ ] Create `src/modules/biz/dataIO.ts` with typed `exportAll`, `importAll`, `resetAll`
- [ ] Schema validation on `importAll` (accept only v4-compatible JSON)
- [ ] Replace owner-panel wiring in `JarvisCore.jsx`
- [ ] Add 8–10 unit tests covering roundtrip, malformed-input rejection, reset confirmation
- [ ] E2E test: owner can export → clear → import and see state restored

**Rollback plan:** Revert PR.

---

## Post-sprint verification

After Sprint 9 completes:

- [ ] `npm run check:monolith` reports `JarvisCore.jsx` ≤ 500 lines
- [ ] `npm run typecheck:all` — zero errors
- [ ] `npm test` — all 1,800+ tests green
- [ ] `npm run e2e` — Playwright smoke pass
- [ ] Coverage deltas recorded; line coverage not regressed
- [ ] `COMPONENT_MAP.md` updated with new components
- [ ] `CHANGELOG.md` v4.31.0 entry written with per-sprint detail
- [ ] `EXTRACTION_ROADMAP.md` closed (all sprints complete)

---

## Owner approval

- [ ] **Approved as-is** — I can execute Sprints 5 → 9 sequentially, one PR per sprint, with tests green before the next starts
- [ ] Approved with adjustments: __________
- [ ] Rejected — reason: __________
- [ ] Deferred — re-review at date: ______________

Signed: _________________________  Date: _______________
