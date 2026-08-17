/**
 * Denver Engineering — record-scope policy registry (ADR-014 Phase 3A)
 * ─────────────────────────────────────────────────────────────────────────────
 * One truthful policy per resource type Phase 3A secures. Each says what
 * FUNCTIONAL authority the caller needs and, independently, how the caller's
 * access to THAT RECORD is decided.
 *
 * There is no `ALLOW_ALL` strategy and no default branch: a resource type with
 * no entry is DENIED, so adding a `/related` source without a policy fails
 * closed rather than inheriting tenant-wide visibility.
 */
import type { ServerCapability } from './capabilities'

// ─── Project-scope discovery (ADR-014 Phase 3A §5) ────────────────────────────

/**
 * Every candidate user↔project relationship in the repository, with the
 * evidence that selected or rejected it. Recorded so the choice can be
 * re-audited without repeating the search, and asserted by the Phase 3A ratchet.
 */
export interface ScopeSourceCandidate {
  candidate:   string
  table:       string
  /** The column identifying the PRINCIPAL, and what it actually references. */
  userKey:     string
  projectKey:  string
  tenantKey:   string
  writtenBy:   string
  readBy:      string
  activeSemantics: string
  live:        boolean
  verdict:     'CANONICAL' | 'REJECTED'
  why:         string
}

export const PROJECT_SCOPE_CANDIDATES: readonly ScopeSourceCandidate[] = [
  {
    candidate: 'Responsible-user assignment on the project row',
    table: 'projects',
    userKey: 'project_manager, lead_engineer, created_by — all UUID REFERENCES users(id)',
    projectKey: 'projects.id (the row itself)',
    tenantKey: 'projects.tenant_id',
    writtenBy: 'projects.ts POST / and PATCH /:id (project.write); created_by is set from req.auth.sub, never from the body',
    readBy: 'projects.ts GET / and GET /:id already LEFT JOIN users on all three',
    activeSemantics: 'NULL means unassigned; there is no soft-delete or date window',
    live: true,
    verdict: 'CANONICAL',
    why: 'The only relationship in the repository that connects a LOGIN PRINCIPAL to a project. Real foreign keys to users(id), server-written, tenant-bounded by the project row, and already read by the project routes. `created_by` is included so that creating a project does not produce a read dead-end for the project manager who created it — only owner and project_manager hold project.write, and owner is tenant-wide anyway, so its widening is at most one project_manager per project.',
  },
  {
    candidate: 'Workforce project assignment',
    table: 'project_assignments',
    userKey: 'member_id → team_members(id) — NOT users(id)',
    projectKey: 'project_id → projects(id)',
    tenantKey: 'tenant_id',
    writtenBy: 'teamService.assignToProject',
    readBy: 'teamService, timesheetService',
    activeSemantics: 'end_date NULL = current assignment',
    live: true,
    verdict: 'REJECTED',
    why: 'It assigns a WORKFORCE MEMBER, not a login principal. `team_members` is an HR roster (first_name, last_name, phone, trade, hourly_rate, member_status) with no user_id column and no foreign key to users. teamService reads only id/name/role/status/tenant from it and never joins users. Bridging the two on `email` would be inventing the relationship, which Phase 3A §4 forbids. This is not a CONTRADICTION with the canonical source — the two model different things (who is employed on the job vs who is responsible for the project record), so they cannot disagree.',
  },
  {
    candidate: 'Per-record actor columns',
    table: 'rfis.assigned_to, punch_items.assigned_to, actions.assigned_to_user_id, change_orders.approved_by, … (~30 tables)',
    userKey: 'various UUID REFERENCES users(id)',
    projectKey: 'the record’s own project_id',
    tenantKey: 'the record’s own tenant_id',
    writtenBy: 'each domain service',
    readBy: 'each domain service',
    activeSemantics: 'n/a',
    live: true,
    verdict: 'REJECTED',
    why: 'These say "this person owns this ITEM", not "this person may access this PROJECT". Deriving project scope from them would mean any single assigned punch item silently granted access to the whole project — a widening by inference rather than an authoritative grant. They remain the correct basis for SELF-scoped records such as Personal Inbox actions, which is how the `action` policy below uses them.',
  },
]

