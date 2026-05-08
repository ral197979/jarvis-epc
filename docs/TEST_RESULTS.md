# TEST RESULTS — Ava Phase 1
**Denver Engineering — Action Engine Test Suite**
**Version:** 4.33.0 | **Date:** 2026-05-06

---

## Test File

**Path:** `src/__tests__/modules/actions.test.ts`
**Framework:** Vitest (matches existing test suite)
**DB dependency:** None — all DB calls mocked via `vi.mock`

---

## Test Coverage Summary

| Suite | Tests | Description |
|-------|-------|-------------|
| `createAction` | 5 | Basic creation, idempotency, SLA due_at, override, delegation routing, error resilience |
| `completeAction` | 2 | Status transition, idempotency on terminal state |
| `cancelAction` | 1 | Status transition to cancelled |
| `resolveEffectiveAssignee` | 4 | Active delegation, no delegation, null userId, undefined userId |
| `_resolveSlaRule` | 3 | No match, rule found, system_type specificity |
| SLA `_fireNextEscalation` | 6 | Level 1 at 0h, level 2 at 24h, gate blocks early fire, max-level cap, level 3 at 48h, custom levels |
| Duplicate action guard | 1 | Two calls → same action id returned |
| `system_type isolation` | 2 | system_type passed to SLA lookup, stored on action row |
| **Total** | **24** | |

---

## Test Cases Detail

### `createAction`

| # | Test | Expected |
|---|------|----------|
| 1 | Basic creation — no delegation, no SLA | Returns row with correct `action_type`; INSERT called |
| 2 | Idempotent — conflict on INSERT | Returns existing row (fetched via SELECT); no duplicate INSERT |
| 3 | SLA `due_at` computation | `due_at` is a future Date; `sla_rule_id` param = rule's UUID |
| 4 | `due_at` override skips SLA lookup | Only 2 DB calls (delegation + INSERT); SLA query not fired |
| 5 | Delegation routing | `assigned_to_user_id` param in INSERT = delegate's UUID |
| 6 | DB error → returns null, doesn't throw | `result` is `null`; calling code unaffected |

### `completeAction`

| # | Test | Expected |
|---|------|----------|
| 1 | Updates status to `completed` | SQL contains `status = 'completed'`; params = `[tenantId, module, sourceId]` |
| 2 | Idempotent on already-completed | Resolves without error; 0 rows updated (guard clause active) |

### `cancelAction`

| # | Test | Expected |
|---|------|----------|
| 1 | Updates status to `cancelled` | SQL contains `status = 'cancelled'` |

### `resolveEffectiveAssignee`

| # | Test | Expected |
|---|------|----------|
| 1 | Active delegation found | Returns `delegate_user_id` |
| 2 | No delegation | Returns original `userId` |
| 3 | `userId = null` | Returns `null`; no DB query made |
| 4 | `userId = undefined` | Returns `null`; no DB query made |

### `_resolveSlaRule`

| # | Test | Expected |
|---|------|----------|
| 1 | No matching rule | Returns `null` |
| 2 | Rule found | Returns row with `id` and `default_duration_hours` |
| 3 | system_type specificity | Returns specific rule (SQL ORDER BY ensures this) |

### SLA Engine `_fireNextEscalation`

| # | Test | Expected |
|---|------|----------|
| 1 | 0.5h overdue, no prior escalations | Fires level 1; INSERT `escalation_level=1` |
| 2 | 25h overdue, level 1 already fired | Fires level 2; `escalation_level=2`, `notify_role='supervisor'` |
| 3 | 5h overdue, level 1 fired (24h gate for L2) | Returns `false`; no INSERT |
| 4 | 100h overdue, all 3 levels fired | Returns `false`; no DB queries |
| 5 | 50h overdue, levels 1+2 fired | Fires level 3; `notify_role='admin'` |
| 6 | Custom 4h ladder, 6h overdue, L1 fired | Fires level 2 using custom threshold |

### Duplicate Action Guard

| # | Test | Expected |
|---|------|----------|
| 1 | Two identical `createAction` calls | Both return same `action.id`; second call hits conflict path |

### system_type Isolation

| # | Test | Expected |
|---|------|----------|
| 1 | `system_type='PWTP'` passed to SLA lookup | SLA query param `$3 = 'PWTP'` |
| 2 | `system_type='WWTP'` stored on action row | INSERT param `$8 = 'WWTP'`; returned row has `system_type='WWTP'` |

---

## Mock Strategy

All database calls are intercepted via:

```typescript
vi.mock('../../../api/db/pool', () => ({
  query:       mockQuery,
  tenantQuery: (tenantId, sql, params) => mockQuery(sql, params),
}))
```

Tests use `mockQuery.mock.calls` inspection to verify:
- Which SQL was called
- What parameters were passed
- Call order (delegation → SLA → INSERT sequence)

`slog` and `registerPromoter` are also mocked to prevent observability/scheduler side effects in tests.

---

## How to Run

```bash
# From project root
npx vitest run src/__tests__/modules/actions.test.ts

# With coverage
npx vitest run --coverage src/__tests__/modules/actions.test.ts

# Watch mode during development
npx vitest src/__tests__/modules/actions.test.ts
```

---

## Known Limitations

1. **No live DB tests** — all tests use mocks. Integration tests against a real Postgres instance (with the migration applied) should be added in Phase 1 Sprint 3.

2. **`_scanOverdueActions` not directly unit tested** — the full scan loop requires multiple mock sequences that would duplicate the `fireNextEscalation` tests. Recommend an integration test that seeds overdue actions and calls `__testHooks.scanOnce()`.

3. **Delegation scope filtering** — the JSONB `@>` scope logic is tested indirectly (SQL is validated by inspection). A dedicated scope-matching test would cover edge cases like `scope.modules` present but `scope.action_types` absent.

4. **Route-level tests** — `GET /api/v1/actions`, `PATCH /api/v1/actions/:id`, and SLA rule endpoints are not covered here. Supertest integration tests should be added in Phase 1 Sprint 3.

---

## Phase 1 Test Coverage Targets

| Layer | Current | Target (Sprint 3) |
|-------|---------|------------------|
| Action service unit | 24 tests | 30+ |
| SLA engine unit | 6 tests | 10+ |
| Route integration (supertest) | 0 | 15+ |
| Migration smoke test | 0 | 1 (schema validation) |
| Live DB integration | 0 | 5 (idempotency, delegation, escalation) |
