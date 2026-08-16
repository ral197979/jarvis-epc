/**
 * Denver Engineering — Personal Inbox authorization (ADR-014 Phase 2C-4A)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2B-2 classified 19 reads as `PERSONAL_INBOX` and deferred them, and the
 * Phase 2 mutation backlog carried 17 matching mutations. This closes 29 of
 * those 36 endpoints and records — rather than hides — why the other 7 cannot be
 * closed yet.
 *
 * Three authorities, and the distinction between them is the point
 * ───────────────────────────────────────────────────────────────
 *   personal.view    see my own inbox, and the shared policy metadata needed to
 *                    render it. Phase 1 capability, holders unchanged.
 *   personal.write   change MY OWN inbox state. D10-R holders: the personal.view
 *                    holders minus viewer.
 *   personal.admin   tenant-wide inbox policy and cross-user administration.
 *                    Owner only.
 *
 * A capability alone was never going to be enough here. `personal.write` is held
 * by five of seven roles, so a capability check by itself would let any project
 * manager complete, reassign or delegate anybody else's work. Every self-scoped
 * entry below therefore also carries an ownership rule enforced against the live
 * database principal — `ownershipRule` records which, and the ratchet asserts the
 * route really applies it.
 *
 * What this slice repaired, not just guarded
 * ──────────────────────────────────────────
 * The blocked Phase 2C-4 analysis found four live defects in this surface. They
 * are closed here because authorization could not be expressed without fixing
 * them:
 *
 *   1. `PATCH /actions/:id` had no ownership check and accepted
 *      `assigned_to_user_id` from the body, so any authenticated principal —
 *      viewer included — could reassign or complete anyone's action.
 *   2. `req.auth?.userId` does not exist on the token (`sub`/`tid`/`role`/`jti`),
 *      so `GET /actions/my`, `GET/POST /delegations` and `PATCH /delegations/:id`
 *      were dead or empty, and five audit trails recorded a null actor.
 *   3. `_requireAdminOrPm` and `PATCH /delegations/:id` authorized from the JWT
 *      role claim, so a demoted user kept SLA-policy and delegation authority
 *      until their token expired.
 *   4. Nothing validated that a reassignment or delegation target belonged to the
 *      caller's tenant.
 *
 * Deliberately NOT closed: `notifications.ts`. See DEFERRED_NOTIFICATIONS.
 */
import type { ServerCapability } from './capabilities'

export type PersonalInboxClassification =
  /** Returns only the live principal's own rows. */
  | 'PERSONAL_SELF_READ'
  /** Changes only the live principal's own state. */
  | 'PERSONAL_SELF_MUTATION'
  /** Returns the tenant-wide queue across all users. Owner only. */
  | 'PERSONAL_TENANT_ADMIN_READ'
  /** Changes tenant-wide policy, or another user's state. Owner only. */
  | 'PERSONAL_TENANT_ADMIN_MUTATION'
  /** Personal state AND assistant invocation — a real conjunction. */
  | 'PERSONAL_ASSISTANT_MUTATION'
  /** Named, but not closed: the data model has no personal scope to enforce. */
  | 'DEFERRED_NOTIFICATION_OWNERSHIP_MODEL'

/** How a route is bound to a principal. */
export type PersonalScope =
  /** The live principal's own record(s) only. */
  | 'SELF'
  /** Tenant-wide; requires personal.admin. */
  | 'TENANT_ADMIN'
  /** Self by default, cross-user only with personal.admin. */
  | 'SELF_OR_ADMIN'
  /**
   * Shared policy metadata with no per-user rows to scope — every reader sees
   * the same rows, and that is the correct answer rather than a missing filter.
   * Only `personal.view` opens it; changing the policy is TENANT_ADMIN.
   */
  | 'SHARED_POLICY_READ'

export interface PersonalInboxEndpoint {
  file:   string
  router: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path:   string
  kind:   'READ' | 'MUTATION'
  classification: PersonalInboxClassification
  /** EVERY capability the caller must hold. Conjunction, never "any of". */
  capabilities: readonly ServerCapability[]
  scope: PersonalScope
  /**
   * How the route proves the record is the caller's, beyond the capability.
   * `'capability-only'` is permitted ONLY for TENANT_ADMIN scope, where the
   * capability itself is the tenant-wide authority. The ratchet enforces that.
   */
  ownershipRule: string
  reason: string
}

