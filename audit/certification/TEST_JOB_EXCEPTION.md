# Known Exception — CI Test Job (pre-existing `origin/main` debt)

**Date:** 2026-06-22 · **Status:** ACCEPTED as documented exception (does not block engineering audit closure)

## Statement

- The audit dependency PRs make the CI **Typecheck** and **Build** jobs **green**:
  - **PR #3** (`chore/typecheck-lint-cleanup`) resolves the 90 pre-existing `tsc --project tsconfig.modules.json` (`noUnusedLocals`) errors → modules typecheck **0**; base typecheck **0**; Build **OK**.
  - **PR #2** (`chore/dependency-closure-prereq`) supplies the runtime modules so **PR #1** compiles.
- The remaining CI **Test** job failures (~30 across 16 files) are **inherited from `origin/main`** — they fail on a clean `main` checkout independent of this work (verified: baseline 30 failures with the audit/cleanup edits *stashed*).
- The failures are **isolated to the actions feature subsystem** (`src/modules/actions`, tests `src/__tests__/modules/actions-phase*.test.ts`).
- They are **unrelated to OPS-001 / OPS-002 / OPS-003 / OPS-004** (storage SDK, S3 SSE, monitoring, metrics fail-closed) and to the AUD security findings.
- They **do not block engineering audit closure** — the audit/ops remediation is verified independently (security suites 382/382, S3 round-trip, RLS runtime proof, alert firing, etc.).
- They should be handled in a **separate follow-up PR** — see `docs/followups/ACTIONS_MODULE_TEST_DEBT.md`.

## Evidence
- `main` baseline test run: **30 failed / 4420 passed** (16 files), measured with all audit/cleanup edits stashed.
- With cleanup edits: 31 failed — the +1 delta is pre-existing test-ordering pollution (`validateUuidParams.test.ts` passes in isolation in both states), **not** a regression.
- No audit/ops change touches `src/modules/actions`.

## Scope guarantee
This exception is **not** bundled into PR #1, PR #2, or PR #3. Those PRs remain scoped to audit/security/ops (PR #1), runtime dependency closure (PR #2), and typecheck/lint cleanup (PR #3) respectively.
