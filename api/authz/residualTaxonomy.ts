/**
 * Denver Engineering — ADR-014 Phase 2C-5 residual authorization taxonomy
 * ─────────────────────────────────────────────────────────────────────────────
 * The twelve endpoints Phase 2C-4B left pending that are NOT owned by Phase 3,
 * each with the trust boundary that actually protects it.
 *
 * Phase 2C-4B exited with 14 `PENDING_PHASE2` endpoints. Two of them —
 * `projects GET /:id` and `related GET /related/:source/:id` — stay pending on
 * purpose: their unresolved question is *which records inside an authorized
 * domain a caller may read*, which is Phase 3 record-scope work, not a missing
 * API perimeter. The other twelve are dispositioned here.
 *
 * The organising rule (Phase 2C-5 §5) is that a route is classified by its
 * TRUST BOUNDARY, not by its name. `scim` does not imply HMAC, `iot` does not
 * imply a machine caller, and `mcp` does not imply a user capability. Each row
 * below records who actually calls the endpoint, what credential the server
 * actually verifies, and what authority the operation actually exercises.
 *
 * Nothing here is a guard. This is the ledger the Phase 2C-5 ratchet checks the
 * source against, so a row that stops matching reality fails the build.
 */

/** How the caller is authenticated — the question §5 makes primary. */
export type TrustBoundary =
  /** A live user session, authorized by a capability held by the LIVE db role. */
  | 'USER_SESSION_CAPABILITY'
  /** A verified, tenant-bound bearer credential issued by this system. */
  | 'SERVICE_BEARER_TOKEN'
  /** Either of the two above, chosen deterministically from the credential. */
  | 'HYBRID_SERVICE_OR_SESSION'
  /** No caller: the router is never mounted, so no request path exists. */
  | 'NO_REQUEST_PATH'

export type ResidualDisposition =
  | 'SERVICE_TOKEN'
  | 'HYBRID_SERVICE_CAPABILITY'
  | 'UNMOUNTED'

export interface ResidualEndpoint {
  file:   string
  router: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path:   string
  /** Who calls it in practice. */
  caller: string
  boundary: TrustBoundary
  /** What the census classified it as at Phase 2C-5 exit. */
  disposition: ResidualDisposition
  /** What authority the operation exercises, in the handler's own terms. */
  authority: string
  /**
   * Whether the operation changes who can access the product. Identity
   * lifecycle is consequential in the ordinary sense of the word even though it
   * is not a business-approval transition — see CONSEQUENTIAL_NOTE.
   */
  consequential: boolean
}

/** The SCIM 2.0 provisioning surface — Phase 2C-5 §7/§8 Path A. */
const SCIM: readonly ResidualEndpoint[] = [
  {
    file: 'scim.ts', router: 'scimRouter', method: 'GET', path: '/ServiceProviderConfig',
    caller: 'Identity provider (Okta / Azure AD / OneLogin / JumpCloud) discovering protocol capabilities',
    boundary: 'SERVICE_BEARER_TOKEN', disposition: 'SERVICE_TOKEN',
    authority: 'Reads static protocol capability metadata. No tenant data.',
    consequential: false,
  },
  {
    file: 'scim.ts', router: 'scimRouter', method: 'GET', path: '/Schemas',
    caller: 'Identity provider discovering the User attribute schema',
    boundary: 'SERVICE_BEARER_TOKEN', disposition: 'SERVICE_TOKEN',
    authority: 'Reads the static User schema. No tenant data.',
    consequential: false,
  },
  {
    file: 'scim.ts', router: 'scimRouter', method: 'GET', path: '/Users',
    caller: 'Identity provider reconciling its user set against the tenant',
    boundary: 'SERVICE_BEARER_TOKEN', disposition: 'SERVICE_TOKEN',
    authority: 'Lists identities for the credential tenant only. Filters are parameterised and ANDed with the tenant predicate.',
    consequential: false,
  },
  {
    file: 'scim.ts', router: 'scimRouter', method: 'GET', path: '/Users/:id',
    caller: 'Identity provider reading one identity',
    boundary: 'SERVICE_BEARER_TOKEN', disposition: 'SERVICE_TOKEN',
    authority: 'Reads one identity in the credential tenant. Foreign target answers 404 noTarget.',
    consequential: false,
  },
  {
    file: 'scim.ts', router: 'scimRouter', method: 'POST', path: '/Users',
    caller: 'Identity provider provisioning a new user (JIT)',
    boundary: 'SERVICE_BEARER_TOKEN', disposition: 'SERVICE_TOKEN',
    authority: 'CREATES ACCESS — INSERT INTO users. Bounded by the tenant max_users limit and the ADR-014 D7 role gate.',
    consequential: true,
  },
  {
    file: 'scim.ts', router: 'scimRouter', method: 'PUT', path: '/Users/:id',
    caller: 'Identity provider replacing a user record',
    boundary: 'SERVICE_BEARER_TOKEN', disposition: 'SERVICE_TOKEN',
    authority: 'CHANGES PRIVILEGE and ACTIVE STATE — UPDATE users SET display_name, is_active, role.',
    consequential: true,
  },
  {
    file: 'scim.ts', router: 'scimRouter', method: 'PATCH', path: '/Users/:id',
    caller: 'Identity provider applying a PatchOp, including deactivation',
    boundary: 'SERVICE_BEARER_TOKEN', disposition: 'SERVICE_TOKEN',
    authority: 'CHANGES PRIVILEGE and ACTIVE STATE — the IdP deprovisioning path.',
    consequential: true,
  },
  {
    file: 'scim.ts', router: 'scimRouter', method: 'DELETE', path: '/Users/:id',
    caller: 'Identity provider deprovisioning a user',
    boundary: 'SERVICE_BEARER_TOKEN', disposition: 'SERVICE_TOKEN',
    authority: 'REMOVES ACCESS — UPDATE users SET is_active=false. Deactivates rather than hard-deletes.',
    consequential: true,
  },
]

