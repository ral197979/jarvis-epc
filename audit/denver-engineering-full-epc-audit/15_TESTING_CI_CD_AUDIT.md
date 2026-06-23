# 15 — Testing & CI/CD Audit

## Test Framework
- **Unit/Integration:** Vitest 4.0.18 with `@testing-library/react`
- **E2E:** Playwright 1.58.2
- **Coverage:** `@vitest/coverage-v8`

---

## Test Results (Verified Run)

```
Test Files:  15 failed | 75 passed (90 total)
Tests:       28 failed | 4,422 passed (4,450 total)
Duration:    17.68s
```

### Failing Test Files

| File | Failure Count | Category |
|---|---|---|
| `actions.test.ts` | Multiple | Backend action routes |
| `actions-phase2.test.ts` | Multiple | Phase 2 backend |
| `actions-phase10.test.ts` | 1 | `classifyFailure: flaky → environment_flaky` |
| `actions-phase10b.test.ts` | 1 | `generateRecommendation: nondeterministic_code → audit handlers` |
| `actions-phase11.test.ts` | 4 | `productionTelemetryEngine` mocks |
| `actions-phase9.test.ts` | 1 | `ingestInboundEvent` - ON CONFLICT mock call index |
| `actions-phase9b.test.ts` | 1 | `anonymization removes all identifying fields` — **P0 SECURITY** |
| `actions-phase9c.test.ts` | 1 | `_anonymize strips tenant_id` — **P0 SECURITY** |
| `config/config.test.ts` | 1 | `NAVIGATION_ITEMS has a stable non-empty list` |
| Phase 11b | 1 | `getPilotAdoptionMetrics` |
| Phase 11 | 2 | `getTelemetryEvents`, `getLatestTelemetryEvent` |
| Phase 12 related | Multiple | Various |

### Root Cause Analysis

**Anonymization failures (P0):** `_anonymize()` adds random noise instead of stripping identifying data. This is a logic bug, not a test setup issue.

**Navigation test failure (P1):** `config.test.ts` fails on `NAVIGATION_ITEMS has a stable non-empty list`. This is a currently modified file (`navigation.ts` shows `M` in git status). The navigation was modified but the test wasn't updated.

**Telemetry mocks (P2):** `productionTelemetryEngine` tests fail due to mock setup mismatch — likely `tenantQuery` mock not returning expected structure.

**Phase 9 ON CONFLICT (P2):** `ingestInboundEvent` test accesses mock call at index `[1][1]` but mock call at index 1 is undefined — test assumes 2 DB calls but implementation makes only 1.

---

## TypeScript Check

```
npm run typecheck → 0 errors ✅
```

TypeScript compilation passes completely. Previous audit fixed 207 TypeScript errors.

---

## ESLint

```
npm run lint → 596 warnings, 0 errors
Script: "lint": "eslint src api --max-warnings 0"
```

**Result: FAIL** — `--max-warnings 0` causes lint to exit non-zero even with 0 errors. The `npm run ci` script runs lint, so **CI would fail.**

### Warning Categories
| Category | Count | Examples |
|---|---|---|
| `@typescript-eslint/no-unused-vars` | ~200 | Unused vars/imports |
| `react-hooks/exhaustive-deps` | ~150 | Missing useEffect deps |
| `@typescript-eslint/no-explicit-any` | ~100 | `any` type usage |
| Other | ~146 | Misc |

### Key Impactful Warnings
- `SubcontractView.tsx:110` — `tenantId` unused in callback (potential data isolation bug)
- `dispatch.ts:258` — `useMemo` missing `deps` dep (stale memoized value)
- `ScheduleImportView.tsx` — multiple `any` types

---

## CI Pipeline (`npm run ci`)

```json
"ci": "npm audit --audit-level=high && npm run typecheck:all && npm run check:monolith && npm test -- --run"
```

**Steps:**
1. `npm audit --audit-level=high` — dependency vulnerability audit
2. `npm run typecheck:all` — TypeScript check (passes ✅)
3. `npm run check:monolith` — monolith size check
4. `npm test -- --run` — unit tests (28 failures ❌)

**Note:** `npm run lint` is NOT in the `ci` script — lint errors are not blocking CI. This is inconsistent with `--max-warnings 0` being set on the lint script. **P2**

---

## Backend Tests

**Location:** `api/__tests__/` — 23 test files

| Test File | Status |
|---|---|
| `agentMode.test.ts` | ✅ |
| `askBuilder.test.ts` | ✅ |
| `automationAndComplianceRoutes.test.ts` | ✅ |
| `ciArbiter.test.ts` | ✅ |
| `complianceWatcher.test.ts` | ✅ |
| `cpm.test.ts` | ✅ |
| `embed.test.ts` | ✅ |
| `epcCore.test.ts` | ✅ |
| `fieldSync.test.ts` | ✅ |
| `fixExtractor.test.ts` | ✅ |
| `fixLibrary.test.ts` | ✅ |
| `knowledgeBulkIngest.test.ts` | ✅ |
| `knowledgeIngest.test.ts` | ✅ |
| `knowledgeSearch.test.ts` | ✅ |
| `knowledgeTier.test.ts` | ✅ |
| `kpiAndRetentionHandlers.test.ts` | ✅ |
| `mcp.test.ts` | ✅ |
| `risks.test.ts` | ✅ |
| `scheduler.test.ts` | ✅ |
| `systemTagAlias.test.ts` | ✅ |
| `tier1.test.ts` | ✅ |
| `validateUuidParams.test.ts` | ✅ |

All backend tests PASS ✅ — failures are in frontend/module tests.

---

## E2E Tests

**Framework:** Playwright 1.58.2  
**Config:** `playwright.config.ts` ✅  
**Location:** `e2e/` directory ✅

**Status:** E2E tests exist but were NOT run during this audit (requires running server + DB). No pass/fail data available. **P2** — E2E tests should be part of CI gate.

---

## Coverage

`npm run test:coverage` — coverage available via `@vitest/coverage-v8`.  
Coverage not run during this audit (time/resources).

**Estimated critical gaps:**
- No tests for file upload routes (`api/routes/files.ts`)
- No tests for change orders routes (`api/routes/changeOrders.ts`)
- No tests for EVM routes (`api/routes/evm.ts`)
- No tests for cost control routes
- No integration tests (DB not available in test environment)

---

## Risk Summary

| Finding | Severity |
|---|---|
| 28 unit test failures including P0 anonymization bug | P0 |
| Navigation test fails (modified navigation.ts not updated) | P1 |
| Lint failures not blocking CI (`npm run ci` doesn't call lint) | P2 |
| No E2E test results available | P2 |
| No integration tests (API routes against real DB) | P2 |
| No tests for file upload, EVM, cost control routes | P2 |
| CI script inconsistency (lint not in ci command) | P2 |
