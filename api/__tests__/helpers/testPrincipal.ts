/**
 * Denver Engineering — role-aware API test principals (ADR-014 Phase 2A)
 * ─────────────────────────────────────────────────────────────────────────────
 * Most API tests predate server authorization and mock `../auth` with
 * `{ sub: 'u1' }` and no role, which encodes "authenticated is authorized" —
 * exactly the property Phase 2 removes. This helper lets a test state *who* is
 * calling, and then exercises the real authorization path for that principal.
 *
 * What it deliberately does NOT do
 * ────────────────────────────────
 *   - bypass `resolveCurrentUser` — the role still comes from the database
 *     lookup, so the staleness closure stays under test;
 *   - bypass `requireCapability` — routes are exercised through their real guards;
 *   - inject an "effective capability" onto the request;
 *   - default an omitted role to owner. `principal()` throws without an explicit
 *     role, so a protected route can never be silently tested as a superuser.
 *
 * Usage
 * ─────
 *   const mockQuery = vi.fn()
 *   vi.mock('../db/pool', () => ({ query: (...a) => mockQuery(...a), ... }))
 *   vi.mock('../auth', () => ({ requireAuth: authMiddlewareFor(() => current) }))
 *
 *   let current: TestPrincipal
 *   beforeEach(() => { mockQuery.mockImplementation(principalQuery(() => current)) })
 *
 *   current = principal({ role: 'viewer' })
 *   await request(app).post('/x/1/approve').expect(403)
 */
import type { RequestHandler } from 'express'
import type { UserRole } from '../../authz/capabilities'

export interface TestPrincipal {
  id:       string
  tenantId: string
  /** The authoritative role — what the database says. */
  role:     UserRole
  /** `false` models a deactivated account. */
  active:   boolean
  /** `false` models a user row that no longer exists. */
  exists:   boolean
  /**
   * The role embedded in the token. Defaults to `role`; set it differently to
   * model a stale JWT (e.g. minted as owner, since demoted to viewer).
   */
  jwtRole:  string
  /** The tenant claimed by the token. Defaults to `tenantId`; differ to model a mismatch. */
  jwtTenantId: string
}

export interface PrincipalOptions {
  role:         UserRole            // required on purpose — no owner fallback
  id?:          string
  tenantId?:    string
  active?:      boolean
  exists?:      boolean
  jwtRole?:     string
  jwtTenantId?: string
}

/**
 * Build a principal. `role` is mandatory: an omitted role must fail loudly
 * rather than quietly elevate, which is the failure mode this helper exists to
 * prevent.
 */
export function principal(options: PrincipalOptions): TestPrincipal {
  if (!options || !options.role) {
    throw new Error(
      '[testPrincipal] `role` is required. A test must state who is calling; ' +
      'there is deliberately no default role.',
    )
  }
  const id       = options.id       ?? 'user-under-test'
  const tenantId = options.tenantId ?? 'tenant-under-test'
  return {
    id,
    tenantId,
    role:        options.role,
    active:      options.active ?? true,
    exists:      options.exists ?? true,
    jwtRole:     options.jwtRole     ?? options.role,
    jwtTenantId: options.jwtTenantId ?? tenantId,
  }
}

/** The row `resolveCurrentUser` expects, or `undefined` when the user is gone. */
function userRow(p: TestPrincipal) {
  if (!p.exists) return undefined
  return { id: p.id, tenant_id: p.tenantId, role: p.role, is_active: p.active }
}

/** True when a query is the current-user authorization lookup. */
function isCurrentUserLookup(args: unknown[]): boolean {
  return args.some(a => typeof a === 'string' && /FROM\s+users\s+WHERE\s+id/i.test(a))
}

/**
 * A `query` implementation that answers the current-user lookup for the active
 * principal and delegates everything else.
 *
 * The principal is read through a getter so a test can reassign it between
 * cases without rebuilding its mocks.
 */
export function principalQuery(
  current: () => TestPrincipal,
  delegate?: (...args: unknown[]) => unknown,
) {
  return async (...args: unknown[]): Promise<unknown> => {
    if (isCurrentUserLookup(args)) {
      const row = userRow(current())
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
    }
    if (delegate) return delegate(...args)
    return { rows: [], rowCount: 0 }
  }
}

/**
 * Stands in for `requireAuth`: attaches the verified token claims. The role it
 * attaches is the *token's* role, which authorization deliberately ignores in
 * favour of the database lookup — so a stale claim stays visible to tests.
 */
export function authMiddlewareFor(current: () => TestPrincipal): RequestHandler {
  return (req, _res, next) => {
    const p = current()
    ;(req as unknown as Record<string, unknown>)['auth'] = {
      sub: p.id, tid: p.jwtTenantId, role: p.jwtRole, jti: 'test-jti',
    }
    next()
  }
}

/** Stands in for `requireTenant()`, using the principal's claimed tenant. */
export function tenantMiddlewareFor(current: () => TestPrincipal): RequestHandler {
  return (req, _res, next) => {
    ;(req as unknown as Record<string, unknown>)['tenantId'] = current().jwtTenantId
    next()
  }
}

/** Every role, for exhaustive sweeps. */
export const ALL_ROLES: readonly UserRole[] = [
  'owner', 'admin', 'project_manager', 'engineer', 'field_ops', 'procurement', 'viewer',
]
