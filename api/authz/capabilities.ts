/**
 * Denver Engineering — server capability registry (ADR-014 Phase 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * The authoritative functional-authorization model. Phase 1's registry
 * (`src/config/capabilities.ts`) decides what the *client* renders; this decides
 * what the *server* permits, and it is the only one that is security.
 *
 * Relationship to Phase 1
 * ───────────────────────
 * View authority is imported, not restated. `SERVER_ROLE_CAPS[role]` contains
 * exactly Phase 1's `ROLE_CAPS[role]` plus the server-only *action* capabilities
 * below. A parity test asserts the view half still matches Phase 1, so the two
 * cannot silently disagree about who may see a domain. Action capabilities have
 * no Phase 1 counterpart by design — the client has no notion of "may approve".
 *
 * Why actions are separate capabilities
 * ─────────────────────────────────────
 * ADR-014 D5: reading a domain never implies changing it, and changing it never
 * implies approving it. `cost.view` must not authorize approving a change order.
 * Consequential transitions (approve/reject/close/publish/issue/execute/verify/
 * release) therefore require their own grant.
 *
 * Where authority was ambiguous, the capability exists but is granted to nobody
 * except `owner`. That is deliberate: a secure denial is preferable to an
 * invented approval policy, and the open decisions are recorded in ADR-014.
 */
import {
  USER_ROLES,
  ROLE_CAPS as CLIENT_ROLE_CAPS,
  type UserRole,
  type Capability as ViewCapability,
} from '../../src/config/capabilities'

export { USER_ROLES, type UserRole }

/**
 * Server-only action capabilities.
 *
 * `<domain>.write`   — create/update/delete ordinary records in the domain.
 * `<domain>.approve` — consequential state transitions (approve, reject, close,
 *                      issue, publish, verify, release, execute).
 * Platform capabilities are split so that "administers integrations" does not
 * imply "may execute arbitrary automation".
 */
export const ACTION_CAPABILITIES = [
  // ── delivery ────────────────────────────────────────────────────────────────
  'project.write',
  'project.approve',        // lifecycle gates, project closure
  'construction.write',
  'construction.approve',   // daily-log approval
  'engineering.write',
  'engineering.approve',    // IFC/AFC issue, drawing release
  'quality.write',
  'quality.verify',         // punch verify/close, NCR closure
  'safety.write',
  'safety.approve',         // compliance task completion (terminal)
  'field.write',
  'commissioning.write',
  'commissioning.approve',  // commissioning acceptance
  'docs.write',
  'docs.publish',           // transmittal close, document issue
  'schedule.write',
  'risk.write',
  'risk.approve',           // risk closure
  'portfolio.approve',      // portfolio anomaly resolution
  'team.write',
  'team.approve',           // timesheet approve/reject, assignment lifecycle

  // ── commercial ──────────────────────────────────────────────────────────────
  'cost.write',
  'cost.approve',           // change orders, estimates, invoices, pay applications
  'crm.write',
  'crm.approve',            // proposal won / lost / no-bid — commits a commercial outcome

  // ── procurement ─────────────────────────────────────────────────────────────
  'procurement.write',
  'procurement.approve',    // bid package issue/close, subcontract invoice approval

  // ── assistant / AI ──────────────────────────────────────────────────────────
  'assistant.admin',        // knowledge ingest, corpus administration
  'ai.govern',              // AI recommendation approve/reject/execute, agent approvals

  // ── platform ────────────────────────────────────────────────────────────────
  'platform.integrations',
  'platform.automation',    // automation admin, runbook execution
  'platform.identity',      // user/SCIM/tenant administration
  'platform.export',        // data-warehouse exports
  // Alters security/connectivity posture: edge-node revocation, air-gap
  // licence activation. Deliberately separate from platform.integrations so
  // "administers integrations" does not imply "changes the security perimeter".
  'platform.security',

  // ── cross-domain read (ADR-014 Phase 2B-3) ─────────────────────────────────
  // TEMPORARY, Owner-only. Not an action: this list is really "server-only
  // capabilities with no Phase 1 counterpart", and this is the one read
  // capability in it, because the client has no notion of "may read a payload
  // whose source domains cannot be bounded".
  //
  // It guards endpoints whose response is assembled from free-form JSONB whose
  // provenance the schema does not record — digital-twin state captures, agent
  // memory and execution output, the realtime event log, optimisation
  // proposals, recommendation before/after snapshots. For those, no conjunction
  // of domain capabilities is truthful, because the domain set is decided at
  // write time, not at authorization time.
  //
  // Owner-only is a deliberate fail-closed placeholder, NOT a policy. It is
  // superseded the moment those payloads carry source-domain provenance and a
  // retrieval filter can enforce it — ADR-014 Phase 3. Every endpoint relying
  // on it is enumerated in `api/authz/aiCrossDomainReads.ts`.
  'crossdomain.read',
] as const

