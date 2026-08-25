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

/**
 * How a DIRECT-ID route gets from `:id` to the parent project it must authorize
 * against (ADR-014 Phase 3C §17, §36).
 *
 * Phase 3A and 3B only ever had to scope a route whose PATH already named the
 * project. A direct-ID route names only the record, so the parent has to be
 * resolved before the decision can be made — and resolving it is exactly the
 * step whose absence let a caller reach any record in the tenant by knowing its
 * UUID.
 *
 * Every identifier here comes from this registry, never from the request, so
 * the resolver can compose SQL from them without an injection surface. The
 * shapes mirror the two strategies the schema actually uses; the Phase-3C
 * ratchet asserts each entry against the machine-derived
 * `audit/adr-014/schema-project-parent-map.json`, so a declaration that
 * disagrees with the migrations fails rather than silently resolving nothing.
 */
export type ProjectDerivation =
  /** The record carries `project_id` itself. */
  | { kind: 'DIRECT_COLUMN'; table: string; idColumn: string; tenantColumn: string; projectColumn: string }
  /** The record reaches a project through exactly one foreign key. */
  | {
      kind: 'FK_PATH'; table: string; idColumn: string; tenantColumn: string
      via: string; parentTable: string; parentIdColumn: string; parentProjectColumn: string
    }

/**
 * What a NULL project parent MEANS for this resource (ADR-014 Phase 3E-R §3).
 *
 * Phase 3D and 3E applied one rule to every resource: a record whose
 * `project_id` is NULL is refused. That is safe, and for a table whose column
 * is `NOT NULL` it is also free — the branch is unreachable. For a table whose
 * column is nullable it was neither: the ingest and create paths of several
 * resources produce project-less rows deliberately, and refusing them made
 * those rows unreachable by EVERY principal, the tenant Owner included,
 * because the resolver returned before the tenant-wide branch could run.
 *
 * The fix is not to relax the rule but to make the resource state which rule
 * applies to it. There is no default: a policy with no `projectSemantics` does
 * not compile, so a resource cannot acquire a NULL-parent meaning by accident.
 *
 * `PROJECT_REQUIRED`
 *     every legitimate record belongs to a project. A NULL parent is invalid
 *     or legacy and stays refused. For the 44 resources whose column is
 *     `NOT NULL` this is the schema's own guarantee, not a policy choice.
 * `TENANT_GLOBAL`
 *     the resource belongs to the tenant, never to a project.
 * `DUAL_PROJECT_OR_TENANT`
 *     both states are legitimate and the ROW decides: a project id means
 *     project scope, NULL means tenant scope.
 * `SELF_SCOPED`
 *     project membership is not the governing rule for this resource; some
 *     other principal rule is (see `strategy: 'SELF'`).
 *
 * Membership is never weakened by any of these: the NULL branch is reached
 * only when the record HAS no project, so there is no project to be a member
 * of. The choice a nullable resource actually faces is between "tenant plus
 * the route's existing capability" and "nobody, ever" — not between a loose
 * rule and a strict one.
 */
export type ProjectSemantics =
  | 'PROJECT_REQUIRED'
  | 'TENANT_GLOBAL'
  | 'DUAL_PROJECT_OR_TENANT'
  | 'SELF_SCOPED'

/**
 * Whether the project parent can move after the record exists (§15, §35).
 *
 * This is the escape hatch the dual model would otherwise open: if a caller
 * could set `project_id = NULL` on a project-scoped record under ordinary
 * write authority, they could promote it out of its project and then read it
 * back through the tenant-global branch. Every writer in the repository was
 * audited for this; none of them writes `project_id` on an UPDATE, and every
 * column allow-list excludes it — so the honest value for all resources today
 * is `IMMUTABLE`, and the ratchet holds it there.
 *
 * The transfer-capable values exist so that adding such a workflow is a
 * deliberate, reviewable change to this registry rather than a side effect of
 * widening an allow-list.
 */
export type ProjectParentMutation =
  | 'IMMUTABLE'                        // set on create, never changed
  | 'PROMOTION_TO_GLOBAL_SUPPORTED'    // project → tenant-global is a real workflow
  | 'ASSIGN_TO_PROJECT_SUPPORTED'      // tenant-global → project is a real workflow
  | 'BIDIRECTIONAL_TRANSFER_SUPPORTED' // both directions are real workflows