export const CANONICAL_PROJECT_SCOPE = {
  table: 'projects',
  columns: ['project_manager', 'lead_engineer', 'created_by'] as const,
  ownerRule: 'The owner role reaches every project in its OWN tenant, and none outside it.',
  resolver: 'api/authz/recordScope.ts — filterAccessibleProjectIds',
} as const

// ─── Scope strategies ─────────────────────────────────────────────────────────

export type ScopeStrategy =
  /** Owner reaches every project in its own tenant; others need a responsible-user assignment. */
  | 'TENANT_OWNER_OR_PROJECT_ASSIGNMENT'
  /** The record hangs off a project; scope is inherited from that parent project. */
  | 'PARENT_PROJECT'
  /** The record belongs to one user; scope is that user (or a tenant-admin capability). */
  | 'SELF'

export interface RecordScopePolicy {
  /** The `/related` source/target discriminator, or the route resource name. */
  resource:   string
  /** Physical table, so the ratchet can prove the scope column exists. */
  table:      string
  /** EVERY functional capability the caller must hold. Conjunction. */
  capabilities: readonly ServerCapability[]
  strategy:   ScopeStrategy
  /** How the record's scope key is obtained. */
  scopeKey:   string
  tenantRule: string
  /** Why this capability, derived from the route that already serves the domain. */
  reason:     string
}

/**
 * Phase 3A's bounded candidate set: the project detail read, plus every
 * `/related` source and target type mechanically required to secure it.
 *
 * Capabilities are DERIVED from the route that already serves each domain, not
 * invented here — `rfis`/`submittals` are served by `procurement.ts` under
 * `construction.view`, drawings by `drawings.ts` under `engineering.view`, and
 * so on. Phase 3A adds record scope to those; it does not re-open Phase 2.
 */
export const RECORD_SCOPE_POLICIES: readonly RecordScopePolicy[] = [
  {
    resource: 'project',
    table: 'projects',
    capabilities: ['project.view'],
    strategy: 'TENANT_OWNER_OR_PROJECT_ASSIGNMENT',
    scopeKey: 'projects.id via project_manager | lead_engineer | created_by',
    tenantRule: 'projects.tenant_id = app.current_tenant_id, applied to the owner too',
    reason: 'project.view is the capability every project-context read already uses (cf. lifecycle.ts GET /projects/:projectId/lifecycle). Deliberately NOT cost.view: that is owner-only and would close the project record to every delivery role. The commercial columns the row also carries are handled by field projection, not by raising the route capability.',
  },
  {
    resource: 'rfi',
    table: 'rfis',
    capabilities: ['construction.view'],
    strategy: 'PARENT_PROJECT',
    scopeKey: 'rfis.project_id',
    tenantRule: 'rfis.tenant_id = app.current_tenant_id',
    reason: 'rfisRouter (procurement.ts) serves GET / under construction.view.',
  },
  {
    resource: 'submittal',
    table: 'submittals',
    capabilities: ['construction.view'],
    strategy: 'PARENT_PROJECT',
    scopeKey: 'submittals.project_id',
    tenantRule: 'submittals.tenant_id = app.current_tenant_id',
    reason: 'submittalsRouter (procurement.ts) serves GET / under construction.view.',
  },
  {
    resource: 'changeorder',
    table: 'change_orders',
    capabilities: ['cost.view'],
    strategy: 'PARENT_PROJECT',
    scopeKey: 'change_orders.project_id',
    tenantRule: 'change_orders.tenant_id = app.current_tenant_id',
    reason: 'changeOrders.ts serves its reads under cost.view. This is the discriminating target: a caller may read an RFI under construction.view and still not see the change order it produced, because cost.view is owner-only.',
  },
  {
    resource: 'ncr',
    table: 'ncrs',
    capabilities: ['quality.view'],
    strategy: 'PARENT_PROJECT',
    scopeKey: 'ncrs.project_id',
    tenantRule: 'ncrs.tenant_id = app.current_tenant_id',
    reason: 'ncr.ts serves its reads under quality.view.',
  },
  {
    resource: 'capa',
    table: 'corrective_actions',
    capabilities: ['quality.view'],
    strategy: 'PARENT_PROJECT',
    scopeKey: 'corrective_actions.project_id',
    tenantRule: 'corrective_actions.tenant_id = app.current_tenant_id',
    reason: 'Corrective/preventive actions are served by ncr.ts alongside the NCR they close out; same quality.view authority.',
  },
  {
    resource: 'punch',
    table: 'punch_items',
    capabilities: ['quality.view'],
    strategy: 'PARENT_PROJECT',
    scopeKey: 'punch_items.project_id',
    tenantRule: 'punch_items.tenant_id = app.current_tenant_id',
    reason: 'punchLists.ts serves its reads under quality.view.',
  },
  {
    resource: 'drawing',
    table: 'drawings',
    capabilities: ['engineering.view'],
    strategy: 'PARENT_PROJECT',
    scopeKey: 'drawings.project_id',
    tenantRule: 'drawings.tenant_id = app.current_tenant_id',
    reason: 'drawings.ts serves its reads under engineering.view.',
  },
  {
    resource: 'inspection',
    table: 'inspections',
    capabilities: ['quality.view'],
    strategy: 'PARENT_PROJECT',
    scopeKey: 'inspections.project_id',
    tenantRule: 'inspections.tenant_id = app.current_tenant_id',
    reason: 'inspections.ts serves its reads under quality.view.',
  },
  {
    resource: 'action',
    table: 'actions',
    capabilities: ['personal.view'],
    strategy: 'SELF',
    scopeKey: 'actions.assigned_to_user_id = live principal, or personal.admin',
    tenantRule: 'actions.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 2C-4A established that an action is a PERSONAL record: personal.view opens the route and ownership decides the record, with personal.admin as the tenant-wide authority. Phase 3A reuses that rule verbatim rather than re-deriving it, and deliberately does NOT use PARENT_PROJECT — an action carries a project_id, but its owner is the person it is assigned to, and inheriting project scope would widen a closed Personal Inbox surface.',
  },
]