/** IoT sensor ingest — Phase 2C-5 §11/§12, two independent trust paths. */
const IOT: readonly ResidualEndpoint[] = [
  {
    file: 'iot.ts', router: 'iotRouter', method: 'POST', path: '/iot/ingest',
    caller: 'Telegraf/EMQX gateway with a 64-hex ingest token, OR a Denver session holding platform.integrations',
    boundary: 'HYBRID_SERVICE_OR_SESSION', disposition: 'HYBRID_SERVICE_CAPABILITY',
    authority: 'Writes sensor readings and derived alerts for the tenant bound to the credential.',
    consequential: false,
  },
  {
    file: 'iot.ts', router: 'iotRouter', method: 'POST', path: '/sensors/:uid/readings',
    caller: 'Same two callers as POST /iot/ingest, for a single sensor uid',
    boundary: 'HYBRID_SERVICE_OR_SESSION', disposition: 'HYBRID_SERVICE_CAPABILITY',
    authority: 'Writes one reading for one sensor in the credential tenant.',
    consequential: false,
  },
]

/** denverMcp — Phase 2C-5 §14, declared but unreachable. */
const DENVER_MCP: readonly ResidualEndpoint[] = [
  {
    file: 'denverMcp.ts', router: 'router', method: 'GET', path: '/tools',
    caller: 'Nobody — server.ts never mounts denverMcpRouter',
    boundary: 'NO_REQUEST_PATH', disposition: 'UNMOUNTED',
    authority: 'Would list MCP tool metadata. Unreachable, and flag-gated off besides.',
    consequential: false,
  },
  {
    file: 'denverMcp.ts', router: 'router', method: 'POST', path: '/call',
    caller: 'Nobody — server.ts never mounts denverMcpRouter',
    boundary: 'NO_REQUEST_PATH', disposition: 'UNMOUNTED',
    authority: 'Would dispatch an MCP tool. Unreachable; mounting it needs a service-auth model that does not exist.',
    consequential: false,
  },
]

export const RESIDUAL_ENDPOINTS: readonly ResidualEndpoint[] = [...SCIM, ...IOT, ...DENVER_MCP]

/**
 * Why SCIM identity lifecycle is NOT registered in `transitions.ts` — §9.
 *
 * The consequential-transition model in `transitions.ts` describes BUSINESS
 * APPROVAL transitions: a named state change on a business record, guarded by
 * the capability the registry declares, reached by a user principal holding
 * that capability. Every one of its entries is capability-keyed.
 *
 * SCIM identity lifecycle is consequential in the plain sense — POST, PUT,
 * PATCH and DELETE on /Users each create, change or remove access — but it is
 * not a business approval and it has no user capability to key on: the caller is
 * a provisioning service, not a person. Registering it there would require
 * inventing a capability no caller holds, which is precisely the "fake human
 * capability around a machine protocol" §5 forbids, and the transition ratchet
 * would then assert a guard that does not and should not exist.
 *
 * It is therefore recorded here instead, with `consequential: true`, and the
 * Phase 2C-5 ratchet asserts that every consequential SCIM row is behind the
 * SCIM token boundary and that its role gate refuses `owner`. Authorization to
 * CALL SCIM and business approval of what SCIM does are different things, and
 * this file keeps them separate rather than conflating them to satisfy a counter.
 */
export const CONSEQUENTIAL_NOTE = {
  registeredInTransitions: false,
  reason: 'Identity federation, not a business approval transition. The transition registry is capability-keyed and SCIM has no user principal to hold a capability.',
  compensatingControls: [
    'requireScimToken — hashed, revocable, expirable per-tenant credential, verified before any handler',
    'tenant bound from the verified token row, never from the request',
    'ADR-014 D7 — SCIM may not assign the owner role, nor any role outside USER_ROLES',
    'scim_audit row written for create, update and deactivate, including rejections',
    'token issuance is platform.identity + requireRole(owner, admin); revocation flips is_active',
  ],
} as const
