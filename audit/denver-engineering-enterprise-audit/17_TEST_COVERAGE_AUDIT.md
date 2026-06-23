# 17 — TEST COVERAGE AUDIT

---

## Test Suite Overview

**Test runner:** Vitest  
**Total test files:** 73 (22 API + 49 src + 2 e2e)  
**E2E framework:** Playwright

---

## Test File Inventory

### API Tests (`api/__tests__/`) — 22 files, 3,208 lines

| File | Lines | What's Tested |
|------|-------|--------------|
| `mcp.test.ts` | 323 | MCP protocol endpoints |
| `ciArbiter.test.ts` | 307 | CI arbitration logic |
| `tier1.test.ts` | 301 | Core API tier-1 routes |
| `risks.test.ts` | 258 | Risk register CRUD |
| `fieldSync.test.ts` | 234 | Field sync service |
| `epcCore.test.ts` | 217 | EPC core operations |
| `automationAndComplianceRoutes.test.ts` | 160 | Automation + compliance |
| `fixLibrary.test.ts` | 156 | Fix library service |
| `knowledgeBulkIngest.test.ts` | 122 | Bulk knowledge ingest |
| `agentMode.test.ts` | 119 | AI agent mode |
| `askBuilder.test.ts` | 118 | RAG pipeline (deterministic parts) |
| `kpiAndRetentionHandlers.test.ts` | 108 | KPI + audit retention |
| `cpm.test.ts` | 101 | CPM algorithm |
| `knowledgeTier.test.ts` | 99 | Knowledge tier classification |
| `knowledgeSearch.test.ts` | ~80 | Vector search |
| `knowledgeIngest.test.ts` | ~80 | Document ingest |
| `fixExtractor.test.ts` | ~70 | Fix extraction |
| `complianceWatcher.test.ts` | ~70 | Compliance monitoring |
| `scheduler.test.ts` | ~60 | Background scheduler |
| `embed.test.ts` | ~50 | Embedding service |
| `systemTagAlias.test.ts` | ~40 | System tag handling |
| `validateUuidParams.test.ts` | ~30 | UUID validation middleware |

### Src Tests (`src/__tests__/`) — 49 files, 34,275 lines

**Dominant category: actions-phase tests (32 files)**

```
actions-phase10.test.ts through actions-phase12b.test.ts
```

These appear to be incremental feature development tests for the action center, covering phases of the "Ava" development arc.

**Other src tests:**
- `store.test.ts` (491 lines) — Zustand store state management
- `zustand.test.ts` (351 lines) — Zustand hooks
- `theme.test.ts` (188 lines) — Theme/CSS variables
- `projectTemplates.test.ts` (121 lines) — Project template logic
- `tokenStore.test.ts` — Auth token store
- `useJarvis.test.ts` — Jarvis hook

### E2E Tests (`e2e/`) — 2 files

- `smoke.test.ts` — Basic smoke test (app loads, auth flow)
- `procurement.test.ts` — Procurement workflow E2E

---

## Coverage Assessment by Module

| Module | Unit Test | Integration Test | E2E | Grade |
|--------|-----------|-----------------|-----|-------|
| CPM algorithm | ✅ Complete | — | — | A |
| Ask Jarvis (RAG) | ✅ Deterministic parts | — | — | B+ |
| Knowledge ingest | ✅ | — | — | B+ |
| EVM service | ❌ Not found | — | — | C |
| SLA engine | ❌ Not found | — | — | D |
| IoT ingest | ❌ Not found | — | — | D |
| BIM parse | ❌ Not found | — | — | D |
| Budget routes | ❌ Not found | — | — | D |
| Transmittals | ❌ Not found | — | — | D |
| File upload | ❌ Not found | — | — | D |
| Auth / JWT | ❌ Not found | — | — | D |
| CSRF middleware | ❌ Not found | — | — | D |
| Notification worker | ❌ Not found | — | — | D |
| Action center | ✅ Phase tests | — | — | B |
| Risk register | ✅ | — | — | B |
| Procurement | — | — | ✅ Partial | C+ |

---

## Test Quality Analysis

### What's Good

**CPM tests (cpm.test.ts) — Exemplary:**
```typescript
// Pure computation, zero mocks, deterministic
it('classic diamond: A → B, A → C, B → D, C → D', () => {
  // Covers: critical path, float calculation, topological ordering
  expect(out.results['A']!.is_critical).toBe(false)
  expect(out.critical_path).toContain('B') // B path is longer
})
it('cycle detection throws CpmCycleError', () => {
  expect(() => computeCpm([...], cyclicDeps)).toThrow(CpmCycleError)
})
```

**askBuilder tests — Good test hooks pattern:**
```typescript
// Exports __testHooks for internal function testing without full mock
const { _buildContextBlock, _truncate } = __testHooks
```

### What's Concerning

**1. No EVM formula tests**  
The most financially critical service (ANSI/EIA-748 EVM math) has no automated tests. If CPI/SPI formulas are wrong, there's no automated catch.

**2. actions-phase tests are development regression tests, not specification tests**  
32 files tracking feature development phases. These test that features added in each sprint still work — but don't cover edge cases or failure modes comprehensively.

**3. Skipped tests: 116 (from session summary)**  
Prior audit session noted 116 skipped tests. This represents untested assertions waiting to be addressed.

**4. No auth route tests**  
Login, token refresh, logout, and CSRF validation have no automated tests.

**5. No middleware tests**  
`requireAuth`, `requireTenant`, rate limiting, CSRF validation — all middleware is untested.

**6. E2E coverage: 2 test files**  
Two Playwright E2E tests (smoke + procurement). No E2E coverage for: BIM, IoT, EVM, commissioning, AI features, transmittals.

---

## Missing Critical Tests

Priority order for new test coverage:

1. **EVM formula correctness** — BCWS, BCWP, ACWP, CPI, SPI, EAC calculations
2. **Auth flow** — login, token refresh, lockout, CSRF validation
3. **SLA policy engine** — business hours computation, pause/resume, escalation
4. **IoT ingest pipeline** — threshold evaluation, alert open/close
5. **Tenant isolation** — verify tenantQuery prevents cross-tenant data access
6. **File upload** — MIME validation, size limits, version creation
7. **Transmittal workflow** — state transitions, counter increment

---

## Test Infrastructure Quality

**Mocking approach:** Vitest `vi.mock()` for DB and external service calls  
**No real DB in tests:** All DB tests use mocked pool — test isolation is correct but means integration bugs at the SQL level won't be caught

**Test speed:** Unit tests run < 5 seconds (no network or DB)  
**CI integration:** `npm test -- --run` in build command — tests gate every deploy ✅

---

## Test Coverage Score

| Dimension | Grade | Finding |
|-----------|-------|---------|
| Unit test breadth | C+ | 22 API tests; ~60% of services uncovered |
| Unit test depth | B | Covered tests are thorough (CPM, RAG) |
| E2E coverage | D | 2 tests; smoke + 1 workflow |
| Critical path coverage | D | EVM, auth, SLA have no tests |
| Test quality | B | Where tests exist, they're well-written |
| CI integration | A | All tests gate deployment |

**Test Coverage Score: 56/100**

**Priority actions:**
1. Write EVM formula tests (1 day effort, highest ROI for financial correctness)
2. Write auth middleware tests (1 day, security-critical)
3. Expand E2E to cover core construction workflow (1 week)
