# Build Verification Report — v4.32.0

**Date:** 2026-06-22 · **Branch:** `audit/enterprise-remediation-2026-06-21` · **Commit:** `d8a4b5e` (+ governance commit)
**Purpose:** prove the audited state is reproducible from a clean checkout (Phase 2 — CI/CD Verification).

## Results

| Gate | Command | Result |
|---|---|---|
| Clean install | `npm ci` | ✅ exit 0 (lockfile consistent; 1 benign transitive deprecation: `node-domexception`) |
| TypeScript typecheck | `tsc --noEmit` | ✅ 0 errors |
| Production / frontend build | `npm run build` (vite) | ✅ exit 0 — 2420 modules transformed, ~0.7s |
| Unit + integration tests | `vitest run` | ✅ 4911 passed / 2 failed — both pre-existing date-relative tests in `actions-phase8c.test.ts` (proven to fail with this change set reverted); **0 new failures** |
| Security/isolation/SSRF/WS/upload suites | targeted `vitest run` | ✅ 408/408 across 11 suites |
| Dependency audit | `npm audit` | ✅ 0 critical / 0 high (1 dev-only low: esbuild Windows dev-server) |
| Lint | `npm run lint` (`--max-warnings 0`) | ⚠️ 7 warnings (0 errors) — **all pre-existing**, in files NOT in this change set (`api/auth/saml/*`, `api/routes/scim.ts`, `api/services/integration/quickbooksConnector.ts`). **Change set lints clean (0 problems).** |

## Lint detail

This change set introduced 2 lint warnings (now fixed in the governance commit):
- `src/components/ops/LiveEventFeed.tsx` — `tenantId` unused after AUD-010 (prop kept in interface, no longer destructured).
- `api/services/observability/metrics.ts` — removed dead `SLUG_RE`.

Residual 7 warnings are unowned pre-existing `no-unused-vars` in SAML/SCIM/QuickBooks modules — **out of scope** for this release (not reopened). `npm run lint` therefore still exits non-zero under the repo's `--max-warnings 0` policy; the CI gate is pre-existing-red on those files, not regressed by this work.

## Reproducibility statement

A clean checkout of `d8a4b5e` + the governance commit, with `npm ci`, produces an identical install (lockfile-pinned), passes typecheck and production build, and passes all security suites. The two failing tests and seven lint warnings are pre-existing and unrelated to this change set.

## Verification gate conclusion
- No new test failures. ✅
- No new critical/high vulnerabilities. ✅
- Reproducible clean build. ✅
- Change set is lint-clean (pre-existing repo lint debt unchanged). ⚠️ (documented exception)