export type ActionCapability = typeof ACTION_CAPABILITIES[number]
export type ServerCapability = ViewCapability | ActionCapability

/**
 * Action grants per role. View grants come from Phase 1 and are merged below.
 *
 * Deliberately conservative. Where Denver's product workflow does not already
 * establish who may approve something, the capability is granted to `owner`
 * only and the decision is recorded as open (ADR-014 §Phase 2 open decisions).
 * Admin is a *platform* administrator and is not a business approver.
 */
const ACTION_GRANTS: Record<UserRole, readonly ActionCapability[]> = {
  owner: ACTION_CAPABILITIES,

  // Platform operations only. No business write or approval authority at all —
  // a platform administrator has no reason to edit a budget or approve a
  // timesheet, and ADR-014 D2 forbids inheriting delivery/commercial authority.
  admin: [
    'platform.integrations',
    'platform.automation',
    'platform.identity',
    'platform.export',
    // ADR-014 Phase 2A §22: AI/platform governance IS the platform
    // administrator's remit — approving, rejecting and executing AI
    // recommendations and agent actions. This is the one business-adjacent
    // authority Admin holds, and it does not extend to any project, delivery or
    // commercial approval.
    'ai.govern',
  ],

  // Project delivery authority. Explicitly NOT cost.approve: change-order and
  // invoice approval is a commercial authority Denver has not established for
  // PMs, so it fails closed pending an owner decision.
  project_manager: [
    'project.write', 'project.approve',
    'construction.write', 'construction.approve',
    'engineering.write',
    'quality.write', 'quality.verify',
    'safety.write',
    'field.write',
    'commissioning.write',
    'docs.write', 'docs.publish',
    'schedule.write',
    'risk.write', 'risk.approve',
    'team.write', 'team.approve',
    'procurement.write',
  ],

  engineer: [
    'project.write',
    'engineering.write',
    'construction.write',
    'quality.write',
    'docs.write',
    'schedule.write',
    'risk.write',
  ],

  procurement: [
    'procurement.write',
    'docs.write',
  ],

  field_ops: [
    'field.write',
    'construction.write',
    'quality.write',
    'safety.write',
  ],

  // ADR-014 D3: read-only. No action capability, ever.
  viewer: [],
}

/** Every capability the server understands. */
export const SERVER_CAPABILITIES: readonly ServerCapability[] = [
  ...new Set<ServerCapability>([
    ...Object.values(CLIENT_ROLE_CAPS).flat(),
    ...ACTION_CAPABILITIES,
  ]),
]

/** Role → the complete capability set the server will honour. */
export const SERVER_ROLE_CAPS: Record<UserRole, readonly ServerCapability[]> =
  Object.fromEntries(
    USER_ROLES.map(role => [
      role,
      [...new Set<ServerCapability>([...CLIENT_ROLE_CAPS[role], ...ACTION_GRANTS[role]])],
    ]),
  ) as unknown as Record<UserRole, readonly ServerCapability[]>

const CAPABILITY_SET = new Set<string>(SERVER_CAPABILITIES)

/** Narrowing guard — anything outside the database enum is not a role. */
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value)
}

/** Narrowing guard — an unregistered capability is never satisfied. */
export function isServerCapability(value: unknown): value is ServerCapability {
  return typeof value === 'string' && CAPABILITY_SET.has(value)
}

/**
 * The authorization decision. **Fails closed** on an unknown role, an
 * unregistered capability, or a capability the role does not hold. There is no
 * owner fallback and no default-allow branch.
 */
export function roleHasCapability(role: unknown, capability: unknown): boolean {
  if (!isUserRole(role)) return false
  if (!isServerCapability(capability)) return false
  return SERVER_ROLE_CAPS[role].includes(capability)
}