/** The temporary-free, fully derived Personal Inbox core. */
export const PERSONAL_INBOX_ENDPOINTS: readonly PersonalInboxEndpoint[] = [

  // ══ actions.ts — self-scoped reads ═══════════════════════════════════════
  {
    file: 'actions.ts', router: 'actionsRouter', method: 'GET', path: '/my',
    kind: 'READ', classification: 'PERSONAL_SELF_READ',
    capabilities: ['personal.view'], scope: 'SELF',
    ownershipRule: 'query filters assigned_to_user_id = live principal id',
    reason: 'The canonical "my queue" route. Already query-scoped to the assignee; this slice replaced the broken req.auth.userId lookup — which made it answer 401 unconditionally — with the live database principal.',
  },
  {
    file: 'actions.ts', router: 'actionsRouter', method: 'GET', path: '/delegations',
    kind: 'READ', classification: 'PERSONAL_SELF_READ',
    capabilities: ['personal.view'], scope: 'SELF',
    ownershipRule: 'query filters user_id = live principal OR delegate_user_id = live principal',
    reason: 'A user sees delegations they are a party to, in either direction. The existing service semantics are preserved; only the identity source changed, from the nonexistent req.auth.userId to the live principal, which is why the route previously returned an empty list for everyone.',
  },
  {
    file: 'actions.ts', router: 'actionsRouter', method: 'GET', path: '/sla-rules',
    kind: 'READ', classification: 'PERSONAL_SELF_READ',
    capabilities: ['personal.view'], scope: 'SHARED_POLICY_READ',
    ownershipRule: 'no per-user rows exist — every reader sees the same policy, by design',
    reason: 'ADR-014 Phase 2C-4A §11: the rule set is ordinary policy metadata a user needs to understand their own deadlines. Reading the policy is not authority over it — POST and PATCH on the same resource require personal.admin.',
  },

  // ══ actions.ts — single-action reads, ownership enforced ═════════════════
  ...(['/:id', '/:id/timeline', '/:id/dependencies', '/:id/relationships'] as const).map(path => ({
    file: 'actions.ts', router: 'actionsRouter', method: 'GET' as const, path,
    kind: 'READ' as const, classification: 'PERSONAL_SELF_READ' as const,
    capabilities: ['personal.view'] as readonly ServerCapability[], scope: 'SELF_OR_ADMIN' as const,
    ownershipRule: 'requireActionAccess — assigned_to_user_id = live principal, or personal.admin',
    reason: 'personal.view opens the route; ownership decides the record. A project manager, engineer, procurement or field user must not read another user\'s action merely because they share a tenant. Answers 404 rather than 403 for a foreign action, because the existence of an action id is itself information about another user\'s queue.',
  })),

  // ══ actions.ts — tenant-wide reads ═══════════════════════════════════════
  ...([
    ['/', 'the organisation-wide action list, filterable by any assignee'],
    ['/inbox', 'the unified operations inbox across every user and module'],
    ['/overdue', 'every overdue action in the tenant'],
    ['/summary', 'tenant-wide counts by status and priority'],
    ['/analytics/overview', 'tenant-wide operational aggregate'],
    ['/analytics/trends', 'tenant-wide trend series'],
    ['/analytics/workload', 'per-assignee workload across the tenant — cross-user by definition'],
  ] as const).map(([path, what]) => ({
    file: 'actions.ts', router: 'actionsRouter', method: 'GET' as const, path,
    kind: 'READ' as const, classification: 'PERSONAL_TENANT_ADMIN_READ' as const,
    capabilities: ['personal.admin'] as readonly ServerCapability[], scope: 'TENANT_ADMIN' as const,
    ownershipRule: 'capability-only — personal.admin IS the tenant-wide authority',
    reason: `Returns ${what}. Not a personal surface: the truthful self-scoped source is GET /my. ADR-014 Phase 2C-4A §13 — do not preserve broad access merely because a page currently calls it. /overdue and /analytics/workload additionally shed a JWT-role check (_requireAdminOrPm) that survived a demotion until the token expired.`,
  })),

  // ══ actions.ts — self-scoped mutations ═══════════════════════════════════
  {
    file: 'actions.ts', router: 'actionsRouter', method: 'PATCH', path: '/:id',
    kind: 'MUTATION', classification: 'PERSONAL_SELF_MUTATION',
    capabilities: ['personal.write'], scope: 'SELF_OR_ADMIN',
    ownershipRule: 'requireActionAccess + requireCapabilityForFields(assigned_to_user_id, assigned_to_role → personal.admin)',
    reason: 'The highest-severity defect this slice closes. Before: no ownership predicate at all, and assigned_to_user_id/assigned_to_role writable from the body, so any authenticated principal could reassign or complete any action in the tenant. Now: ordinary status/priority/description edits need personal.write AND ownership; the two assignment fields are refused outright without personal.admin (403 with the field named, never a silent drop); and an admin reassignment must name a target who is an active member of the same tenant.',
  },
  ...(['/:id/sla/pause', '/:id/sla/resume'] as const).map(path => ({
    file: 'actions.ts', router: 'actionsRouter', method: 'POST' as const, path,
    kind: 'MUTATION' as const, classification: 'PERSONAL_SELF_MUTATION' as const,
    capabilities: ['personal.write'] as readonly ServerCapability[], scope: 'SELF_OR_ADMIN' as const,
    ownershipRule: 'requireActionAccess — assigned_to_user_id = live principal, or personal.admin',
    reason: 'Action-local: pauseSla/resumeSla update action_sla_state for one action_id, not tenant SLA policy. Deliberately NOT promoted to personal.admin because the path contains "sla" — the policy surface is /sla-rules and that one IS personal.admin. The audit actor, previously always null, is now the live principal.',
  })),
  {
    file: 'actions.ts', router: 'actionsRouter', method: 'POST', path: '/:id/relationships',
    kind: 'MUTATION', classification: 'PERSONAL_SELF_MUTATION',
    capabilities: ['personal.write'], scope: 'SELF_OR_ADMIN',
    ownershipRule: 'requireActionAccess on the parent action :id',
    reason: 'Writes action_relations only — it links the caller\'s action to another record and does not mutate the linked business object, so it is not a domain-write bypass and needs no domain capability. Audit actor repaired.',
  },
  {
    file: 'actions.ts', router: 'actionsRouter', method: 'DELETE', path: '/relationships/:relId',
    kind: 'MUTATION', classification: 'PERSONAL_SELF_MUTATION',
    capabilities: ['personal.write'], scope: 'SELF_OR_ADMIN',
    ownershipRule: 'resolve source_action_id from the relation, then requireActionAccess on it',
    reason: 'Authorized against the action the relation hangs off, not the relation id. "The relation exists in my tenant" is not ownership — it would let any personal.write holder unpick another user\'s dependency graph. Audit actor repaired.',
  },
  {
    file: 'actions.ts', router: 'actionsRouter', method: 'POST', path: '/delegations',
    kind: 'MUTATION', classification: 'PERSONAL_SELF_MUTATION',
    capabilities: ['personal.write'], scope: 'SELF',
    ownershipRule: 'delegator bound server-side to the live principal; user_id/delegator_id/created_by in the body are refused',
    reason: 'Self-service only: "I delegate my queue to Bob". The delegator is never caller-selected — any attempt to supply one is a 403 naming the field rather than a silent override, so impersonation fails loudly. The delegate target must be an active member of the same tenant, closing cross-tenant delegation. This route answered 401 unconditionally before the identity repair.',
  },
  {
    file: 'actions.ts', router: 'actionsRouter', method: 'PATCH', path: '/delegations/:id',
    kind: 'MUTATION', classification: 'PERSONAL_SELF_MUTATION',
    capabilities: ['personal.write'], scope: 'SELF_OR_ADMIN',
    ownershipRule: 'SQL predicate user_id = live principal, widened only when the live principal holds personal.admin',
    reason: 'Replaces `[\'owner\',\'admin\'].includes(req.auth?.role)` — authority read from the token, on a cross-user operation, and the only branch that worked because user_id was NULL. Admin loses this authority entirely: administering another user\'s delegation is business workflow, not platform administration.',
  },

  // ══ actions.ts — tenant-wide policy mutations ════════════════════════════
  ...([['POST', '/sla-rules'], ['PATCH', '/sla-rules/:id']] as const).map(([method, path]) => ({
    file: 'actions.ts', router: 'actionsRouter', method: method as 'POST' | 'PATCH', path,
    kind: 'MUTATION' as const, classification: 'PERSONAL_TENANT_ADMIN_MUTATION' as const,
    capabilities: ['personal.admin'] as readonly ServerCapability[], scope: 'TENANT_ADMIN' as const,
    ownershipRule: 'capability-only — personal.admin IS the tenant-wide authority',
    reason: 'SLA rules govern every user\'s deadlines and escalations. Acting within a policy is ordinary work; redefining the policy for everybody is not. Replaces _requireAdminOrPm, which read the JWT role and therefore survived a demotion until the token expired.',
  })),

  // ══ personalAgent.ts ═════════════════════════════════════════════════════
  ...(['/me/agent/briefing', '/me/agent/memory'] as const).map(path => ({
    file: 'personalAgent.ts', router: 'router', method: 'GET' as const, path,
    kind: 'READ' as const, classification: 'PERSONAL_SELF_READ' as const,
    capabilities: ['personal.view'] as readonly ServerCapability[], scope: 'SELF' as const,
    ownershipRule: 'service scoped by scope_id = live principal id; no caller-supplied user scope is accepted',
    reason: 'The cleanest surface in the slice: the route never accepted a user id from the caller. The identity source moved from the token subject to the live principal, so a deactivated or deleted account cannot read its own memory.',
  })),
  ...([['POST', '/me/agent/memory'], ['DELETE', '/me/agent/memory/:key']] as const).map(([method, path]) => ({
    file: 'personalAgent.ts', router: 'router', method: method as 'POST' | 'DELETE', path,
    kind: 'MUTATION' as const, classification: 'PERSONAL_SELF_MUTATION' as const,
    capabilities: ['personal.write'] as readonly ServerCapability[], scope: 'SELF' as const,
    ownershipRule: 'service scoped by scope_id = live principal id',
    reason: 'Writes agent_memory_entries under the caller\'s own user scope. Viewer is refused by D10-R; field_ops is admitted, because remembering a preference exercises no AI-execution authority.',
  })),
  {
    file: 'personalAgent.ts', router: 'router', method: 'POST', path: '/me/agent/ask',
    kind: 'MUTATION', classification: 'PERSONAL_ASSISTANT_MUTATION',
    capabilities: ['personal.write', 'assistant.use'], scope: 'SELF',
    ownershipRule: 'service scoped by scope_id = live principal id',
    reason: 'Closes an assistant-gate bypass. This calls the same askJarvis() engine as /api/v1/ask — which is gated router-wide by assistant.use — and it persists chat_sessions plus chat_messages and consumes AI budget. Guarded by personal.write alone it would be a cheaper path to Jarvis for a principal the assistant gate refuses. The conjunction is behaviourally real: field_ops holds personal.write but not assistant.use and is refused.',
  },

  // ══ myWork.ts ════════════════════════════════════════════════════════════
  {
    file: 'myWork.ts', router: 'router', method: 'GET', path: '/my-work',
    kind: 'READ', classification: 'PERSONAL_SELF_READ',
    capabilities: ['personal.view'], scope: 'SELF',
    ownershipRule: 'buildMyWork(tenantId, live principal id) — self-scoped by construction',
    reason: 'The universal personal queue. Already self-scoped; the identity source moved to the live principal so a deactivated account cannot pull a queue.',
  },
]