const BY_RESOURCE = new Map(RECORD_SCOPE_POLICIES.map(p => [p.resource, p]))

/**
 * The policy for a resource type, or `null` when there is none.
 *
 * `null` means DENY at every call site. There is no permissive fallback: an
 * unknown `/related` source must not become tenant-wide visibility.
 */
export function policyFor(resource: string): RecordScopePolicy | null {
  return BY_RESOURCE.get(resource) ?? null
}

/**
 * Resource types Phase 3A examined but could NOT give a truthful scope policy.
 * Empty is the closed state; a non-empty entry downgrades the slice to PARTIAL
 * and the type must fail closed at runtime.
 */
export const PENDING_PHASE3_POLICY: readonly { resource: string; reason: string }[] = []

// ─── Phase-3 adoption counters (ADR-014 Phase 3A §29) ─────────────────────────

/**
 * Phase 3A's BOUNDED candidate set — deliberately not the whole API.
 *
 * The two endpoints Phase 2 deferred, plus every resource type mechanically
 * required to secure `/related`. Converting all 744 endpoints to record scope
 * is not this slice's job and claiming otherwise would misstate adoption.
 *
 * `deferred` and `unexplained` must both be empty. `unexplained` existing at all
 * is the point: a `/related` source with no policy lands there rather than
 * quietly inheriting tenant-wide visibility.
 */
export interface RecordScopeAdoption {
  candidates:  readonly string[]
  protectedBy: readonly string[]
  deferred:    readonly string[]
  unexplained: readonly string[]
}

/** The two endpoints, by census key. */
export const PHASE_3A_ENDPOINT_CANDIDATES = [
  'projects.ts router.GET /:id',
  'related.ts router.GET /related/:source/:id',
] as const

/** Derived, so a policy removed from the registry shows up as a gap. */
export function recordScopeAdoption(relatedSources: readonly string[]): RecordScopeAdoption {
  const resourceCandidates = [...new Set([...relatedSources, 'project', 'action'])]
  const deferredSet = new Set(PENDING_PHASE3_POLICY.map(p => p.resource))

  return {
    candidates:  [...PHASE_3A_ENDPOINT_CANDIDATES, ...resourceCandidates],
    protectedBy: resourceCandidates.filter(r => policyFor(r) !== null && !deferredSet.has(r)),
    deferred:    resourceCandidates.filter(r => deferredSet.has(r)),
    unexplained: resourceCandidates.filter(r => policyFor(r) === null && !deferredSet.has(r)),
  }
}
