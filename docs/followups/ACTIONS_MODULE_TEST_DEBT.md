# HOB / Follow-up Ticket: Actions Module Test Debt Stabilization

**Type:** Follow-up (separate PR) · **Priority:** Medium · **Status:** PROPOSED (not started)
**Origin:** Discovered during enterprise audit closure (2026-06-22). Pre-existing on `origin/main`; explicitly deferred — see `audit/certification/TEST_JOB_EXCEPTION.md`.

## Context
`origin/main`'s CI **Test** job is red with **~30 failures across 16 files**, all in the actions
feature subsystem (`src/modules/actions`, tests `src/__tests__/modules/actions-phase*.test.ts`).
These are unrelated to the security/ops audit (OPS-001/002/003/004) and were not introduced by it.
The audit PRs (#1/#2/#3) make Typecheck + Build green; this ticket covers getting Test green.

**Constraints carried over:** do not bundle into PR #1/#2/#3; this is its own branch/PR off `main`.

## Scope of work (categorized from 2026-06-22 triage)

| # | Workstream | ~Count | Nature | Confidence / effort |
|---|---|---|---|---|
| 1 | **vi.mock hoisting fixes** | ~8 (2 files: `actions.test.ts`, `actions-phase2.test.ts`) | Whole-file load failures — top-level vars referenced in `vi.mock` factory; fix with `vi.hoisted()` (pattern already used in `api/__tests__/enterpriseAuthz.test.ts`) | Trivial / high |
| 2 | **Date-relative numeric drift** | ~7 | `expected 41.59 to be 42`, `92.57 to be 90`, `2024 to be 2025`, `42 to be ≤ 40` — SLA/forecast/score calcs relative to "now". Make assertions date-relative or fixture-pin the clock | Trivial–moderate |
| 3 | **SQL assertion review** | ~7 | `expected [null] to include 'is_active = TRUE'` etc. — captured query arg null/changed vs expected SQL fragment. Determine stale-test vs real query change | Moderate |
| 4 | **Mock shape repair** | ~6 | `Cannot read properties of undefined (reading 'rows'/'length')` — mocks return wrong shape; some may clear once #1 is fixed | Moderate |
| 5 | **Classification / boolean expectation review** | ~5 | `'unknown' to be 'replay_divergence'`, `'moderate' to be 'minor'`, `true to be false` — logic-classification mismatches; decide real-bug vs stale expectation | Moderate (real-bug risk) |

## Acceptance criteria
- `npm test -- --run` green on `main` (0 actions-module failures), or any genuine product bugs found are filed and fixed.
- No changes to security/ops/audit code; PR scoped to `src/modules/actions` + its tests.
- Document any real defects uncovered (workstreams 3–5 may surface them).

## Effort estimate
Trivial bucket (#1) ~30 min. Full set realistically **half-a-day to a day**, with uncertainty in #3–#5 (may uncover real defects → scope grows).

## Suggested sequencing
#1 (vi.mock) → re-measure (some #4 TypeErrors may clear) → #2 (date-relative) → #3/#4/#5 per-test triage, filing product bugs separately as found.

> **Do not start without explicit approval.** This ticket is the proposed plan only.