export interface RecordScopePolicy {
  /** The `/related` source/target discriminator, or the route resource name. */
  resource:   string
  /** Physical table, so the ratchet can prove the scope column exists. */
  table:      string
  /** EVERY functional capability the caller must hold. Conjunction. */
  capabilities: readonly ServerCapability[]
  strategy:   ScopeStrategy
  /**
   * What a NULL project parent means here. REQUIRED — there is no default,
   * so a new resource must decide rather than inherit (§3).
   */
  projectSemantics: ProjectSemantics
  /**
   * Whether the project parent can move after create. REQUIRED, for the same
   * reason: silence must not read as permission (§15).
   */
  projectParentMutation: ProjectParentMutation
  /**
   * The repository evidence that a project-less row is legitimate here (§8).
   *
   * Required by the Phase-3E-R ratchet for every resource whose semantics are
   * NOT `PROJECT_REQUIRED`, and forbidden for those that are. The asymmetry is
   * deliberate: `PROJECT_REQUIRED` restates a `NOT NULL` constraint the schema
   * already enforces and needs no argument, whereas a claim that NULL is a real
   * product state is exactly the claim that has to be defensible.
   */
  projectSemanticsEvidence?: string
  /** How the record's scope key is obtained. */
  scopeKey:   string
  tenantRule: string
  /** Why this capability, derived from the route that already serves the domain. */
  reason:     string
  /**
   * Record-id → parent-project resolution, for routes whose path carries only
   * the record. Absent for SELF-scoped resources and for the project root,
   * which have no parent to resolve.
   */
  derivation?: ProjectDerivation
  /** The capability an ordinary write to this resource requires. */
  writeCapabilities?: readonly ServerCapability[]
  /**
   * The capability a CONSEQUENTIAL transition requires (§25). Recorded
   * separately so adding record scope can never be mistaken for permission to
   * lower an approval authority to an ordinary write.
   */
  approveCapabilities?: readonly ServerCapability[]
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
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'projects.id via project_manager | lead_engineer | created_by',
    tenantRule: 'projects.tenant_id = app.current_tenant_id, applied to the owner too',
    reason: 'project.view is the capability every project-context read already uses (cf. lifecycle.ts GET /projects/:projectId/lifecycle). Deliberately NOT cost.view: that is owner-only and would close the project record to every delivery role. The commercial columns the row also carries are handled by field projection, not by raising the route capability.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'projects', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'id' },
    writeCapabilities: ['project.write'],
    approveCapabilities: ['project.approve'],
  },
  {
    resource: 'rfi',
    table: 'rfis',
    capabilities: ['construction.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'rfis.project_id',
    tenantRule: 'rfis.tenant_id = app.current_tenant_id',
    reason: 'rfisRouter (procurement.ts) serves GET / under construction.view.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'rfis', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['construction.write'],
  },
  {
    resource: 'submittal',
    table: 'submittals',
    capabilities: ['construction.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'submittals.project_id',
    tenantRule: 'submittals.tenant_id = app.current_tenant_id',
    reason: 'submittalsRouter (procurement.ts) serves GET / under construction.view.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'submittals', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['construction.write'],
    approveCapabilities: ['construction.approve'],
  },
  {
    resource: 'changeorder',
    table: 'change_orders',
    capabilities: ['cost.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'change_orders.project_id',
    tenantRule: 'change_orders.tenant_id = app.current_tenant_id',
    reason: 'changeOrders.ts serves its reads under cost.view. This is the discriminating target: a caller may read an RFI under construction.view and still not see the change order it produced, because cost.view is owner-only.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'change_orders', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['cost.write'],
    approveCapabilities: ['cost.approve'],
  },
  {
    resource: 'ncr',
    table: 'ncrs',
    capabilities: ['quality.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'ncrs.project_id',
    tenantRule: 'ncrs.tenant_id = app.current_tenant_id',
    reason: 'ncr.ts serves its reads under quality.view.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'ncrs', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['quality.write'],
    approveCapabilities: ['quality.verify'],
  },
  {
    resource: 'capa',
    table: 'corrective_actions',
    capabilities: ['quality.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'corrective_actions.project_id',
    tenantRule: 'corrective_actions.tenant_id = app.current_tenant_id',
    reason: 'Corrective/preventive actions are served by ncr.ts alongside the NCR they close out; same quality.view authority.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'corrective_actions', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['quality.write'],
    approveCapabilities: ['quality.verify'],
  },
  {
    resource: 'punch',
    table: 'punch_items',
    capabilities: ['quality.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'punch_items.project_id',
    tenantRule: 'punch_items.tenant_id = app.current_tenant_id',
    reason: 'punchLists.ts serves its reads under quality.view.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'punch_items', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['quality.write'],
    approveCapabilities: ['quality.verify'],
  },
  {
    resource: 'drawing',
    table: 'drawings',
    capabilities: ['engineering.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'drawings.project_id',
    tenantRule: 'drawings.tenant_id = app.current_tenant_id',
    reason: 'drawings.ts serves its reads under engineering.view.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'drawings', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['engineering.write'],
  },
  {
    resource: 'inspection',
    table: 'inspections',
    capabilities: ['quality.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'inspections.project_id',
    tenantRule: 'inspections.tenant_id = app.current_tenant_id',
    reason: 'inspections.ts serves its reads under quality.view.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'inspections', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['quality.write'],
    approveCapabilities: ['quality.verify'],
  },
  {
    resource: 'action',
    table: 'actions',
    capabilities: ['personal.view'],
    strategy: 'SELF',
    projectSemantics: 'SELF_SCOPED',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'SELF, not project: ADR-014 Phase 2C-4A established an action as a PERSONAL record whose owner is its assignee, enforced by requireActionAccess. Project membership is not the governing rule, so the NULL-parent question does not arise for this resource.',
    scopeKey: 'actions.assigned_to_user_id = live principal, or personal.admin',
    tenantRule: 'actions.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 2C-4A established that an action is a PERSONAL record: personal.view opens the route and ownership decides the record, with personal.admin as the tenant-wide authority. Phase 3A reuses that rule verbatim rather than re-deriving it, and deliberately does NOT use PARENT_PROJECT — an action carries a project_id, but its owner is the person it is assigned to, and inheriting project scope would widen a closed Personal Inbox surface.',
  },

  // ── ADR-014 Phase 3C: resources reachable only by their own record id ──────
  //
  // Each of these is served today by a route that names the record and not its
  // project, so before Phase 3C the parent was never consulted. Capabilities
  // are taken from the route that already serves the resource — Phase 3C
  // decides WHERE an existing authority applies, never who holds it.
  {
    resource: 'punchlist',
    table: 'punch_lists',
    capabilities: ['quality.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'punch_lists.project_id',
    tenantRule: 'punch_lists.tenant_id = app.current_tenant_id',
    reason: 'punchLists.ts serves the list and its items under quality.view; the punch list is the parent record its items hang from.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'punch_lists', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['quality.write'],
  },
  {
    resource: 'drawingrevision',
    table: 'drawing_revisions',
    capabilities: ['engineering.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'drawing_revisions.drawing_id → drawings.project_id',
    tenantRule: 'drawing_revisions.tenant_id = app.current_tenant_id',
    reason: 'drawings.ts serves revisions under the same engineering authority as the drawing they revise.',
    derivation: {
      kind: 'FK_PATH', table: 'drawing_revisions', idColumn: 'id', tenantColumn: 'tenant_id',
      via: 'drawing_id', parentTable: 'drawings', parentIdColumn: 'id', parentProjectColumn: 'project_id',
    },
    writeCapabilities: ['engineering.write'],
  },
  {
    resource: 'drawingmarkup',
    table: 'drawing_markups',
    capabilities: ['engineering.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'drawing_markups.drawing_id → drawings.project_id',
    tenantRule: 'drawing_markups.tenant_id = app.current_tenant_id',
    reason: 'A markup is an annotation on a drawing and inherits that drawing’s project; PATCH/DELETE /markups/:markupId name only the markup.',
    derivation: {
      kind: 'FK_PATH', table: 'drawing_markups', idColumn: 'id', tenantColumn: 'tenant_id',
      via: 'drawing_id', parentTable: 'drawings', parentIdColumn: 'id', parentProjectColumn: 'project_id',
    },
    writeCapabilities: ['engineering.write'],
  },

  // ── ADR-014 Phase 3D: the project-bound mutation rollout ───────────────────
  //
  // One entry per table reachable only by its own record id from a mutation
  // route. Every derivation below is the one recorded in
  // audit/adr-014/schema-project-parent-map.json, which is parsed from the
  // migrations; the Phase-3D ratchet asserts the two still agree, so a
  // declaration that drifts from the schema fails rather than silently
  // resolving nothing.
  {
    resource: 'agent_actions',
    table: 'agent_actions',
    capabilities: ['ai.govern'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'agentActions.ts types `project_id: string | null` on ActionRow and writes `input.projectId ?? null`: the table is an AI-governance audit trail, and an agent decision that is not about a project has none. Its authority is unchanged — crossdomain.read to read, ai.govern to review (§22) — so the tenant-global branch admits exactly the holders the route already admitted.',
    scopeKey: 'agent_actions.project_id',
    tenantRule: 'agent_actions.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'agent_actions', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['ai.govern'],
  },
  {
    resource: 'bid_packages',
    table: 'bid_packages',
    capabilities: ['procurement.approve', 'procurement.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'bid_packages.project_id',
    tenantRule: 'bid_packages.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 4 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'bid_packages', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['procurement.write'],
    approveCapabilities: ['procurement.approve'],
  },
  {
    resource: 'bid_submissions',
    table: 'bid_submissions',
    capabilities: ['procurement.approve'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'bid_submissions.bid_package_id → bid_packages.project_id',
    tenantRule: 'bid_submissions.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: {
      kind: 'FK_PATH', table: 'bid_submissions', idColumn: 'id', tenantColumn: 'tenant_id',
      via: 'bid_package_id', parentTable: 'bid_packages', parentIdColumn: 'id', parentProjectColumn: 'project_id',
    },
    writeCapabilities: ['procurement.approve'],
  },
  {
    resource: 'bim_issues',
    table: 'bim_issues',
    capabilities: ['engineering.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'bim_issues.project_id',
    tenantRule: 'bim_issues.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'bim_issues', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['engineering.write'],
  },
  {
    resource: 'bim_models',
    table: 'bim_models',
    capabilities: ['engineering.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'bim_models.project_id',
    tenantRule: 'bim_models.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 4 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'bim_models', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['engineering.write'],
  },
  {
    resource: 'budget_items',
    table: 'budget_items',
    capabilities: ['cost.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'budget_items.budget_id → budgets.project_id',
    tenantRule: 'budget_items.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: {
      kind: 'FK_PATH', table: 'budget_items', idColumn: 'id', tenantColumn: 'tenant_id',
      via: 'budget_id', parentTable: 'budgets', parentIdColumn: 'id', parentProjectColumn: 'project_id',
    },
    writeCapabilities: ['cost.write'],
  },
  {
    resource: 'budgets',
    table: 'budgets',
    capabilities: ['cost.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'budgets.project_id',
    tenantRule: 'budgets.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'budgets', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['cost.write'],
  },
  {
    resource: 'calc_sessions',
    table: 'calc_sessions',
    capabilities: ['engineering.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'The product route POST /projects/:projectId/calc-sessions takes its project from the path, but the mounted MCP bridge (mcp.ts:436, `session_create`) persists an agent session with `projectId ?? null`. A project-less calc session is therefore reachable through a mounted route, not only through orphaning.',
    scopeKey: 'calc_sessions.project_id',
    tenantRule: 'calc_sessions.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'calc_sessions', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['engineering.write'],
  },
  {
    resource: 'chat_sessions',
    table: 'chat_sessions',
    capabilities: ['assistant.admin', 'assistant.use'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'migration 023 declares the column `ON DELETE SET NULL` and askBuilder.ts:338 writes whatever `a.projectId` holds, which is absent for a general ask. Record scope is used here only by DELETE /ask/sessions/:id under assistant.admin; the READ route is guarded separately by `user_id = $2` and does not use this guard, so the SELF rule on reads is untouched.',
    scopeKey: 'chat_sessions.project_id',
    tenantRule: 'chat_sessions.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'chat_sessions', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['assistant.admin', 'assistant.use'],
  },
  {
    resource: 'commissioning_autosign_rules',
    table: 'commissioning_autosign_rules',
    capabilities: ['commissioning.approve'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'migration 016 declares the same explicit three-level `scope CHECK (scope IN (\'global\',\'client\',\'project\'))` with nullable `client_id`/`project_id`. A global autosign rule is a designed state, not an orphan.',
    scopeKey: 'commissioning_autosign_rules.project_id',
    tenantRule: 'commissioning_autosign_rules.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'commissioning_autosign_rules', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['commissioning.approve'],
  },
  {
    resource: 'commissioning_baselines',
    table: 'commissioning_baselines',
    capabilities: ['commissioning.approve'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'migration 019 declares `scope VARCHAR(16) NOT NULL CHECK (scope IN (\'global\',\'client\',\'project\'))` beside `client_id` and `project_id`, and its own constraint comment states that \'a global rule with NULL client_id/project_id has exactly one row\'. The schema names the global state explicitly.',
    scopeKey: 'commissioning_baselines.project_id',
    tenantRule: 'commissioning_baselines.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'commissioning_baselines', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['commissioning.approve'],
  },
  {
    resource: 'commissioning_items',
    table: 'commissioning_items',
    capabilities: ['commissioning.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'commissioning_items.project_id',
    tenantRule: 'commissioning_items.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'commissioning_items', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['commissioning.write'],
  },
  {
    resource: 'commissioning_packs',
    table: 'commissioning_packs',
    capabilities: ['commissioning.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'migration 006 declares the column `ON DELETE SET NULL`, and all three create routes — /uploads/text-ingest, /generate-draft, /packs/manual — guard with requireBodyProjectScope and validate only title and systemType, passing `projectId ?? null`.',
    scopeKey: 'commissioning_packs.project_id',
    tenantRule: 'commissioning_packs.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'commissioning_packs', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['commissioning.write'],
  },
  {
    resource: 'compliance_tasks',
    table: 'compliance_tasks',
    capabilities: ['safety.approve', 'safety.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'POST /compliance-tasks validates only title and due_date and passes `b[\'project_id\'] ?? null`. The list route selects `FROM compliance_tasks WHERE tenant_id = …` and returns project-less rows alongside project rows, so the collection contract already treats the resource as tenant-level.',
    scopeKey: 'compliance_tasks.project_id',
    tenantRule: 'compliance_tasks.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 4 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'compliance_tasks', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['safety.approve', 'safety.write'],
    approveCapabilities: ['safety.approve'],
  },
  {
    resource: 'coordination_recommendations',
    table: 'coordination_recommendations',
    capabilities: ['ai.govern'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'coordination_recommendations.project_id',
    tenantRule: 'coordination_recommendations.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'coordination_recommendations', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['ai.govern'],
  },
  {
    resource: 'cost_entries',
    table: 'cost_entries',
    capabilities: ['cost.approve', 'cost.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'cost_entries.project_id',
    tenantRule: 'cost_entries.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 4 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'cost_entries', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['cost.write'],
    approveCapabilities: ['cost.approve'],
  },
  {
    resource: 'daily_logs',
    table: 'daily_logs',
    capabilities: ['construction.approve', 'construction.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'daily_logs.project_id',
    tenantRule: 'daily_logs.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 4 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'daily_logs', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['construction.write'],
    approveCapabilities: ['construction.approve', 'construction.write'],
  },
  {
    resource: 'deficiencies',
    table: 'deficiencies',
    capabilities: ['quality.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'deficiencies.project_id',
    tenantRule: 'deficiencies.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'deficiencies', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['quality.write'],
  },
  {
    resource: 'document_versions',
    table: 'document_versions',
    capabilities: ['docs.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'Inherits the semantics of its FK parent: document_versions has no project column of its own and resolves through documents.project_id, so a version of a tenant-global document is itself tenant-global. Classifying it PROJECT_REQUIRED would make every `_global` document\'s versions unreachable while the document itself was readable.',
    scopeKey: 'document_versions.document_id → documents.project_id',
    tenantRule: 'document_versions.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: {
      kind: 'FK_PATH', table: 'document_versions', idColumn: 'id', tenantColumn: 'tenant_id',
      via: 'document_id', parentTable: 'documents', parentIdColumn: 'id', parentProjectColumn: 'project_id',
    },
    writeCapabilities: ['docs.write'],
  },
  {
    resource: 'document_folders',
    table: 'document_folders',
    capabilities: ['docs.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'ADR-014 Phase 3G. migration 003 declares `project_id UUID REFERENCES projects(id) ON DELETE CASCADE` — nullable, and CASCADE, so a project folder dies with its project while a project-less folder does not belong to one at all. files.ts:471 creates folders with `project_id ?? null`, and the same route is guarded by requireBodyProjectScope, which Phase 3D documents as treating the field as OPTIONAL on purpose and names `a tenant-level folder` as its example. A tenant-level folder is therefore a designed state, not an orphan — the same conclusion Phase 3E-R reached for the documents those folders hold.',
    scopeKey: 'document_folders.project_id',
    tenantRule: 'document_folders.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3G. docs.view is the capability files.ts already declares on the folder collection; Phase 3G decides where that existing authority applies, never who holds it.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'document_folders', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['docs.write'],
  },
  {
    resource: 'documents',
    table: 'documents',
    capabilities: ['docs.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'migration 003 declares `project_id UUID REFERENCES projects(id) ON DELETE SET NULL`, and files.ts:129 builds the storage key as `${tenantId}/${projectId ?? \'_global\'}/…` — a literal `_global` bucket for project-less documents. POST /files/request-upload and POST /files/folders both guard with requireBodyProjectScope, which Phase 3D documents as treating the field as OPTIONAL on purpose, naming \'a tenant-level folder\' as the example.',
    scopeKey: 'documents.project_id',
    tenantRule: 'documents.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'documents', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['docs.write'],
  },
  {
    resource: 'estimates',
    table: 'estimates',
    capabilities: ['cost.approve', 'engineering.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'POST /estimates validates only `name`; estimatingService.ts:264 passes `input.project_id ?? null`. The collection route is GET /estimates?project_id=… — project is a filter over a tenant-level set, not the set\'s boundary.',
    scopeKey: 'estimates.project_id',
    tenantRule: 'estimates.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'estimates', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['engineering.write'],
    approveCapabilities: ['cost.approve'],
  },
  {
    resource: 'evm_baselines',
    table: 'evm_baselines',
    capabilities: ['cost.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'evm_baselines.project_id',
    tenantRule: 'evm_baselines.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'evm_baselines', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['cost.write'],
  },
  {
    resource: 'knowledge_chunks',
    table: 'knowledge_chunks',
    capabilities: ['assistant.use'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'Inherits knowledge_sources through source_id. A chunk of a tenant-global source is tenant-global; refusing it would leave the corpus readable at source level and unreadable at chunk level.',
    scopeKey: 'knowledge_chunks.source_id → knowledge_sources.project_id',
    tenantRule: 'knowledge_chunks.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3E. `GET /ask/chunks/:id` names a chunk and returns its text alongside its source title and storage path, so the chunk is the record whose scope decides the read. assistant.use is the capability ask.ts already declares router-wide; Phase 3E decides where that existing authority applies, never who holds it. The FK hop matches schema-project-parent-map.json, which derives it from migration 022.',
    derivation: {
      kind: 'FK_PATH', table: 'knowledge_chunks', idColumn: 'id', tenantColumn: 'tenant_id',
      via: 'source_id', parentTable: 'knowledge_sources', parentIdColumn: 'id', parentProjectColumn: 'project_id',
    },
  },
  {
    resource: 'knowledge_fixes',
    table: 'knowledge_fixes',
    capabilities: ['assistant.admin', 'engineering.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'migration 021 declares the column nullable, and fixExtractor.ts:379 omits `project_id` from its INSERT column list altogether — every extracted fix is project-less. fixLibrary.ts:99 supplies one when a fix is raised against a project, so both states occur.',
    scopeKey: 'knowledge_fixes.project_id',
    tenantRule: 'knowledge_fixes.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 3 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'knowledge_fixes', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['assistant.admin', 'engineering.write'],
  },
  {
    resource: 'knowledge_sources',
    table: 'knowledge_sources',
    capabilities: ['assistant.use'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'migration 022 places `project_id` under the comment \'Classification tags used for retrieval filtering\', beside `tags` and `asset_system` — a retrieval discriminator, not an ownership boundary. knowledgeBulkIngest.ts:182 omits the column from its INSERT entirely, so every bulk-ingested source is project-less by construction.',
    scopeKey: 'knowledge_sources.project_id',
    tenantRule: 'knowledge_sources.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 4 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'knowledge_sources', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['assistant.use'],
  },
  {
    resource: 'meetings',
    table: 'meetings',
    capabilities: ['docs.publish', 'project.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'meetings.project_id',
    tenantRule: 'meetings.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 7 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'meetings', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['project.write'],
    approveCapabilities: ['docs.publish'],
  },
  {
    resource: 'monte_carlo_runs',
    table: 'monte_carlo_runs',
    capabilities: ['cost.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'POST /monte-carlo/runs guards with requireBodyProjectScope and the service passes `input.projectId ?? null`. Phase 3D\'s own note on that guard names \'a portfolio simulation\' as its example of a legitimately project-less record.',
    scopeKey: 'monte_carlo_runs.project_id',
    tenantRule: 'monte_carlo_runs.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3E. monteCarlo.ts binds this table from four routes and declares cost.view on every read; Phase 3E decides where that existing authority applies, never who holds it. Derivation matches schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'monte_carlo_runs', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['cost.write'],
  },
  {
    resource: 'pay_applications',
    table: 'pay_applications',
    capabilities: ['cost.approve', 'cost.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'pay_applications.project_id',
    tenantRule: 'pay_applications.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 3 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'pay_applications', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['cost.approve', 'cost.write'],
    approveCapabilities: ['cost.write'],
  },
  {
    resource: 'project_assignments',
    table: 'project_assignments',
    capabilities: ['team.approve'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'project_assignments.project_id',
    tenantRule: 'project_assignments.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'project_assignments', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['team.approve'],
  },
  {
    resource: 'purchase_orders',
    table: 'purchase_orders',
    capabilities: ['procurement.approve', 'procurement.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'purchase_orders.project_id',
    tenantRule: 'purchase_orders.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'purchase_orders', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['procurement.write'],
    approveCapabilities: ['procurement.approve'],
  },
  {
    resource: 'risks',
    table: 'risks',
    capabilities: ['risk.approve', 'risk.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'risks.project_id',
    tenantRule: 'risks.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'risks', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['risk.write'],
    approveCapabilities: ['risk.approve'],
  },
  {
    resource: 'contracts',
    table: 'contracts',
    capabilities: ['procurement.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'contracts.project_id',
    tenantRule: 'contracts.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3M. `contracts` (migration 002) is a VENDOR COMMITMENT — vendor_id NOT NULL, delivered on a project — and is not interchangeable with `projects`, which is the delivery entity, nor with `subcontracts` (migration 059), which is a different table with a different lifecycle enum. procurement.view is the capability its read surface declares; there are no write routes because the audit found no writer anywhere in the API.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'contracts', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['procurement.write'],
  },
  {
    resource: 'safety_exposure_hours',
    table: 'safety_exposure_hours',
    capabilities: ['safety.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'ADR-014 Phase 3L. Migration 087 declares `project_id UUID REFERENCES projects(id) ON DELETE CASCADE` — nullable, and the nullability is load-bearing rather than incidental: a NULL row measures the WHOLE TENANT for its period, which is the denominator the executive TRIR uses, while a non-null row measures that project. Both are designed states. The two levels are never summed together — a tenant rate reads tenant rows and a project rate reads that project\'s rows — because totalling project rows into a tenant figure would silently omit any project that never filed its hours, shrinking the denominator and overstating safety performance.',
    scopeKey: 'safety_exposure_hours.project_id',
    tenantRule: 'safety_exposure_hours.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3L. safety.view is the capability the reads already declare; writing project hours needs safety.write and writing TENANT hours needs safety.approve, because a tenant figure is the denominator of a published compliance metric.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'safety_exposure_hours', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['safety.write'],
  },
  {
    resource: 'safety_incidents',
    table: 'safety_incidents',
    capabilities: ['safety.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'safety_incidents.project_id',
    tenantRule: 'safety_incidents.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'safety_incidents', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['safety.write'],
  },
  {
    resource: 'safety_observations',
    table: 'safety_observations',
    capabilities: ['safety.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'safety_observations.project_id',
    tenantRule: 'safety_observations.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'safety_observations', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['safety.write'],
  },
  {
    resource: 'schedule_dependencies',
    table: 'schedule_dependencies',
    capabilities: ['schedule.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'schedule_dependencies.predecessor_id → schedule_tasks.project_id',
    tenantRule: 'schedule_dependencies.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: {
      kind: 'FK_PATH', table: 'schedule_dependencies', idColumn: 'id', tenantColumn: 'tenant_id',
      via: 'predecessor_id', parentTable: 'schedule_tasks', parentIdColumn: 'id', parentProjectColumn: 'project_id',
    },
    writeCapabilities: ['schedule.write'],
  },
  {
    resource: 'schedule_tasks',
    table: 'schedule_tasks',
    capabilities: ['schedule.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'schedule_tasks.project_id',
    tenantRule: 'schedule_tasks.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'schedule_tasks', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['schedule.write'],
  },
  {
    resource: 'sensor_alerts',
    table: 'sensor_alerts',
    capabilities: ['construction.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'sensor_alerts.sensor_id → sensors.project_id',
    tenantRule: 'sensor_alerts.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: {
      kind: 'FK_PATH', table: 'sensor_alerts', idColumn: 'id', tenantColumn: 'tenant_id',
      via: 'sensor_id', parentTable: 'sensors', parentIdColumn: 'id', parentProjectColumn: 'project_id',
    },
    writeCapabilities: ['construction.write'],
  },
  {
    resource: 'sensors',
    table: 'sensors',
    capabilities: ['construction.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'sensors.project_id',
    tenantRule: 'sensors.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'sensors', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['construction.write'],
  },
  {
    resource: 'source_uploads',
    table: 'source_uploads',
    capabilities: ['commissioning.view'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'ADR-014 Phase 3G. migration 006 declares `project_id UUID REFERENCES projects(id) ON DELETE SET NULL` — nullable, and SET NULL rather than CASCADE, so an upload OUTLIVES the project it was filed against. commissioning.ts:90 inserts `projectId ?? null`, so an upload staged before a project is chosen is an intended state. The same file creates commissioning_packs with `projectId ?? null`, and Phase 3E-R already classified packs DUAL_PROJECT_OR_TENANT on that evidence; uploads are the staging input to that same workflow.',
    scopeKey: 'source_uploads.project_id',
    tenantRule: 'source_uploads.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3G. commissioning.view is the capability commissioning.ts already declares on the uploads collection.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'source_uploads', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['commissioning.write'],
  },
  {
    resource: 'subcontract_invoices',
    table: 'subcontract_invoices',
    capabilities: ['procurement.approve', 'procurement.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'subcontract_invoices.subcontract_id → subcontracts.project_id',
    tenantRule: 'subcontract_invoices.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 3 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: {
      kind: 'FK_PATH', table: 'subcontract_invoices', idColumn: 'id', tenantColumn: 'tenant_id',
      via: 'subcontract_id', parentTable: 'subcontracts', parentIdColumn: 'id', parentProjectColumn: 'project_id',
    },
    approveCapabilities: ['procurement.approve', 'procurement.write'],
  },
  {
    resource: 'subcontracts',
    table: 'subcontracts',
    capabilities: ['procurement.approve', 'procurement.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'subcontracts.project_id',
    tenantRule: 'subcontracts.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'subcontracts', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['procurement.approve', 'procurement.write'],
  },
  {
    resource: 'subsystems',
    table: 'subsystems',
    capabilities: ['commissioning.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'subsystems.project_id',
    tenantRule: 'subsystems.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'subsystems', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['commissioning.write'],
  },
  {
    resource: 'systems',
    table: 'systems',
    capabilities: ['commissioning.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'systems.project_id',
    tenantRule: 'systems.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 3 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'systems', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['commissioning.write'],
  },
  {
    resource: 'tags',
    table: 'tags',
    capabilities: ['commissioning.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'tags.project_id',
    tenantRule: 'tags.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'tags', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['commissioning.write'],
  },
  {
    resource: 'test_packs',
    table: 'test_packs',
    capabilities: ['commissioning.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'test_packs.project_id',
    tenantRule: 'test_packs.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'test_packs', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['commissioning.write'],
  },
  {
    resource: 'test_results',
    table: 'test_results',
    capabilities: ['commissioning.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'test_results.project_id',
    tenantRule: 'test_results.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 1 route binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'test_results', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['commissioning.write'],
  },
  {
    resource: 'timesheets',
    table: 'timesheets',
    capabilities: ['team.approve', 'team.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'timesheets.project_id',
    tenantRule: 'timesheets.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 3 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'timesheets', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    approveCapabilities: ['team.approve', 'team.write'],
  },
  {
    resource: 'transmittals',
    table: 'transmittals',
    capabilities: ['docs.publish', 'docs.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'DUAL_PROJECT_OR_TENANT',
    projectParentMutation: 'IMMUTABLE',
    projectSemanticsEvidence:
      'POST /transmittals validates subject, purpose, from_party, to_party, to_contacts[] and items[] — not project. transmittalService.ts:82 passes `input.project_id ?? null`, and listTransmittals selects `FROM transmittals t WHERE tenant_id=$1` with project only as an optional filter.',
    scopeKey: 'transmittals.project_id',
    tenantRule: 'transmittals.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 3 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'transmittals', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['docs.publish', 'docs.write'],
    approveCapabilities: ['docs.publish'],
  },
  {
    resource: 'turnover_packages',
    table: 'turnover_packages',
    capabilities: ['commissioning.approve', 'docs.write'],
    strategy: 'PARENT_PROJECT',
    projectSemantics: 'PROJECT_REQUIRED',
    projectParentMutation: 'IMMUTABLE',
    scopeKey: 'turnover_packages.project_id',
    tenantRule: 'turnover_packages.tenant_id = app.current_tenant_id',
    reason: 'ADR-014 Phase 3D. Capabilities are the ones the 2 routes binding this table already declare — Phase 3D decides where an existing authority applies, never who holds it. Derivation matches migrations/schema-project-parent-map.json.',
    derivation: { kind: 'DIRECT_COLUMN', table: 'turnover_packages', idColumn: 'id', tenantColumn: 'tenant_id', projectColumn: 'project_id' },
    writeCapabilities: ['docs.write'],
    approveCapabilities: ['commissioning.approve'],
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

// ─── Phase 3B collection adoption (§42, §43) ─────────────────────────────────

/**
 * How far record scope has actually been adopted, per surface.
 *
 * Recorded so the Phase-3 counters are machine-derived rather than narrated,
 * and so a DEFERRED surface is visibly deferred rather than quietly missing.
 * `DEFERRED_PHASE3_SCOPE_MODEL` means the surface has no derivable project
 * parent — it must fail closed for that type, never fall back to tenant-wide.
 */
export type AdoptionStatus =
  | 'SCOPED'                        // record scope enforced
  | 'DEFERRED_PHASE3_SCOPE_MODEL'   // no derivable project parent yet
  | 'DEFERRED_NEXT_SLICE'           // derivable, simply not in this slice

export interface CollectionAdoption {
  surface:     string
  kind:        'PROJECT_DETAIL' | 'PROJECT_COLLECTION' | 'PROJECT_MEMBERSHIP'
             | 'DOMAIN_CHILD_COLLECTION' | 'DOMAIN_CHILD_DETAIL' | 'SELF_SCOPED' | 'CROSS_MODULE'
  capability:  string
  status:      AdoptionStatus
  reason:      string
}

export const COLLECTION_ADOPTION: readonly CollectionAdoption[] = [
  { surface: 'projects.ts GET /:id', kind: 'PROJECT_DETAIL', capability: 'project.view', status: 'SCOPED',
    reason: 'ADR-014 Phase 3A, migrated to the membership model by Phase 3B.' },
  { surface: 'projects.ts GET /', kind: 'PROJECT_COLLECTION', capability: 'project.view', status: 'SCOPED',
    reason: 'Membership-filtered in SQL, with the identical predicate on the COUNT so aggregates describe the authorized set. project.list.all selects the tenant-wide variant.' },
  { surface: 'projects.ts GET /:id/members', kind: 'PROJECT_MEMBERSHIP', capability: 'project.view', status: 'SCOPED',
    reason: 'Roster is project business data: visible to members, 404 to a same-tenant non-member.' },
  { surface: 'projects.ts POST /:id/members', kind: 'PROJECT_MEMBERSHIP', capability: 'project.members.manage', status: 'SCOPED',
    reason: 'Capability plus record scope; the scope half is what closes self-bootstrap.' },
  { surface: 'projects.ts DELETE /:id/members/:userId', kind: 'PROJECT_MEMBERSHIP', capability: 'project.members.manage', status: 'SCOPED',
    reason: 'Same two-dimension rule as the grant. Closes the manual source only.' },
  { surface: 'related.ts GET /related/:source/:id', kind: 'CROSS_MODULE', capability: 'per-resource (policy registry)', status: 'SCOPED',
    reason: 'ADR-014 Phase 3A: source authorized first, every target filtered independently.' },

  { surface: 'drawings.ts GET /projects/:projectId/drawings', kind: 'DOMAIN_CHILD_COLLECTION', capability: 'engineering.view', status: 'SCOPED', reason: 'requireProjectScope on the path project.' },
  { surface: 'inspections.ts GET /projects/:projectId/inspections', kind: 'DOMAIN_CHILD_COLLECTION', capability: 'quality.view', status: 'SCOPED', reason: 'requireProjectScope on the path project.' },
  { surface: 'ncr.ts GET /projects/:projectId/ncrs', kind: 'DOMAIN_CHILD_COLLECTION', capability: 'quality.view', status: 'SCOPED', reason: 'requireProjectScope on the path project.' },
  { surface: 'ncr.ts GET /projects/:projectId/ncr-summary', kind: 'DOMAIN_CHILD_COLLECTION', capability: 'quality.view', status: 'SCOPED', reason: 'Aggregate over the same rows; scoped identically so the summary cannot exceed the list.' },
  { surface: 'punchLists.ts GET /projects/:projectId/punch-lists', kind: 'DOMAIN_CHILD_COLLECTION', capability: 'quality.view', status: 'SCOPED', reason: 'requireProjectScope on the path project.' },
  { surface: 'changeOrders.ts GET /projects/:projectId/change-orders', kind: 'DOMAIN_CHILD_COLLECTION', capability: 'cost.view', status: 'SCOPED', reason: 'requireProjectScope; cost.view keeps it owner-only regardless of membership.' },
  { surface: 'changeOrders.ts GET /projects/:projectId/change-orders/summary', kind: 'DOMAIN_CHILD_COLLECTION', capability: 'cost.view', status: 'SCOPED', reason: 'Aggregate over the same rows, scoped identically.' },
  { surface: 'procurement.ts rfisRouter GET /', kind: 'DOMAIN_CHILD_COLLECTION', capability: 'construction.view', status: 'SCOPED',
    reason: 'Project is an optional FILTER here, so the membership predicate is applied in-query as the mandatory outer condition instead of as a path guard.' },
  { surface: 'procurement.ts submittalsRouter GET /', kind: 'DOMAIN_CHILD_COLLECTION', capability: 'construction.view', status: 'SCOPED',
    reason: 'Same query-filtered contract as the RFI collection.' },

  // Phase 3B deferred these three; Phase 3C closed them. The status is updated
  // here rather than left reading DEFERRED, because a registry that understates
  // adoption is as untruthful as one that overstates it.
  { surface: 'drawings.ts GET /drawings/:id', kind: 'DOMAIN_CHILD_DETAIL', capability: 'engineering.view', status: 'SCOPED',
    reason: 'ADR-014 Phase 3C: requireRecordScope(drawing) resolves drawings.project_id before the payload query.' },
  { surface: 'inspections.ts GET /inspections/:id', kind: 'DOMAIN_CHILD_DETAIL', capability: 'quality.view', status: 'SCOPED',
    reason: 'ADR-014 Phase 3C: requireRecordScope(inspection) on the same derivable parent.' },
  { surface: 'punchLists.ts GET /punch-lists/:id/items', kind: 'DOMAIN_CHILD_DETAIL', capability: 'quality.view', status: 'SCOPED',
    reason: 'ADR-014 Phase 3C: requireRecordScope(punchlist) on the parent list, which carries project_id.' },

  // ADR-014 Phase 3E — the direct-ID read surface. Per-endpoint dispositions
  // live in DIRECT_ID_ADOPTION below; these are the two that stay open, and
  // they stay open for a MODEL reason rather than a scheduling one.
  { surface: 'portfolio.ts GET /readiness/:scopeType/:scopeId', kind: 'DOMAIN_CHILD_DETAIL', capability: 'portfolio.view', status: 'DEFERRED_PHASE3_SCOPE_MODEL',
    reason: 'Keyed on operational_twins(entity_type, entity_id), a polymorphic pair the caller chooses, over a table with no foreign key to projects. Needs a per-entity-type scope policy before a guard can be correct.' },
  { surface: 'scenarios.ts GET /projection/:twinId', kind: 'DOMAIN_CHILD_DETAIL', capability: 'crossdomain.read', status: 'DEFERRED_PHASE3_SCOPE_MODEL',
    reason: 'Same operational_twins model gap, reached by twin id instead of by entity pair. Must be closed with the portfolio forecast.' },

  { surface: 'actions.ts (Personal Inbox)', kind: 'SELF_SCOPED', capability: 'personal.view / personal.admin', status: 'SCOPED',
    reason: 'ADR-014 Phase 2C-4A. Ownership, not project membership — deliberately NOT converted, because inheriting project scope would widen a closed personal surface.' },
]

// ─── Phase 3E direct-ID read adoption (ADR-014 Phase 3E §8, §9, §36) ─────────

/**
 * Why a direct-ID read is, or is not, record-scoped by Phase 3E.
 *
 * `PROTECT_PHASE3E`   the read now carries the canonical record-scope guard.
 * `SELF_SCOPED`       the surface already authorizes by OWNERSHIP, which is
 *                     strictly narrower than project membership. Converting it
 *                     would WIDEN a closed personal surface, so it is refused
 *                     on purpose (§29).
 * `NON_PROJECT_RESOURCE`
 *                     the record the caller names has no project parent in the
 *                     schema. The extractor's `primaryTable` heuristic named a
 *                     project-bound table reached further down the query; the
 *                     id in the path does not address it (§15, §30).
 * `DEFERRED_PHASE3_SCOPE_MODEL`
 *                     the record's project parent is not derivable from the
 *                     schema — it needs a policy decision, not a guard (§61).
 */
export type DirectIdDisposition =
  | 'PROTECT_PHASE3E'
  | 'SELF_SCOPED'
  | 'NON_PROJECT_RESOURCE'
  | 'DEFERRED_PHASE3_SCOPE_MODEL'

export interface DirectIdAdoption {
  /** `METHOD /path`, as the machine inventory keys it. */
  endpoint:    string
  /** The router variable the declaration hangs off — the §16 anchor. */
  router:      string
  /** The table the caller's id actually addresses, proved from the handler SQL. */
  recordTable: string
  /** The record-scope resource, or '' where none applies. */
  resource:    string
  disposition: DirectIdDisposition
  reason:      string
}

/**
 * Every project-bound direct-ID read the machine inventory found, with exactly
 * one disposition each. `DIRECT_ID_READ_UNEXPLAINED` must stay 0: a route with
 * no entry is a gap, not a pass.
 *
 * `recordTable` is stated separately from the extractor's `primaryTable`
 * because the two disagree on twelve routes. A sub-collection route such as
 * `GET /ncrs/:id/capas` reads `corrective_actions`, but the id in the path
 * addresses the parent `ncrs` row — scoping the child table would resolve the
 * parent of a record the caller never named, and refuse everyone. Each
 * `recordTable` below was read off the handler's own FROM/WHERE (§15).
 */
export const DIRECT_ID_ADOPTION: readonly DirectIdAdoption[] = [
  // ── SELF-scoped: ownership already decides, and it is narrower (§29) ───────
  { endpoint: 'GET /api/v1/actions/:id', router: 'actionsRouter', recordTable: 'actions', resource: 'action', disposition: 'SELF_SCOPED',
    reason: 'requireActionAccess admits only assigned_to_user_id = live principal, or personal.admin, and answers 404 before the handler runs. Project membership would let any member of the action’s project read another user’s queue.' },
  { endpoint: 'GET /api/v1/actions/:id/relationships', router: 'actionsRouter', recordTable: 'actions', resource: 'action', disposition: 'SELF_SCOPED',
    reason: 'Authorized against the parent action by requireActionAccess, not against the relation row. Same SELF rule as the action detail.' },
  { endpoint: 'GET /api/v1/actions/:id/timeline', router: 'actionsRouter', recordTable: 'actions', resource: 'action', disposition: 'SELF_SCOPED',
    reason: 'Authorized against the parent action by requireActionAccess. The extractor named action_events, which the timeline reads; the id addresses the action.' },
  { endpoint: 'GET /api/v1/ask/sessions/:id', router: 'router', recordTable: 'chat_sessions', resource: 'chat_sessions', disposition: 'SELF_SCOPED',
    reason: 'The session query carries AND user_id = $2, so a caller reaches only their own chat sessions. The extractor named chat_messages, which the same handler lists for the session it just failed or succeeded to own.' },

  // ── Non-project records: the id addresses tenant master data (§15, §30) ────
  { endpoint: 'GET /api/v1/vendors/:id', router: 'vendorsRouter', recordTable: 'vendors', resource: '', disposition: 'NON_PROJECT_RESOURCE',
    reason: 'vendors is NO_PROJECT_PARENT in schema-project-parent-map.json — a tenant vendor register, not a project child. Phase 3D made the same correction for the vendor mutations.' },
  { endpoint: 'GET /api/v1/team/members/:id', router: 'teamRouter', recordTable: 'team_members', resource: '', disposition: 'NON_PROJECT_RESOURCE',
    reason: 'getMember reads FROM team_members m WHERE m.id = $2. team_members is NO_PROJECT_PARENT: it is the HR/workforce roster recordScope.ts already rejected as an authorization source. The extractor named project_assignments, which the same statement LEFT JOINs only to count allocations.' },
  { endpoint: 'GET /api/v1/team/members/:id/assignments', router: 'teamRouter', recordTable: 'team_members', resource: '', disposition: 'NON_PROJECT_RESOURCE',
    reason: 'The id addresses a team_members row, which has no project parent. The ASSIGNMENTS it lists are project-bound, but filtering them is collection scope, not record scope — deferred with the other 51 collections (§31).' },
  { endpoint: 'GET /api/v1/team/members/:memberId/timesheets', router: 'timesheetsRouter', recordTable: 'team_members', resource: '', disposition: 'NON_PROJECT_RESOURCE',
    reason: 'Same shape: :memberId addresses a team_members row. listTimesheets filters by member, and the timesheets it returns are a project-bound COLLECTION, deferred to the collection slice (§31).' },

  // ── No derivable parent: needs a scope model, not a guard (§61) ────────────
  { endpoint: 'GET /api/v1/portfolio/readiness/:scopeType/:scopeId', router: 'router', recordTable: 'operational_twins', resource: '', disposition: 'DEFERRED_PHASE3_SCOPE_MODEL',
    reason: 'The caller chooses :scopeType, and _forecastReadiness looks the pair up as operational_twins(entity_type, entity_id). operational_twins is NO_PROJECT_PARENT: entity_id is a bare text column with no foreign key, spanning fourteen twin_entity_type values including vendor, site, region and workforce, several of which have no project at all. Resolving a parent needs a per-entity-type policy — a data-model decision, not a mechanical derivation.' },
  { endpoint: 'GET /api/v1/scenarios/projection/:twinId', router: 'router', recordTable: 'operational_twins', resource: '', disposition: 'DEFERRED_PHASE3_SCOPE_MODEL',
    reason: 'projectTwinTimeline keys on operational_twins.id, and that table reaches no project by any foreign key (migration 046). Same model gap as the portfolio forecast above; both must be closed together.' },

  // ── Closed by Phase 3E: capability + live project record scope ────────────
  { endpoint: 'GET /api/v1/agent-actions/:id', router: 'router', recordTable: 'agent_actions', resource: 'agent_actions', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/ask/chunks/:id', router: 'router', recordTable: 'knowledge_chunks', resource: 'knowledge_chunks', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/bid-packages/:id', router: 'subcontractsRouter', recordTable: 'bid_packages', resource: 'bid_packages', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/bid-packages/:id/submissions', router: 'subcontractsRouter', recordTable: 'bid_packages', resource: 'bid_packages', disposition: 'PROTECT_PHASE3E',
    reason: 'listBidSubmissions filters bid_submissions by the bid package in the path; the id addresses bid_packages. The sibling POST already scopes on bid_packages.' },
  { endpoint: 'GET /api/v1/bim-models/:id', router: 'router', recordTable: 'bim_models', resource: 'bim_models', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/bim-models/:id/viewer-token', router: 'router', recordTable: 'bim_models', resource: 'bim_models', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/budgets/:id/items', router: 'router', recordTable: 'budgets', resource: 'budgets', disposition: 'PROTECT_PHASE3E',
    reason: 'The handler reads budget_items WHERE budget_id=$1; the id addresses budgets. The sibling POST already scopes on budgets.' },
  { endpoint: 'GET /api/v1/calc-sessions/:id', router: 'router', recordTable: 'calc_sessions', resource: 'calc_sessions', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/change-orders/:id', router: 'changeOrdersRouter', recordTable: 'change_orders', resource: 'changeorder', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/change-orders/:id/tasks', router: 'changeOrdersRouter', recordTable: 'change_orders', resource: 'changeorder', disposition: 'PROTECT_PHASE3E',
    reason: 'change_order_tasks are listed for the change order in the path; the id addresses change_orders. The sibling POST already scopes on changeorder.' },
  { endpoint: 'GET /api/v1/commissioning/baselines/:id', router: 'router', recordTable: 'commissioning_baselines', resource: 'commissioning_baselines', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/commissioning/packs/:id', router: 'router', recordTable: 'commissioning_packs', resource: 'commissioning_packs', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/commissioning/packs/:id/download/:format', router: 'router', recordTable: 'commissioning_packs', resource: 'commissioning_packs', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/compliance-tasks/:id', router: 'router', recordTable: 'compliance_tasks', resource: 'compliance_tasks', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/cost-entries/:id', router: 'costEntryRouter', recordTable: 'cost_entries', resource: 'cost_entries', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/daily-logs/:id', router: 'router', recordTable: 'daily_logs', resource: 'daily_logs', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/estimates/:id', router: 'router', recordTable: 'estimates', resource: 'estimates', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/evm/baselines/:baselineId/wbs', router: 'evmRouter', recordTable: 'evm_baselines', resource: 'evm_baselines', disposition: 'PROTECT_PHASE3E',
    reason: 'listWbsEntries filters evm_wbs_entries by baseline; :baselineId addresses evm_baselines, so the guard names that param explicitly.' },
  { endpoint: 'GET /api/v1/files/documents/:id', router: 'router', recordTable: 'documents', resource: 'documents', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/files/presign/:versionId', router: 'router', recordTable: 'document_versions', resource: 'document_versions', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/knowledge-fixes/:id', router: 'router', recordTable: 'knowledge_fixes', resource: 'knowledge_fixes', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/knowledge/sources/:id', router: 'router', recordTable: 'knowledge_sources', resource: 'knowledge_sources', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/knowledge/sources/:id/chunks', router: 'router', recordTable: 'knowledge_sources', resource: 'knowledge_sources', disposition: 'PROTECT_PHASE3E',
    reason: 'The chunk list is filtered by source_id; the id addresses knowledge_sources, not the chunks it returns.' },
  { endpoint: 'GET /api/v1/meetings/:id', router: 'meetingsRouter', recordTable: 'meetings', resource: 'meetings', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/meetings/:id/actions', router: 'meetingsRouter', recordTable: 'meetings', resource: 'meetings', disposition: 'PROTECT_PHASE3E',
    reason: 'action_items are listed for the meeting in the path; the id addresses meetings.' },
  { endpoint: 'GET /api/v1/meetings/:id/agenda', router: 'meetingsRouter', recordTable: 'meetings', resource: 'meetings', disposition: 'PROTECT_PHASE3E',
    reason: 'meeting_agenda_items are listed for the meeting in the path; the id addresses meetings.' },
  { endpoint: 'GET /api/v1/monte-carlo/runs/:id', router: 'router', recordTable: 'monte_carlo_runs', resource: 'monte_carlo_runs', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/ncrs/:id/capas', router: 'router', recordTable: 'ncrs', resource: 'ncr', disposition: 'PROTECT_PHASE3E',
    reason: 'listCorrectiveActions reads corrective_actions WHERE ncr_id=$2; the id addresses ncrs. Scoping the child table would resolve the parent of a record the caller never named.' },
  { endpoint: 'GET /api/v1/pay-applications/:id', router: 'router', recordTable: 'pay_applications', resource: 'pay_applications', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/predict/projects/:id', router: 'predictRouter', recordTable: 'projects', resource: 'project', disposition: 'PROTECT_PHASE3E',
    reason: 'The id in the path IS the project, so scope is requireProjectScope(\'id\') rather than a parent lookup.' },
  { endpoint: 'GET /api/v1/projects/:id/summary', router: 'router', recordTable: 'projects', resource: 'project', disposition: 'PROTECT_PHASE3E',
    reason: 'The id in the path IS the project, so scope is requireProjectScope(\'id\') rather than a parent lookup.' },
  { endpoint: 'GET /api/v1/purchase-orders/:id', router: 'purchaseOrdersRouter', recordTable: 'purchase_orders', resource: 'purchase_orders', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/readiness/project/:id', router: 'readinessRouter', recordTable: 'projects', resource: 'project', disposition: 'PROTECT_PHASE3E',
    reason: 'The id in the path IS the project, so scope is requireProjectScope(\'id\') rather than a parent lookup.' },
  { endpoint: 'GET /api/v1/readiness/subsystem/:id', router: 'readinessRouter', recordTable: 'subsystems', resource: 'subsystems', disposition: 'PROTECT_PHASE3E',
    reason: 'The handler passes :id to computeReadiness as a subsystem; the extractor reached action_relations through _fetchEntityMetrics, one service level down. The id addresses subsystems.' },
  { endpoint: 'GET /api/v1/readiness/system/:id', router: 'readinessRouter', recordTable: 'systems', resource: 'systems', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/rfis/:id/copilot', router: 'router', recordTable: 'rfis', resource: 'rfi', disposition: 'PROTECT_PHASE3E',
    reason: 'buildRfiCopilot opens with SELECT … FROM rfis WHERE tenant_id=$1 AND id=$2; the extractor reached action_relations through the blocking-count subquery. The id addresses rfis.' },
  { endpoint: 'GET /api/v1/risks/:id', router: 'riskRegisterRouter', recordTable: 'risks', resource: 'risks', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/sensors/:id', router: 'authRouter', recordTable: 'sensors', resource: 'sensors', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/sensors/:id/readings', router: 'authRouter', recordTable: 'sensors', resource: 'sensors', disposition: 'PROTECT_PHASE3E',
    reason: 'sensor_readings are listed for the sensor in the path; the id addresses sensors.' },
  { endpoint: 'GET /api/v1/subcontracts/:id', router: 'subcontractsRouter', recordTable: 'subcontracts', resource: 'subcontracts', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/subcontracts/:id/invoices', router: 'subcontractsRouter', recordTable: 'subcontracts', resource: 'subcontracts', disposition: 'PROTECT_PHASE3E',
    reason: 'listInvoices reads subcontract_invoices WHERE subcontract_id=$2; the id addresses subcontracts. Note the capability here is cost.view, not the procurement.view of the parent detail route — Phase 3E adds record scope beside whichever authority the route already declares, and does not level them.' },
  { endpoint: 'GET /api/v1/submittals/:id/review', router: 'router', recordTable: 'submittals', resource: 'submittal', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/test-packs/:packId', router: 'testPacksRouter', recordTable: 'test_packs', resource: 'test_packs', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
  { endpoint: 'GET /api/v1/transmittals/:id', router: 'router', recordTable: 'transmittals', resource: 'transmittals', disposition: 'PROTECT_PHASE3E',
    reason: 'The id addresses this table directly, and the guard reuses the resource its own sibling mutations already declare.' },
]

// ─── Phase 3F collection adoption (ADR-014 Phase 3F §5, §58, §59) ────────────

/**
 * How a project-bound COLLECTION is authorized, or why it is not.
 *
 * A collection is in scope when it returns project-bound rows or an aggregate
 * over them — decided by what the query selects FROM, never by the path shape.
 * `GET /files/documents` names no project and is a project collection;
 * `GET /vendors` joins `projects` for a display name and is not.
 */
export type CollectionShape =
  /** The path names the project: `GET /projects/:projectId/x`. */
  | 'PATH_PROJECT_COLLECTION'
  /** No project in the path; the rows carry one. */
  | 'TENANT_COLLECTION_PROJECT_ROWS'

export type CollectionDisposition =
  | 'PROTECTED_PHASE3B'
  | 'PROTECTED_PHASE3F'
  | 'SELF_SCOPED_COLLECTION'
  | 'PROJECT_AGGREGATE'
  | 'DEFERRED_SCOPE_MODEL'

export interface CollectionScopeAdoption {
  endpoint:     string
  shape:        CollectionShape
  /** The table the query selects FROM — the rows the caller actually receives. */
  rows:         string
  capabilities: readonly string[]
  disposition:  CollectionDisposition
  reason:       string
}

/**
 * Every project-bound collection the machine inventory finds, with exactly one
 * disposition each. `COLLECTION_UNEXPLAINED` must stay 0: a collection with no
 * entry is a gap, not a pass.
 *
 * The candidate set is 108, not the 58 Phase 3E-R reported. The classifier had
 * no rule for a collection with NO path parameter whose rows reach a project,
 * so 49 of them fell into a `NO_PROJECT_PARENT` catch-all whose stated reason
 * — "none of them reaches a project" — was false for exactly those rows. Two
 * further extractor defects were fixed alongside it; both are pinned by the
 * Phase-3F ratchet.
 */
export const COLLECTION_SCOPE_ADOPTION: readonly CollectionScopeAdoption[] = [
  // ── ADR-014 Phase 3M — the contracts read surface ────────────────────────
  // Both collections apply the registry-driven predicate through
  // `collectionScopeSql` inside `contractService`, one level below the route.
  // The census reads route bodies and cannot see through that delegation, so
  // the inventory reports them unscoped; the predicate is nonetheless ANDed
  // outside any caller filter and before LIMIT, and `contracts.project_id` is
  // NOT NULL so every row has a project to test. The behaviour tests in
  // contractsDomain.test.ts assert the predicate on the emitted SQL.
  { endpoint: 'GET /api/v1/contracts', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'contracts', capabilities: ['procurement.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows. collectionScopeSql builds the predicate from the `contracts` policy (PROJECT_REQUIRED) inside contractService.listContracts; it is ANDed outside the caller\'s status/project filters and applied before LIMIT, so a filter can only narrow the authorized set. An unrecognised status is rejected 400 rather than dropped, because silently ignoring a filter returns every row to a caller who asked for one state.' },
  { endpoint: 'GET /api/v1/contracts/summary', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'contracts', capabilities: ['procurement.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'The dashboard aggregate. Same predicate, same registry, applied to the grouped COUNT so the totals describe the authorized set rather than the tenant. Reads `contracts` alone — never projects, purchase_orders or subcontracts — so a project cannot be counted as a vendor commitment.' },

  // ── ADR-014 Phase 3L — the TRIR surface ──────────────────────────────────
  // The two project-scoped reads carry requireProjectScope, the same guard
  // every other `/projects/:projectId/...` collection uses. The tenant rate has
  // no project in its path by design and restricts its numerator to the
  // caller's reachable projects via resolveProjectScope — the same resolver,
  // returning a set rather than one record's position.
  { endpoint: 'GET /api/v1/projects/:projectId/safety/exposure-hours', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'safety_exposure_hours', capabilities: ['safety.view'],
    disposition: 'PROTECTED_PHASE3B',
    reason: 'Project-path collection guarded by requireProjectScope; the query binds to the project in the path, and tenant-wide exposure rows (project_id IS NULL) are a different scope level that this route never returns.' },
  { endpoint: 'GET /api/v1/projects/:projectId/safety/trir', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'safety_incidents', capabilities: ['safety.view'],
    disposition: 'PROTECTED_PHASE3B',
    reason: 'Project-path aggregate guarded by requireProjectScope. Both halves of the rate are confined to the project in the path: incidents by project_id, exposure hours by the same, and the two scope levels are never mixed.' },
  { endpoint: 'GET /api/v1/safety/trir', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'safety_incidents', capabilities: ['safety.view'],
    disposition: 'PROTECTED_PHASE3B',
    reason: 'Tenant-level aggregate over project-bound rows. resolveProjectScope yields the caller\'s reachable project set and the numerator is restricted to it with `project_id = ANY(...)`; an Owner resolves to ALL_IN_TENANT and passes null, which the route distinguishes explicitly from an empty set so that "no memberships" can never read as "unrestricted".' },
  { endpoint: 'GET /api/v1/actions', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['personal.admin'],
    disposition: 'SELF_SCOPED_COLLECTION',
    reason: 'The `action` resource is SELF_SCOPED in the record-scope registry: ADR-014 Phase 2C-4A established an action as a PERSONAL record owned by its assignee. Filtering this collection by project membership would show a peer\'s queue to anyone sharing a project with them, which is why collectionScopeSql refuses to build a predicate for a SELF resource at all (§28).' },
  { endpoint: 'GET /api/v1/actions/analytics/overview', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['personal.admin'],
    disposition: 'SELF_SCOPED_COLLECTION',
    reason: 'The `action` resource is SELF_SCOPED in the record-scope registry: ADR-014 Phase 2C-4A established an action as a PERSONAL record owned by its assignee. Filtering this collection by project membership would show a peer\'s queue to anyone sharing a project with them, which is why collectionScopeSql refuses to build a predicate for a SELF resource at all (§28).' },
  { endpoint: 'GET /api/v1/actions/analytics/workload', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['personal.admin'],
    disposition: 'SELF_SCOPED_COLLECTION',
    reason: 'The `action` resource is SELF_SCOPED in the record-scope registry: ADR-014 Phase 2C-4A established an action as a PERSONAL record owned by its assignee. Filtering this collection by project membership would show a peer\'s queue to anyone sharing a project with them, which is why collectionScopeSql refuses to build a predicate for a SELF resource at all (§28).' },
  { endpoint: 'GET /api/v1/actions/my', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['personal.view'],
    disposition: 'SELF_SCOPED_COLLECTION',
    reason: 'The `action` resource is SELF_SCOPED in the record-scope registry: ADR-014 Phase 2C-4A established an action as a PERSONAL record owned by its assignee. Filtering this collection by project membership would show a peer\'s queue to anyone sharing a project with them, which is why collectionScopeSql refuses to build a predicate for a SELF resource at all (§28).' },
  { endpoint: 'GET /api/v1/actions/overdue', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['personal.admin'],
    disposition: 'SELF_SCOPED_COLLECTION',
    reason: 'The `action` resource is SELF_SCOPED in the record-scope registry: ADR-014 Phase 2C-4A established an action as a PERSONAL record owned by its assignee. Filtering this collection by project membership would show a peer\'s queue to anyone sharing a project with them, which is why collectionScopeSql refuses to build a predicate for a SELF resource at all (§28).' },
  { endpoint: 'GET /api/v1/actions/summary', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['personal.admin'],
    disposition: 'SELF_SCOPED_COLLECTION',
    reason: 'The `action` resource is SELF_SCOPED in the record-scope registry: ADR-014 Phase 2C-4A established an action as a PERSONAL record owned by its assignee. Filtering this collection by project membership would show a peer\'s queue to anyone sharing a project with them, which is why collectionScopeSql refuses to build a predicate for a SELF resource at all (§28).' },
  { endpoint: 'GET /api/v1/agent-actions', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'agent_actions', capabilities: ['crossdomain.read'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'The returned resource is DUAL_PROJECT_OR_TENANT, but every declared capability on this route is Owner-only and the Owner is tenant-wide, so the predicate is holder-neutral today (§70). It becomes load-bearing the moment the capability is granted more widely, which is what the ratchet pins.' },
  { endpoint: 'GET /api/v1/ask/sessions', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'chat_sessions', capabilities: ['assistant.use'],
    disposition: 'SELF_SCOPED_COLLECTION',
    reason: 'chat_sessions are listed for the calling user; the query carries the caller\'s own user_id, which is narrower than project membership and must not be replaced by it (§28).' },
  { endpoint: 'GET /api/v1/commissioning/autosign-rules', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'commissioning_autosign_rules', capabilities: ['commissioning.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/commissioning/baselines', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'commissioning_baselines', capabilities: ['commissioning.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/commissioning/packs', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'commissioning_packs', capabilities: ['commissioning.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/commissioning/uploads', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'source_uploads', capabilities: ['commissioning.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/compliance-tasks', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'compliance_tasks', capabilities: ['safety.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/copilot/coordination', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'projects', capabilities: ['assistant.use', 'construction.view', 'cost.view', 'engineering.view', 'project.view', 'schedule.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/copilot/focus', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'projects', capabilities: ['assistant.use', 'construction.view', 'cost.view', 'project.view', 'quality.view', 'risk.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/copilot/portfolio', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'projects', capabilities: ['portfolio.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/copilot/projects/:projectId/coordination', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['assistant.use', 'construction.view', 'cost.view', 'engineering.view', 'project.view', 'schedule.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/copilot/projects/:projectId/focus', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['assistant.use', 'construction.view', 'cost.view', 'project.view', 'quality.view', 'risk.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/copilot/projects/:projectId/narrative-report', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'n/a', capabilities: ['assistant.use', 'cost.view', 'project.view', 'quality.view', 'safety.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/copilot/projects/:projectId/report', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['assistant.use', 'cost.view', 'project.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/copilot/report', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'projects', capabilities: ['assistant.use', 'cost.view', 'project.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/estimates', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'estimates', capabilities: ['cost.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'The returned resource is DUAL_PROJECT_OR_TENANT, but every declared capability on this route is Owner-only and the Owner is tenant-wide, so the predicate is holder-neutral today (§70). It becomes load-bearing the moment the capability is granted more widely, which is what the ratchet pins.' },
  { endpoint: 'GET /api/v1/executive/contractor-performance', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['portfolio.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/executive/escalation-hotspots', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['portfolio.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/executive/overview', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['portfolio.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/executive/portfolio-risk', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'projects', capabilities: ['portfolio.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/executive/sla-compliance', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['portfolio.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/executive/throughput', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['portfolio.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/files/documents', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'documents', capabilities: ['docs.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/files/folders', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'document_folders', capabilities: ['docs.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/knowledge-fixes', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'knowledge_fixes', capabilities: ['engineering.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/knowledge-fixes/_meta/symptoms', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'knowledge_fixes', capabilities: ['engineering.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/knowledge/embed-status', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'knowledge_chunks', capabilities: ['assistant.use'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/knowledge/sources', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'knowledge_sources', capabilities: ['assistant.use'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/mcp/sessions', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'calc_sessions', capabilities: ['platform.admin'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/monte-carlo/runs', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'monte_carlo_runs', capabilities: ['cost.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'The returned resource is DUAL_PROJECT_OR_TENANT, but every declared capability on this route is Owner-only and the Owner is tenant-wide, so the predicate is holder-neutral today (§70). It becomes load-bearing the moment the capability is granted more widely, which is what the ratchet pins.' },
  { endpoint: 'GET /api/v1/ops/blockers', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['crossdomain.read'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/ops/escalations', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['crossdomain.read'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/ops/overview', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'action_relations', capabilities: ['crossdomain.read'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/ops/readiness', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'projects', capabilities: ['project.view', 'quality.view'],
    disposition: 'PROTECTED_PHASE3B',
    reason: 'Closed by ADR-014 Phase 3B, which pushed the membership predicate into the query itself so COUNT, LIMIT and OFFSET describe the authorized set. Enforced by projectScopeSql.' },
  { endpoint: 'GET /api/v1/ops/recommendations', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['crossdomain.read'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/portfolio/bottlenecks', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'actions', capabilities: ['portfolio.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/predict/portfolio', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'projects', capabilities: ['portfolio.view'],
    disposition: 'PROJECT_AGGREGATE',
    reason: 'Cross-project portfolio aggregate whose every declared capability is Owner-only, and the Owner is tenant-wide by project.list.all. Adding the membership predicate is therefore HOLDER-NEUTRAL today: it would change no caller\'s result, because the only caller who can reach the route already reaches every project in the tenant (§70). Recorded rather than applied so the claim is auditable instead of silently skipped.' },
  { endpoint: 'GET /api/v1/projects', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'projects', capabilities: ['project.view'],
    disposition: 'PROTECTED_PHASE3B',
    reason: 'Closed by ADR-014 Phase 3B, which pushed the membership predicate into the query itself so COUNT, LIMIT and OFFSET describe the authorized set. Enforced by projectScopeSql.' },
  { endpoint: 'GET /api/v1/projects/:projectId/bid-packages', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'bid_packages', capabilities: ['procurement.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/bid-packages/summary', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'subcontracts', capabilities: ['procurement.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/bim-issues', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'bim_issues', capabilities: ['engineering.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/bim-models', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'bim_models', capabilities: ['engineering.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/budget', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'budgets', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/budget/rollup', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'budget_rollup', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/calc-sessions', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'calc_sessions', capabilities: ['engineering.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/change-orders', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'change_orders', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/change-orders/summary', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'change_orders', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/commissioning-items', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'commissioning_items', capabilities: ['commissioning.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/commitments', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/coordination/recommendations', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'coordination_recommendations', capabilities: ['assistant.use', 'construction.view', 'cost.view', 'engineering.view', 'project.view', 'schedule.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/cost-control', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'evm_baselines', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/cost-entries', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'cost_entries', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/cost-entries/summary', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'cost_entries', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/cost-intelligence', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/coverage', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'tags', capabilities: ['commissioning.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/daily-logs', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'daily_logs', capabilities: ['construction.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/deficiencies', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'deficiencies', capabilities: ['quality.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/drawings', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'drawings', capabilities: ['engineering.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/evm/actuals', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'evm_actuals', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/evm/baselines', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'evm_baselines', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/evm/metrics', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'evm_wbs_entries', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/evm/scurve', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'evm_snapshots', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/field-assistant', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['assistant.use', 'project.view', 'quality.view', 'schedule.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/inspection-templates', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'inspection_templates', capabilities: ['quality.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/inspections', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'inspections', capabilities: ['quality.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/lifecycle', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['project.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/meetings', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'meetings', capabilities: ['project.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/ncr-summary', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['quality.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/ncrs', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'ncrs', capabilities: ['quality.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/nova-integration', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'nova_project_links', capabilities: ['project.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/pay-applications', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'pay_applications', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/procurement-risk', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['procurement.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/punch-lists', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'punch_lists', capabilities: ['quality.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/quality-intelligence', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['quality.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/risks', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'risks', capabilities: ['risk.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/risks/summary', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'risks', capabilities: ['risk.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/safety/incidents', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'safety_incidents', capabilities: ['safety.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/safety/intelligence', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['safety.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/safety/observations', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'safety_observations', capabilities: ['safety.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/schedule/imports', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'import_jobs', capabilities: ['schedule.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/sensors', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'sensors', capabilities: ['construction.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/sensors/alerts', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'sensor_alerts', capabilities: ['construction.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/sov-items', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'sov_items', capabilities: ['cost.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/subcontracts', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'subcontracts', capabilities: ['procurement.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/systems', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'systems', capabilities: ['commissioning.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/tags', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'tags', capabilities: ['commissioning.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/team', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'project_assignments', capabilities: ['team.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/test-packs', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'test_packs', capabilities: ['commissioning.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/timesheets', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'timesheets', capabilities: ['team.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/timesheets/summary', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'timesheets', capabilities: ['team.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/turnover-packages', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'turnover_packages', capabilities: ['docs.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/projects/:projectId/vendor-scorecard', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['procurement.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/purchase-orders', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'purchase_orders', capabilities: ['procurement.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/rfis', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'rfis', capabilities: ['construction.view'],
    disposition: 'PROTECTED_PHASE3B',
    reason: 'Closed by ADR-014 Phase 3B, which pushed the membership predicate into the query itself so COUNT, LIMIT and OFFSET describe the authorized set. Enforced by projectScopeSql.' },
  { endpoint: 'GET /api/v1/schedule/:projectId/cpm', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'schedule_tasks', capabilities: ['schedule.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/schedule/:projectId/critical-path', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'n/a', capabilities: ['schedule.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/schedule/:projectId/dependencies', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'schedule_dependencies', capabilities: ['schedule.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/schedule/:projectId/forecast', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'projects', capabilities: ['schedule.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/schedule/:projectId/tasks', shape: 'PATH_PROJECT_COLLECTION',
    rows: 'schedule_tasks', capabilities: ['schedule.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Project named in the path; requireProjectScope refuses before the handler, and the handler\'s own query already constrains rows to that project. Enforced by requireProjectScope.' },
  { endpoint: 'GET /api/v1/submittals', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'submittals', capabilities: ['construction.view'],
    disposition: 'PROTECTED_PHASE3B',
    reason: 'Closed by ADR-014 Phase 3B, which pushed the membership predicate into the query itself so COUNT, LIMIT and OFFSET describe the authorized set. Enforced by projectScopeSql.' },
  { endpoint: 'GET /api/v1/transmittals', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'transmittals', capabilities: ['docs.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
  { endpoint: 'GET /api/v1/transmittals/overdue', shape: 'TENANT_COLLECTION_PROJECT_ROWS',
    rows: 'transmittals', capabilities: ['docs.view'],
    disposition: 'PROTECTED_PHASE3F',
    reason: 'Tenant-level collection of project-bound rows; the registry-driven predicate is ANDed outside the caller\'s filters and before LIMIT, and the same predicate is applied to the COUNT. Enforced by collectionScopeSql.' },
]

// ─── Phase 3G: the unresolved collection data surfaces (§21, §22) ────────────

/**
 * A collection whose data target the extractor could not resolve, and what it
 * turned out to be.
 *
 * `UNRESOLVED_DATA_ACCESS` means the route's project relationship is UNKNOWN,
 * not absent — so each one is read by hand and given a verdict rather than
 * being allowed to sit outside every denominator. Phase 3F left thirteen.
 */
export type UnresolvedCollectionDisposition =
  | 'PROJECT_BOUND_COLLECTION'
  | 'SELF_SCOPED'
  | 'NON_PROJECT'
  | 'TENANT_GLOBAL'
  | 'SERVICE_OR_PLATFORM'
  | 'DEFERRED_SCOPE_MODEL'

export interface UnresolvedCollectionAudit {
  endpoint:    string
  capability:  string
  /** What the route actually returns, read from the handler and its service. */
  returns:     string
  disposition: UnresolvedCollectionDisposition
  reason:      string
}

/**
 * All thirteen, each traced to its handler and one service level down.
 * `COLLECTION_DATA_ACCESS_UNEXPLAINED` must stay 0.
 */
export const UNRESOLVED_COLLECTION_AUDIT: readonly UnresolvedCollectionAudit[] = [
  { endpoint: 'GET /api/v1/safety/exposure-hours', capability: 'safety.view',
    returns: 'safety_exposure_hours rows whose project_id IS NULL', disposition: 'TENANT_GLOBAL',
    reason: 'ADR-014 Phase 3L. The table resolved as unknown because the handler delegates to `listExposureHours` one level away. The rows are deliberately TENANT-scoped: a NULL project_id means the record measures the whole tenant for its period, which is the denominator the executive TRIR uses. This route returns only those rows — the `project_id IS NULL` predicate is in the service, not a caller filter — so it never discloses a project\'s hours, and the project-scoped sibling at /projects/:projectId/safety/exposure-hours carries requireProjectScope for those. The rows carry no project to scope against, and the tenant predicate is on the statement.' },

  { endpoint: 'GET /api/v1/agent-actions/_stats', capability: 'ai.govern',
    returns: 'five COUNT rollups over agent_actions', disposition: 'PROJECT_BOUND_COLLECTION',
    reason: 'RESOLVED AND CLOSED IN PHASE 3G. `stats()` issues five aggregates over agent_actions sharing one WHERE clause; the extractor could not resolve them because the service is reached through a renamed import (`stats as actionStats`). agent_actions is DUAL_PROJECT_OR_TENANT, and ai.govern reaches the platform administrator as well as the Owner — an administrator has no tenant-wide project scope, so this rollup was genuinely counting every project in the tenant for them. The predicate is applied to the shared WHERE, so all five aggregates move together.' },

  { endpoint: 'GET /api/v1/admin/automation/handlers', capability: 'platform.admin',
    returns: 'scheduler._handlers keys, in memory', disposition: 'SERVICE_OR_PLATFORM',
    reason: '`listRegisteredHandlers()` returns `Array.from(_handlers.keys())` — a code registry of scheduler handler names. No SQL is issued at all, which is why no table resolved. Nothing tenant- or project-owned is disclosed.' },
  { endpoint: 'GET /api/v1/agents', capability: 'ai.govern',
    returns: 'AGENT_REGISTRY, in memory', disposition: 'SERVICE_OR_PLATFORM',
    reason: '`getAllAgents()` returns `[...AGENT_REGISTRY]` — a static registration table compiled into the build. No SQL, no tenant data.' },
  { endpoint: 'GET /api/v1/agents/capabilities', capability: 'ai.govern',
    returns: '_byCapabilityId values, in memory', disposition: 'SERVICE_OR_PLATFORM',
    reason: '`getAllCapabilities()` returns `Array.from(_byCapabilityId.values())` — the same static registry, indexed differently.' },
  { endpoint: 'GET /api/v1/agents/objectives', capability: 'ai.govern',
    returns: 'a string list, in memory', disposition: 'SERVICE_OR_PLATFORM',
    reason: '`getAvailableObjectives()` returns a literal list of orchestrator objective names. No SQL.' },
  { endpoint: 'GET /api/v1/mcp/tools', capability: 'platform.admin',
    returns: 'the MCP tool registry, in memory', disposition: 'SERVICE_OR_PLATFORM',
    reason: 'The MCP tool catalogue is assembled in code from the handlers the build registers; the route serialises that list. No SQL is issued, so no tenant or project row can appear in the response, which is why no table resolved.' },
  { endpoint: 'GET /api/v1/mcp/ava/health', capability: 'platform.admin',
    returns: 'a liveness probe', disposition: 'SERVICE_OR_PLATFORM',
    reason: 'A liveness probe for the Ava MCP surface. It reports reachability and version only, issues no SQL, and returns no record of any kind — the absence of a resolved table is the correct answer here rather than an unknown.' },
  { endpoint: 'GET /api/v1/ecosystem/benchmarks/readiness', capability: 'platform.admin',
    returns: 'cross-tenant benchmark aggregates', disposition: 'SERVICE_OR_PLATFORM',
    reason: 'A platform-administration surface above tenant scope, which is why it holds platform.admin rather than a domain capability. Project membership is not the governing model for a route that is deliberately not tenant-bounded.' },
  { endpoint: 'GET /api/v1/ecosystem/benchmarks/tenant', capability: 'platform.admin',
    returns: 'one tenant benchmark row', disposition: 'SERVICE_OR_PLATFORM',
    reason: 'Same platform-administration surface, narrowed to a single tenant. No project-bound rows are returned.' },

  { endpoint: 'GET /api/v1/audit/_meta/actions', capability: 'audit.view',
    returns: 'the audit action enum', disposition: 'NON_PROJECT',
    reason: 'A constant list of permitted audit action names, used to populate a filter control. It describes the schema, not any record.' },
  { endpoint: 'GET /api/v1/commissioning/balance', capability: 'commissioning.view',
    returns: 'SUM(delta) over billing_credits', disposition: 'TENANT_GLOBAL',
    reason: '`_creditBalance()` sums `billing_credits WHERE tenant_id = $1`. billing_credits has no project column — a credit balance belongs to the tenant, not to a project — so there is nothing to scope and no cross-project disclosure.' },
  { endpoint: 'GET /api/v1/portfolio/conflicts', capability: 'portfolio.view',
    returns: 'timeline overlaps computed across projects', disposition: 'PROJECT_BOUND_COLLECTION',
    reason: 'HOLDER-NEUTRAL, not unscoped. `detectPortfolioConflicts` compares peak periods ACROSS projects, so it is project-bound by construction; portfolio.view is Owner-only and the Owner is tenant-wide, so a membership predicate would change no caller result today. Held to that claim by the holder-neutrality assertion, which fails if portfolio.view is ever granted more widely.' },

  { endpoint: 'GET /api/v1/ops/live-feed', capability: 'crossdomain.read',
    returns: 'realtime_event_log rows', disposition: 'DEFERRED_SCOPE_MODEL',
    reason: 'The event log carries `subscription_scope` plus a free-text `scope_id`, both chosen by the caller — a polymorphic pair with no foreign key to projects, structurally the same gap as operational_twins. Deriving a project parent needs a per-scope-kind policy, which is a data-model decision. crossdomain.read is Owner-only today, so nothing is presently exposed that the Owner could not already reach; the deferral is about the model, not the holder.' },
]

export interface UnresolvedCollectionCounters {
  total: number; resolvedProjectBound: number; platform: number
  tenantGlobal: number; nonProject: number; selfScoped: number
  deferred: number; unexplained: number
}

/** Machine-derived, so the report cannot overstate the reconciliation. */
export function unresolvedCollectionCounters(): UnresolvedCollectionCounters {
  const by = (d: UnresolvedCollectionDisposition): number =>
    UNRESOLVED_COLLECTION_AUDIT.filter(a => a.disposition === d).length
  return {
    total:                UNRESOLVED_COLLECTION_AUDIT.length,
    resolvedProjectBound: by('PROJECT_BOUND_COLLECTION'),
    platform:             by('SERVICE_OR_PLATFORM'),
    tenantGlobal:         by('TENANT_GLOBAL'),
    nonProject:           by('NON_PROJECT'),
    selfScoped:           by('SELF_SCOPED'),
    deferred:             by('DEFERRED_SCOPE_MODEL'),
    unexplained:          UNRESOLVED_COLLECTION_AUDIT.filter(a => a.reason.length < 80).length,
  }
}

export interface CollectionScopeCounters {
  candidates:   number
  protected_:   number
  selfScoped:   number
  aggregate:    number
  deferred:     number
  unexplained:  number
  byShape:      Record<string, number>
}

/** Machine-derived, so the completion report cannot overstate the closure. */
export function collectionScopeCounters(): CollectionScopeCounters {
  const by = (d: CollectionDisposition): number =>
    COLLECTION_SCOPE_ADOPTION.filter(a => a.disposition === d).length
  const byShape: Record<string, number> = {}
  for (const a of COLLECTION_SCOPE_ADOPTION) byShape[a.shape] = (byShape[a.shape] ?? 0) + 1
  return {
    candidates:  COLLECTION_SCOPE_ADOPTION.length,
    protected_:  by('PROTECTED_PHASE3B') + by('PROTECTED_PHASE3F'),
    selfScoped:  by('SELF_SCOPED_COLLECTION'),
    aggregate:   by('PROJECT_AGGREGATE'),
    deferred:    by('DEFERRED_SCOPE_MODEL'),
    unexplained: COLLECTION_SCOPE_ADOPTION.filter(a => a.reason.length < 80).length,
    byShape,
  }
}

export interface DirectIdCounters {
  candidates:  number
  protected_:  number
  selfScoped:  number
  nonProject:  number
  deferred:    number
  unexplained: number
}

/**
 * Machine-derived, so the completion report cannot overstate the closure.
 *
 * `unexplained` counts entries whose reason is too short to be an argument.
 * It is the same discipline `phase3Counters` applies: a disposition without a
 * defensible reason is a gap wearing a label.
 */
export function directIdCounters(): DirectIdCounters {
  const by = (d: DirectIdDisposition) => DIRECT_ID_ADOPTION.filter(a => a.disposition === d).length
  return {
    candidates:  DIRECT_ID_ADOPTION.length,
    protected_:  by('PROTECT_PHASE3E'),
    selfScoped:  by('SELF_SCOPED'),
    nonProject:  by('NON_PROJECT_RESOURCE'),
    deferred:    by('DEFERRED_PHASE3_SCOPE_MODEL'),
    unexplained: DIRECT_ID_ADOPTION.filter(a => a.reason.length < 60).length,
  }
}

export interface Phase3Counters {
  candidates: number
  protected_: number
  deferred: number
  unexplained: number
  byKind: Record<string, { scoped: number; deferred: number }>
}

/** Machine-derived, so the completion report cannot overstate adoption. */
export function phase3Counters(): Phase3Counters {
  const byKind: Record<string, { scoped: number; deferred: number }> = {}
  for (const a of COLLECTION_ADOPTION) {
    byKind[a.kind] ??= { scoped: 0, deferred: 0 }
    if (a.status === 'SCOPED') byKind[a.kind]!.scoped++
    else byKind[a.kind]!.deferred++
  }
  return {
    candidates:  COLLECTION_ADOPTION.length,
    protected_:  COLLECTION_ADOPTION.filter(a => a.status === 'SCOPED').length,
    deferred:    COLLECTION_ADOPTION.filter(a => a.status !== 'SCOPED').length,
    unexplained: COLLECTION_ADOPTION.filter(a => a.reason.length < 30).length,
    byKind,
  }
}
