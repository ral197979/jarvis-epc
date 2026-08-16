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
  /**
   * Machine-to-machine; authenticated by a verified, tenant-bound bearer
   * credential issued by this system, not by a user role and not by HMAC.
   * ADR-014 Phase 2C-5. Distinct from `SERVICE_HMAC` because the credential is
   * a stored secret presented verbatim rather than a per-request signature: it
   * is revocable and expirable at the row, but it carries no request integrity.
   */
  | 'SERVICE_TOKEN'
  /**
   * One URL, two independently authenticated trust paths — a machine credential
   * OR a user session holding a named capability — selected deterministically
   * from the shape of the presented credential and failing closed on either
   * branch. ADR-014 Phase 2C-5. Recorded as its own class because calling it
   * `CAPABILITY` would hide the machine path and calling it `SERVICE_TOKEN`
   * would hide the human capability; both are load-bearing.
   */
  | 'HYBRID_SERVICE_CAPABILITY'
  /**
   * Declared on a router that `server.ts` never mounts, so no request path to
   * the handler exists. ADR-014 Phase 2C-5. This is a statement about
   * reachability, not about authorization: an `UNMOUNTED` endpoint has no
   * trust boundary to enforce because it has no callers. The Phase 2C-5 ratchet
   * asserts the exact set, so mounting one without classifying it fails.
   */
  | 'UNMOUNTED'
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
  // ── SCIM 2.0 provisioning boundary (ADR-014 Phase 2C-5) ───────────────────
  //
  // Path A of the Phase 2C-5 SCIM branch: a real service-authentication
  // mechanism already exists and correctly authenticates a provisioning client,
  // so no user capability is invented around the protocol.
  //
  // `scimRouter.use(requireScimToken)` runs before every route below. It
  // requires `Authorization: Bearer <token>`, SHA-256-hashes the presented
  // value, and looks it up in `scim_tokens` with `is_active=true` AND
  // (`expires_at IS NULL` OR `expires_at > NOW()`). A missing, malformed,
  // unknown, revoked or expired credential is refused 401 before any handler
  // runs. Tenant is taken from the verified token ROW (`req.scimTenantId`), so
  // nothing the caller sends can select a tenant, and every handler reads and
  // writes through `tenantQuery(tenantId, …)` with an
  // `app.current_tenant_id`-scoped predicate.
  //
  // The credential is issued by `POST /api/v1/scim/tokens`
  // (`platform.identity` + owner/admin) and revoked by
  // `DELETE /api/v1/scim/tokens/:id`, so it is an ordinary revocable service
  // credential rather than an ambient secret.
  //
  // These are NOT `SERVICE_HMAC`: there is no per-request signature. Recording
  // them as HMAC would overstate the integrity property actually enforced.
  'scim.ts scimRouter.GET /ServiceProviderConfig': {
    klass: 'SERVICE_TOKEN',
    reason: 'SCIM 2.0 capability discovery (RFC 7644 §4). Behind requireScimToken like every other SCIM route — an unauthenticated caller cannot read it. Returns protocol capabilities only, no tenant data.',
  },
  'scim.ts scimRouter.GET /Schemas': {
    klass: 'SERVICE_TOKEN',
    reason: 'SCIM 2.0 schema discovery (RFC 7643). Behind requireScimToken. Returns the static User attribute schema only, no tenant data.',
  },
  'scim.ts scimRouter.GET /Users': {
    klass: 'SERVICE_TOKEN',
    reason: 'Lists identities for the tenant bound to the verified token row. Filter/startIndex/count are parsed into parameterised predicates and ANDed with the app.current_tenant_id predicate, so no filter can widen scope beyond the credential tenant.',
  },
  'scim.ts scimRouter.GET /Users/:id': {
    klass: 'SERVICE_TOKEN',
    reason: 'Reads one identity, scoped by the verified token tenant. A target in another tenant answers 404 noTarget, disclosing no cross-tenant existence.',
  },
  'scim.ts scimRouter.POST /Users': {
    klass: 'SERVICE_TOKEN',
    reason: 'Identity provisioning — creates a user and therefore creates access. Tenant comes from the verified token row, the tenant max_users limit is enforced, and ADR-014 D7 refuses the owner role and any role outside USER_ROLES before the row is written.',
  },
  'scim.ts scimRouter.PUT /Users/:id': {
    klass: 'SERVICE_TOKEN',
    reason: 'Full identity replacement — can change display name, active state and role, so it can both grant and remove access. ADR-014 D7 role gate applies; the UPDATE is scoped by the app.current_tenant_id predicate.',
  },
  'scim.ts scimRouter.PATCH /Users/:id': {
    klass: 'SERVICE_TOKEN',
    reason: 'Partial identity update including deactivation and role change — the IdP deprovisioning path. ADR-014 D7 refuses the whole PatchOp on a bad role rather than applying the remainder; the UPDATE is tenant-scoped.',
  },
  'scim.ts scimRouter.DELETE /Users/:id': {
    klass: 'SERVICE_TOKEN',
    reason: 'SCIM deprovisioning — deactivates rather than hard-deletes (is_active=false), removing access for that identity. Tenant-scoped UPDATE; a target outside the credential tenant answers 404 and changes nothing.',
  },

  // ── IoT sensor ingest (ADR-014 Phase 2C-5, closing the D5/D6 hybrid) ──────
  //
  // `hybridIngestAuth('platform.integrations')` decides the trust path ONCE
  // from the shape of the presented credential and never reconsiders it:
  //
  //   service — `Authorization: Bearer <64 hex>` is resolved against the
  //             ingest-token store. An unresolvable token is refused 401 and is
  //             never retried as a session credential. Tenant is bound from the
  //             verified token row; the request body cannot override it.
  //   user    — anything else runs requireAuth → requireTenant() →
  //             requireCapability('platform.integrations') to completion, so a
  //             human caller needs a live session and that capability.
  //
  // Both halves fail closed, so the endpoint is authorized on either path. It is
  // recorded as HYBRID_SERVICE_CAPABILITY rather than folded into either single
  // class because the census must state that two distinct callers exist.
  'iot.ts iotRouter.POST /iot/ingest': {
    klass: 'HYBRID_SERVICE_CAPABILITY',
    reason: 'Batch sensor ingest (Telegraf/EMQX webhook). Machine path: verified 64-hex ingest token, tenant bound from the token row. Human path: live session holding platform.integrations. The mode is chosen from the credential shape and fails closed on both branches.',
  },
  'iot.ts iotRouter.POST /sensors/:uid/readings': {
    klass: 'HYBRID_SERVICE_CAPABILITY',
    reason: 'Single-reading ingest for one sensor uid. Same deterministic two-path contract as POST /iot/ingest: verified ingest token, or a live session holding platform.integrations.',
  },

  // ── denverMcp — declared, never mounted (ADR-014 Phase 2C-5) ──────────────
  //
  // Reachability audit at Phase 2C-5: `server.ts` contains no import of
  // `./routes/denverMcp` and no `app.use` naming `denverMcpRouter`, so the
  // census computes zero effective paths for both endpoints. There are no
  // client callers, no server callers and no MCP clients in the repository;
  // `DENVER_MCP_SERVER` is `false` in `.env.example`, `fly.toml` and
  // `fly.staging.toml`, and the only importer of the backing
  // `services/mcp/denverMcpServer.ts` is this route file and its own unit test,
  // which mounts the router into a synthetic app.
  //
  // Recorded as UNMOUNTED rather than removed: the file header declares this a
  // deliberate follow-up pending an explicit service-to-service auth model, and
  // `aiCrossDomainMutations.ts` already records that removal is a product
  // decision. Phase 2C-5 does not take product decisions. The Phase 2C-5 ratchet
  // asserts the router stays unmounted, so it cannot become reachable while
  // still carrying `requireAuth`-only protection.
  'denverMcp.ts router.GET /tools': {
    klass: 'UNMOUNTED',
    reason: 'denverMcpRouter is never mounted in server.ts — the census computes zero effective paths, so no request can reach the handler. Flag-gated off (DENVER_MCP_SERVER=false) in every environment file as well.',
  },
  'denverMcp.ts router.POST /call': {
    klass: 'UNMOUNTED',
    reason: 'Same never-mounted denverMcpRouter as GET /tools. Mounting it would expose a service-to-service tool-dispatch mutation behind requireAuth only, which is why the Phase 2C-5 ratchet fails the build if the router is ever mounted.',
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