/**
 * `notifications.ts` — named, deliberately NOT closed, still PENDING_PHASE2.
 *
 * ADR-014 Phase 2C-4A §5 (owner decision). The blocked Phase 2C-4 analysis
 * proved from `api/db/migrations/064_notifications.sql` that the table carries
 * tenant_id, category, priority, title, body, source_type, source_id, link_tab,
 * read_at, dismissed_at and created_at — and **no user, recipient or owner
 * column**. `read_at`/`dismissed_at` are single columns on a shared tenant row,
 * so one user marking a notification read marks it read for everyone, and every
 * service call takes only a tenant id.
 *
 * There is therefore no personal scope to enforce, and the required
 * "user A cannot mutate user B's notification" invariant is not expressible
 * against this schema. Filtering by the caller would be fabricated ownership,
 * which §5 forbids; the fail-closed owner-only alternative is also explicitly
 * withheld, because it decides product behaviour that belongs with the schema
 * decision.
 *
 * These 7 endpoints keep their current behaviour and remain counted as pending
 * debt. They are named here so an unexplained omission and a deliberate deferral
 * cannot look the same. ADR-014 Phase 2C-4B owns the resolution.
 */
export interface DeferredNotificationEndpoint {
  file: string; router: string; method: string; path: string
  kind: 'READ' | 'MUTATION'
  classification: 'DEFERRED_NOTIFICATION_OWNERSHIP_MODEL'
  reason: string
}

