# P5 — Coverage Gap Plan (79% → 90%)

**Gap class:** PARITY (internal)
**Release slot:** v4.33.0
**Source:** README.md Phase 6 coverage thresholds
**Status:** DRAFT — awaiting owner approval

---

## Starting state (v4.30.0)

From `README.md`:

| Metric | Current | Target | Delta |
|---|---|---|---|
| Statements | 77% | **85%** | +8 pp |
| Branches | 63% | **75%** | +12 pp |
| Functions | 75% | **85%** | +10 pp |
| Lines | 79% | **90%** | +11 pp |

Gate enforced in `vitest.config.ts`. CI blocks merges that regress.

---

## Strategy

1. **Measure first.** Run `npm run test:coverage` at the start of v4.33.0; produce a per-file coverage report (`coverage/coverage-summary.json`).
2. **Prioritize by blast radius.** Domain reducers + API services + auth middleware are higher-impact than view components; fix those first.
3. **Keep mocks shallow.** Per memory feedback, integration-style tests beat heavily-mocked ones for domain logic.
4. **Move coverage thresholds up one percentage point at a time** — never big-bang.

---

## Priority tiers

### Tier 1 — Load-bearing (must reach ≥ 95% before any threshold lift)

| Area | Files | Rationale |
|---|---|---|
| Auth + JWT | `api/auth.ts`, `api/tokenStore.ts` | Security-critical |
| Tenant middleware | `api/middleware/tenant.ts` | RLS enforcement |
| Biz reducer | `src/modules/biz/reducer.ts` | Domain truth table |
| Zustand biz store | `src/modules/biz/store.ts` | Undo/redo, snapshots |
| File storage abstraction | `api/files/storage.ts` | Data integrity |
| Migration runner | `api/db/migrate.ts` | Startup correctness |

### Tier 2 — Backbone (≥ 85%)

| Area | Files |
|---|---|
| API routes | `api/routes/auth.ts`, `api/routes/tenants.ts`, `api/routes/files.ts`, `api/routes/integrations.ts` |
| Event bus | `src/modules/eventBus/` |
| Observability | `src/modules/observability/` |
| Gateway | `src/modules/gateway/` |
| Persistence module | `src/modules/persistence/` |

### Tier 3 — Views (≥ 80% line)

Every `src/components/*View.tsx` that's ✅ Functional in `COMPONENT_MAP.md` needs:

- Render smoke test (component renders without crashing)
- Happy-path interaction test
- Empty-state test
- Error-state test

Stubs marked for deletion (see `P4_COMING_SOON_TRIAGE.md`) are excluded from coverage requirements.

---

## Test patterns established in-repo

Derived from `README.md` + the extraction roadmap's existing test counts:

- **Vitest** for unit + component tests; dynamic ES module mocking for live bindings
- **Supertest** for API integration tests
- **Playwright** for E2E smoke (not counted in coverage)
- **jest-axe** for WCAG 2.1 AA accessibility

### Recommended patterns for new tests

**Reducer / pure-function tests** — property-based + edge cases; zero mocks:

```typescript
describe('bizReducer ADD_LEAD', () => {
  it('rejects duplicate lead IDs', () => { ... })
  it('sanitizes free-text fields', () => { ... })
  it('preserves unrelated state', () => { ... })
})
```

**API route tests** — Supertest against real Express + in-memory / test Postgres (pg-mem or Docker-per-suite):

```typescript
it('POST /api/v1/auth/login with bad password returns 401 + increments fail count', ...)
```

**Hook tests** — `@testing-library/react` + `renderHook`; test cleanup + re-render behaviour.

**Middleware tests** — direct invocation with mocked req/res (thin mocks only for req.headers, req.cookies).

---

## Phased threshold lift

Work in four mini-sprints, each ending with a one-point threshold bump:

| Sprint | Focus | End thresholds (stmt / branch / fn / line) |
|---|---|---|
| 5A | Tier 1 auth + tenant + reducer coverage | 80 / 67 / 78 / 82 |
| 5B | Tier 1 remaining + Tier 2 start | 82 / 70 / 80 / 85 |
| 5C | Tier 2 completion + Tier 3 high-traffic views | 84 / 73 / 83 / 88 |
| 5D | Tier 3 finish + branch backfill | **85 / 75 / 85 / 90** |

No single sprint raises the bar by more than 3 points, to avoid whiplash.

---

## Tools

| Tool | Use |
|---|---|
| `@vitest/coverage-v8` | Primary coverage instrumentation (already in `devDependencies`) |
| `coverage/coverage-summary.json` | Machine-readable per-file coverage |
| Optional: `coverage-badge-cli` | Generate badge for README |
| Optional: `codecov` or `coveralls` | External visualization — owner to decide |

---

## Branch coverage — where it's hiding

Branch coverage is the laggard at 63%. Common sources in this repo:

1. **Defensive early returns** — `if (!user) return null` paths often unreached in tests.
2. **Error-handling catches** — `try { ... } catch (e) { logger.error(e) }` paths.
3. **Optional-chain / nullish coalescing** — `user?.role ?? 'viewer'`.
4. **Switch statements** — missing default-case tests.

Remediation: add explicit tests for each defensive branch; don't delete the defenses.

---

## Acceptance criteria

- [ ] `npm run test:coverage` reports ≥ 85% stmt / 75% branch / 85% fn / 90% line
- [ ] `vitest.config.ts` thresholds updated to the new floors
- [ ] CI coverage job green with new thresholds
- [ ] No Tier 1 file below 95% line coverage
- [ ] No Tier 2 file below 85% line coverage
- [ ] Coverage trend documented in `CHANGELOG.md` v4.33.0 entry
- [ ] `README.md` badge / numbers updated

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Chasing line % with low-value tests | Medium | Prefer behaviour-driven tests over branch-hit tests |
| Flaky tests from Supertest + real DB | Medium | Use pg-mem for unit suite; Docker Postgres only in CI integration job |
| Coverage "goal" overriding engineering judgment | Medium | Review each PR for test quality; reject "coverage-only" tests |
| Regression when deleting stubs (P4) | Low | Coverage computed only on live files; removing stubs reduces noise |

---

## Out of scope

- E2E coverage (Playwright) — not counted in the line/branch targets
- Mutation testing (Stryker) — v2 candidate
- Visual regression (Chromatic) — v2 candidate

---

## Effort estimate

| Sprint | Days |
|---|---|
| 5A | 1.5 |
| 5B | 1.5 |
| 5C | 1.5 |
| 5D | 1.5 |
| **Total** | **6 days** |

---

## Owner approval

- [ ] **Approved** — proceed with four-mini-sprint lift to 85/75/85/90
- [ ] **Approved with different targets:** stmt __%, branch __%, fn __%, line __%
- [ ] **Rejected** — reason: __________
- [ ] **Deferred** — re-review at date: ______________

Signed: _________________________  Date: _______________
