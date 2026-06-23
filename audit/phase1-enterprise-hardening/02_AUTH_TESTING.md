# Phase 2 — Auth & Permission Testing
**Denver Engineering Platform · Security Test Battery**
**Status:** ✅ COMPLETE — 33 tests, all PASSING

---

## Objective

Verify the authentication and multi-tenancy isolation story with automated tests that would catch regressions from future changes. Cover the attack vectors identified in the enterprise audit:

1. Token forgery (wrong secret, expired, alg:none)
2. Role escalation (missing auth, wrong role, multi-role bypass)
3. Tenant isolation (JWT claim integrity, header injection, IDOR, concurrent bleed)

---

## Test File 1: `api/__tests__/authMiddleware.test.ts`

**22 tests · All PASSING ✅**

### Architecture

Uses Vitest with supertest for HTTP-level middleware verification. The key design choices:

- **DB mocked at module level** via `vi.mock('../db/pool', ...)` — no real database required
- **tokenStore mocked** to always return `isRevoked: false` — tests auth logic, not revocation logic
- **observability mocked** — silent during tests
- **Dynamic import** of `../auth` inside `beforeAll` — ensures `JWT_SECRET` env var is set before the module initializes its secret

```typescript
beforeAll(async () => {
  process.env['JWT_SECRET'] = TEST_SECRET
  const mod = await import('../auth')
  requireAuth  = mod.requireAuth
  requireRole  = mod.requireRole
  verifyToken  = mod.verifyToken
})
```

- **`cookie-parser` included** in test Express apps — required for the cookie-first transport path

### Test Coverage

#### `requireAuth` (8 tests)
| Test | Expected | Actual |
|------|----------|--------|
| No token provided | 401 `unauthenticated` | ✅ |
| Malformed Bearer token | 401 `invalid_token` | ✅ |
| JWT signed by wrong secret | 401 `invalid_token` | ✅ |
| Expired token (`expiresIn: '-1s'`) | 401 `invalid_token` | ✅ |
| Valid Bearer token | 200, `ok: true` | ✅ |
| Auth payload attached to `req.auth` | `sub`, `role` present in body | ✅ |
| Token via cookie `jarvis_at` | 200, `ok: true` | ✅ |
| Cookie-first: cookie wins over Bearer | role from cookie token | ✅ |

#### `requireRole` (5 tests)
| Test | Expected | Actual |
|------|----------|--------|
| requireRole used without requireAuth | 401 | ✅ |
| User role doesn't match (viewer vs owner) | 403 `forbidden`, `required` + `current` in body | ✅ |
| User role matches single required role | 200 | ✅ |
| User role in multi-role allowlist | 200 | ✅ |
| All 5 roles enforced against owner-only endpoint | 403 for viewer/engineer/pm/admin, 200 for owner | ✅ |

#### `verifyToken` (7 tests)
| Test | Expected | Actual |
|------|----------|--------|
| Empty string | null | ✅ |
| Random garbage | null | ✅ |
| Signed with wrong secret | null | ✅ |
| Expired token | null | ✅ |
| Valid token → payload | sub, tid, role correct | ✅ |
| All EPC claims present (sub, tid, role, jti) | all defined | ✅ |
| alg:none attack (`{ alg: 'none', typ: 'JWT' }` + no signature) | null | ✅ |

#### JWT `tid` claim extraction (2 tests)
| Test | Expected | Actual |
|------|----------|--------|
| tid correctly identifies tenant in response | exact UUID match | ✅ |
| Different tenants get different tid values | `p1.tid !== p2.tid` | ✅ |

---

## Test File 2: `api/__tests__/tenantIsolation.test.ts`

**11 tests · All PASSING ✅**

### Architecture

Uses a minimal Express app that surfaces tenant resolution results without a real DB. The `requireTenant` middleware calls `query` which is mocked to return a fabricated tenant record keyed to the `$1` parameter (the tenant UUID from the JWT).

### Attack Vectors Covered

#### AV-1: JWT Tenant ID Claim Integrity (3 tests)
Verifies that the `tenantId` attached to `req` comes from the JWT `tid` claim and cannot be forged by sending different claim values.

```
JWT tid = 'tenant-A-uuid' → req.tenantId = 'tenant-A-uuid'  ✅
JWT tid = 'tenant-B-uuid' → req.tenantId = 'tenant-B-uuid'  ✅
Token for tenant-A → cannot receive tenant-B data context     ✅
```

#### AV-2: X-Tenant-ID Header Override (3 tests)
Verifies the P1-B fix — the removed header fallback:

```
JWT tid + X-Tenant-ID header (different) → JWT wins           ✅
No JWT + X-Tenant-ID header only → 401 from requireAuth        ✅
requireAuth + requireTenant + X-Tenant-ID → JWT tenant used    ✅
```

#### AV-3: tenantQuery Parameter Scoping (2 tests)
Verifies that `tenantQuery(tenantId, sql, params)` always receives the tenant UUID as its first positional argument:

```
tenantQuery receives tenantId as first arg to SET call        ✅
SQL includes current_setting binding for RLS context          ✅
```

#### AV-4: IDOR Prevention (1 test)
Verifies that tenant context from JWT prevents row-level access to another tenant's data even if the resource UUID is known:

```
Tenant-A token + tenant-B resource UUID → empty result        ✅
```

#### AV-5: Concurrent Request Isolation (2 tests)
Verifies that simultaneous requests from different tenants do not bleed context:

```
Sequential requests each get correct isolated tenant context   ✅
Concurrent promises each resolve to their own tenant context   ✅
```

---

## Key Learnings

### Cookie Transport Requires `cookie-parser`
The first run of `authMiddleware.test.ts` failed the cookie test because the test Express app was missing `cookie-parser` middleware. Without it, `req.cookies` is `undefined` and the auth middleware falls through to the Bearer header path. Fixed by adding `app.use(cookieParser())` to the `makeApp()` helper.

### `alg:none` Attack Pattern
The alg:none forged token test uses a manually constructed three-segment JWT with no signature:
```typescript
const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
const body   = Buffer.from(JSON.stringify({ ...payload, exp: future })).toString('base64url')
const forged = `${header}.${body}.`   // empty signature segment
```
`jsonwebtoken` rejects this because we pass the secret as the second argument to `jwt.verify()`, which forces HMAC algorithm validation. `verifyToken` correctly returns `null`. ✅

### Vitest `expect(value, message).toBe(expected)` API
Vitest's message argument is passed to `expect()`, not `toBe()`. The TypeScript compiler correctly flagged `expect(x).toBe(y, msg)` as a 2-argument error.

---

## Test Run Output

```
✓ api/__tests__/authMiddleware.test.ts  (22 tests)  71ms
✓ api/__tests__/tenantIsolation.test.ts (11 tests)  24ms

Test Files: 2 passed (2)
      Tests: 33 passed (33)
```

---

## Gaps Not Covered (Future Phases)

| Gap | Priority | File Needed |
|-----|----------|-------------|
| Token revocation (isRevoked = true) | P2 | `tests/security/tokenRevocation.spec.ts` |
| Password reset flow security | P2 | `tests/security/passwordReset.spec.ts` |
| Refresh token rotation | P2 | `tests/security/tokenRotation.spec.ts` |
| Role escalation via PATCH /me/users | P1 | `tests/security/roleEscalation.spec.ts` |
| API authorization matrix (all routes) | P2 | `tests/security/apiAuthorization.spec.ts` |