const NOTIF_REASON =
  'The notifications table has no user/recipient/owner column and read_at/dismissed_at are shared '
  + 'per-tenant row state, so there is no personal scope to enforce and no per-user read model to '
  + 'authorize against. Deferred whole to ADR-014 Phase 2C-4B, which must decide the data model and '
  + 'the product behaviour together. Unchanged and still PENDING_PHASE2.'

export const DEFERRED_NOTIFICATIONS: readonly DeferredNotificationEndpoint[] = [
  ...(['/notifications', '/notifications/count'] as const).map(path => ({
    file: 'notifications.ts', router: 'notificationsRouter', method: 'GET', path,
    kind: 'READ' as const,
    classification: 'DEFERRED_NOTIFICATION_OWNERSHIP_MODEL' as const,
    reason: NOTIF_REASON,
  })),
  ...([
    '/notifications/scan', '/notifications/read-all', '/notifications/clear',
    '/notifications/:id/read', '/notifications/:id/dismiss',
  ] as const).map(path => ({
    file: 'notifications.ts', router: 'notificationsRouter', method: 'POST', path,
    kind: 'MUTATION' as const,
    classification: 'DEFERRED_NOTIFICATION_OWNERSHIP_MODEL' as const,
    reason: NOTIF_REASON,
  })),
]

