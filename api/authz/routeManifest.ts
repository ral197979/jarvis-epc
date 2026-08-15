/**
 * Denver Engineering — API authorization coverage model (ADR-014 Phase 2A)
 * ─────────────────────────────────────────────────────────────────────────────
 * Coverage is computed per ENDPOINT, not per file. The earlier file-level model
 * could not tell the truth about a mixed file — once a route file had three
 * guarded endpoints and seven unguarded ones, calling the whole file
 * "PENDING_PHASE2" understated protection and calling it "CAPABILITY"
 * overstated it. Both are unacceptable for a security gate.
 *
 * Endpoint identity is `METHOD + routerPath` as declared in the route file.
 * Source line numbers are deliberately not used: they are not durable.
 *
 * Classification is derived from source rather than hand-maintained, so it
 * cannot drift. What is hand-maintained is the small set of deliberate
 * exceptions — endpoints that legitimately carry no user capability.
 */

export type RouteClass =
  /** Guarded by `requireCapability` / `requireAnyCapability`. */
  | 'CAPABILITY'
  /** Deliberately reachable without a user session. */
  | 'PUBLIC'
  /** Machine-to-machine; authenticated by HMAC signature, not a user role. */
  | 'SERVICE_HMAC'
  /** Still authentication-only. Phase 2 debt. */
  | 'PENDING_PHASE2'

export interface EndpointException {
  klass:  Exclude<RouteClass, 'CAPABILITY' | 'PENDING_PHASE2'>
  reason: string
}

/**
 * Endpoints that must never carry a user capability, keyed `file METHOD path`.
 * Everything else is classified CAPABILITY or PENDING_PHASE2 by inspecting
 * whether a capability guard actually protects it.
 */
export const ENDPOINT_EXCEPTIONS: Record<string, EndpointException> = {
  'commissioningWebhook.ts router.POST /': {
    klass: 'SERVICE_HMAC',
    reason: 'Raw-body HMAC signature, mounted before express.json() and outside the /api/v1 auth chain.',
  },
  'novaCommands.ts router.POST /commands': {
    klass: 'SERVICE_HMAC',
    reason: 'Raw-body HMAC with dual-secret rotation; tenant resolved from the verified connection record.',
  },
  'novaCommands.ts router.POST /reconcile': {
    klass: 'SERVICE_HMAC',
    reason: 'Same raw-body HMAC contract as the command endpoint; reconciliation from the Nova service.',
  },
  'openapi.ts router.GET /openapi.json': {
    klass: 'PUBLIC',
    reason: 'Spec document, flag-gated by OPENAPI_ENABLED; serves no tenant data.',
  },
  'tenants.ts router.POST /': {
    klass: 'PUBLIC',
    reason: 'Tenant self-registration (ADR-014 Phase 2C-2). tenants.ts declares this route at line 45 '
          + 'and only calls router.use(requireAuth, requireTenant()) at line 110, so no authenticated '
          + 'session exists — or can exist — when it runs: a capability guard here would make signing up '
          + 'impossible. It creates the tenant together with its first owner and carries its own '
          + 'registrationLimiter (5 attempts/hour/IP). Recorded so the census states this deliberately, '
          + 'rather than counting the signup endpoint as unprotected Phase 2 debt.',
  },
}

/**
 * Stable identity for an endpoint.
 *
 * The router variable is part of the identity because one file may mount several
 * routers that legitimately share a path — `procurement.ts` declares both
 * `vendorsRouter.get('/')` and `purchaseOrdersRouter.get('/')`.
 */
export function endpointKey(file: string, router: string, method: string, path: string): string {
  return `${file} ${router}.${method.toUpperCase()} ${path}`
}