/**
 * Fields that decide *who owns* an action rather than how it is progressing.
 * Writing them is cross-user administration; `requireCapabilityForFields` on
 * `PATCH /actions/:id` refuses them without `personal.admin`.
 */
export const ACTION_ASSIGNMENT_FIELDS = ['assigned_to_user_id', 'assigned_to_role'] as const

/**
 * Pre-existing route shadowing found while closing this surface — NOT introduced
 * here, and NOT fixed here.
 *
 * `actions.ts` declares `GET /:id` before three literal single-segment GET
 * routes, so Express resolves `/actions/sla-rules`, `/actions/delegations` and
 * `/actions/inbox` to the single-action handler. Each therefore looks up an
 * action whose id is the literal string and answers 404 for everyone.
 *
 * Security consequence: none. The shadowing is strictly MORE restrictive than
 * the guard each route declares — nothing is disclosed and nothing is written.
 * The declared guards below are correct and take effect the moment the
 * declaration order is fixed.
 *
 * It is recorded rather than repaired because reordering would make three
 * endpoints reachable for the first time, which is a functional change to the
 * Action Center rather than an authorization one, and ADR-014 Phase 2C-4A does
 * not authorize it. The ratchet asserts this set does not GROW, so a new shadow
 * cannot appear unnoticed.
 */
export const KNOWN_SHADOWED_ROUTES = [
  { file: 'actions.ts', router: 'actionsRouter', method: 'GET', path: '/sla-rules',   shadowedBy: 'GET /:id' },
  { file: 'actions.ts', router: 'actionsRouter', method: 'GET', path: '/delegations', shadowedBy: 'GET /:id' },
  { file: 'actions.ts', router: 'actionsRouter', method: 'GET', path: '/inbox',       shadowedBy: 'GET /:id' },
] as const

/** Live defects this slice closed, kept so the ratchet can assert they stay closed. */
export const CLOSED_LIVE_DEFECTS = [
  { id: 'ACTION_MASS_ASSIGNMENT',      route: 'actions.ts PATCH /:id',                  wasReachableBy: 'any authenticated principal, viewer included' },
  { id: 'ACTION_OWNERSHIP_MISSING',    route: 'actions.ts PATCH /:id',                  wasReachableBy: 'any authenticated principal in the tenant' },
  { id: 'DELEGATION_IDENTITY_BROKEN',  route: 'actions.ts POST|GET|PATCH /delegations', wasReachableBy: 'nobody — req.auth.userId does not exist, so the surface was dead' },
  { id: 'DELEGATION_STALE_TOKEN',      route: 'actions.ts PATCH /delegations/:id',      wasReachableBy: 'any token claiming owner or admin' },
  { id: 'SLA_POLICY_STALE_TOKEN',      route: 'actions.ts POST|PATCH /sla-rules',       wasReachableBy: 'any token claiming owner, admin or project_manager' },
  { id: 'ASSISTANT_GATE_BYPASS',       route: 'personalAgent.ts POST /me/agent/ask',    wasReachableBy: 'any authenticated principal, bypassing assistant.use' },
  { id: 'NULL_AUDIT_ACTOR',            route: 'actions.ts relationship + SLA events',   wasReachableBy: 'n/a — every actor was recorded as null' },
] as const
