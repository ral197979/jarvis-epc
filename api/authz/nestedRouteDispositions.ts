/**
 * Denver Engineering — nested / sub-collection route dispositions (ADR-014 Phase 3J)
 * ─────────────────────────────────────────────────────────────────────────────
 * A route whose path addresses a parent record and then does something beneath
 * it — `/resource/:parentId/children`, `/resource/:id/approve` — asks two
 * questions, and both must be answered (§15):
 *
 *     A. may this caller reach the PARENT named in the path?
 *     B. does the handler operate only on data belonging to that parent?
 *
 * A guard without query binding is half an answer; a bound query without a
 * guard is the other half. Phase 3I's finding is why this file exists: a
 * guarded route is no evidence at all about the route declared beside it.
 * `/coordination/recommendations/:id/dismiss` was record-scoped while
 * `/approve` — the more consequential half — was not, in the same router, four
 * lines apart.
 *
 * ─── D27: the parent id is an authorization boundary ─────────────────────────
 *
 * Unless the repository proves otherwise, a path parameter constrains both
 * authorization and data. It is never decoration.
 *
 * ─── D28: parent scope is the invariant, not the functional guard ────────────
 *
 * Siblings may legitimately differ in capability — reading tasks under a change
 * order is `cost.view`, approving it is `cost.approve`. What must NOT differ is
 * whether the parent is authorized at all.
 *
 * ─── D29: the stronger child scope wins ──────────────────────────────────────
 *
 * Where a child already has a narrower rule — SELF ownership, a polymorphic
 * policy — that rule stands. Nothing here weakens SELF to "same project" for
 * the sake of uniformity.
 *
 * This registry is keyed by FAMILY: the path prefix up to and including its
 * first dynamic segment. Every mounted nested route belongs to exactly one, and
 * the ratchet fails if a route appears that none covers.
 */

export type NestedDisposition =
  /** Parent authorized by a canonical guard, child query bound to that parent. */
  | 'PARENT_SCOPED_AND_BOUND'
  /** The child carries a narrower rule than its parent would impose (D29). */
  | 'CHILD_STRONGER_SCOPE'
  /** Authorized by live principal ownership, not by the parent. */
  | 'SELF_SCOPED'
  /** Parent resolved through the Phase-3H polymorphic registry. */
  | 'POLYMORPHIC_SCOPED'
  /** The path parent is context; the rows returned are tenant-level (D30). */
  | 'CONTEXT_ONLY_PARENT'
  /** The child genuinely belongs to the tenant, not to a project. */
  | 'TENANT_GLOBAL_CHILD'
  /** Platform-level administration, above any single tenant's business data. */
  | 'PLATFORM_GLOBAL'
  /** Machine/service ingress, authorized by its own credential. */
  | 'SERVICE_BOUNDARY'
  /** Parent authority is not derivable from source; fails closed. */
  | 'DEFERRED_SCOPE_MODEL'

export interface NestedFamily {
  /** Path prefix up to and including the first dynamic segment. */
  prefix:      string
  /** What the dynamic segment actually identifies — derived from source, not spelling (§12). */
  parent:      string
  disposition: NestedDisposition
  /** Why, argued from the repository. */
  evidence:    string
}

export const NESTED_ROUTE_FAMILIES: readonly NestedFamily[] = [
  // ─── Parent-scoped project children ────────────────────────────────────────
  // Each resolves its parent through the canonical record-scope registry, and
  // each child query binds to that parent. These are Phase 3C–3F's work and are
  // the positive controls for this sweep (§30).
  ...([
    ['/api/v1/agent-actions/:id',            'agent_actions'],
    ['/api/v1/bid-packages/:id',             'bid_packages'],
    ['/api/v1/bid-submissions/:id',          'bid_submissions'],
    ['/api/v1/bim-models/:id',               'bim_models'],
    ['/api/v1/bim-models/:modelId',          'bim_models'],
    ['/api/v1/budgets/:id',                  'budgets'],
    ['/api/v1/capas/:id',                    'corrective_actions'],
    ['/api/v1/change-orders/:id',            'change_orders'],
    ['/api/v1/commissioning/packs/:id',      'commissioning_packs'],
    ['/api/v1/compliance-tasks/:id',         'compliance_tasks'],
    ['/api/v1/coordination/recommendations/:id', 'coordination_recommendations'],
    ['/api/v1/copilot/projects/:projectId',  'projects'],
    ['/api/v1/cost-entries/:id',             'cost_entries'],
    ['/api/v1/daily-logs/:id',               'daily_logs'],
    ['/api/v1/drawings/:id',                 'drawings'],
    ['/api/v1/estimates/:id',                'estimates'],
    ['/api/v1/files/documents/:id',          'documents'],
    ['/api/v1/evm/baselines/:baselineId',    'evm_baselines'],
    ['/api/v1/inspections/:id',              'inspections'],
    ['/api/v1/knowledge-fixes/:id',          'knowledge_fixes'],
    ['/api/v1/knowledge/sources/:id',        'knowledge_sources'],
    ['/api/v1/meetings/:id',                 'meetings'],
    ['/api/v1/monte-carlo/runs/:id',         'monte_carlo_runs'],
    ['/api/v1/ncrs/:id',                     'ncrs'],
    ['/api/v1/pay-applications/:id',         'pay_applications'],
    ['/api/v1/projects/:id',                 'projects'],
    ['/api/v1/projects/:projectId',          'projects'],
    ['/api/v1/punch-items/:id',              'punch_items'],
    ['/api/v1/punch-lists/:id',              'punch_lists'],
    ['/api/v1/purchase-orders/:id',          'purchase_orders'],
    ['/api/v1/readiness/project/:id',        'projects'],
    ['/api/v1/rfis/:id',                     'rfis'],
    ['/api/v1/safety/incidents/:id',         'safety_incidents'],
    ['/api/v1/risks/:id',                    'risks'],
    ['/api/v1/sc-invoices/:id',              'subcontract_invoices'],
    ['/api/v1/schedule/:projectId',          'projects'],
    ['/api/v1/sensors/:id',                  'sensors'],
    ['/api/v1/sensors/alerts/:alertId',      'sensor_alerts'],
    ['/api/v1/subcontracts/:id',             'subcontracts'],
    ['/api/v1/submittals/:id',               'submittals'],
    ['/api/v1/systems/:systemId',            'systems'],
    ['/api/v1/team/assignments/:id',         'project_assignments'],
    ['/api/v1/timesheets/:id',               'timesheets'],
    ['/api/v1/transmittals/:id',             'transmittals'],
    ['/api/v1/turnover-packages/:id',        'turnover_packages'],
  ] as const).map(([prefix, parent]): NestedFamily => ({
    prefix, parent, disposition: 'PARENT_SCOPED_AND_BOUND',
    evidence: 'Parent resolved through the canonical record-scope registry; the child query binds to that parent id.',
  })),

  // ─── Accounting boundary (Phase 3O) ────────────────────────────────────────
  { prefix: '/api/v1/integrations/accounting/outbound/:type', parent: 'accounting_document_type',
    disposition: 'CONTEXT_ONLY_PARENT',
    evidence: 'The dynamic `:type` segment is not a record id — it selects which Denver resource backs the document (DOCUMENT_SOURCE_RESOURCE) and is validated against a closed set before use. Authorization is resolved against the RESOURCE it names, using authorizeRecordScope on the `:id` that follows, so the parent segment carries no authority of its own and cannot be used to reach anything.' },

  // ─── Member-keyed collections (Phase 3G) ───────────────────────────────────
  { prefix: '/api/v1/team/members/:id', parent: 'team_members', disposition: 'PARENT_SCOPED_AND_BOUND',
    evidence: 'Phase 3G member-keyed collection scope — collectionScopeSql binds rows to the caller’s reachable projects.' },
  { prefix: '/api/v1/team/members/:memberId', parent: 'team_members', disposition: 'PARENT_SCOPED_AND_BOUND',
    evidence: 'Phase 3G member-keyed collection scope; same predicate as the sibling above.' },

  // ─── Polymorphic (Phase 3H registry) ───────────────────────────────────────
  { prefix: '/api/v1/twins/:twinId', parent: 'operational_twins', disposition: 'POLYMORPHIC_SCOPED',
    evidence: 'ADR-014 Phase 3J. A twin row proves only that something was mirrored in this tenant; the authority belongs to the entity it mirrors. Phase 3H closed that on the scenarios router and this router — the canonical twin CRUD over the same table — was never in its route list. requireTwinScope now resolves entity_type/entity_id through the Phase-3H registry before any twin payload, snapshot, relationship or graph read.' },
  { prefix: '/api/v1/twins/entity/:entityType', parent: 'the entity named by (entityType, entityId)', disposition: 'POLYMORPHIC_SCOPED',
    evidence: 'ADR-014 Phase 3J. The caller chooses both halves of the selector, so it is authorized with requirePolymorphicScope against the same registry — the selector says what to authorize, never that authorization holds (D24).' },
  { prefix: '/api/v1/scenarios/temporal/:twinId', parent: 'operational_twins', disposition: 'POLYMORPHIC_SCOPED',
    evidence: 'Phase 3H closed at/replay/diff; Phase 3J closed velocity and trend, which read the same twin state through the same parent and had been left open beside three guarded siblings.' },
  { prefix: '/api/v1/portfolio/readiness/:scopeType', parent: 'the entity named by (scopeType, scopeId)', disposition: 'POLYMORPHIC_SCOPED',
    evidence: 'Phase 3H. requirePolymorphicScope precedes the forecast cache read and upsert.' },
  { prefix: '/api/v1/related/:source', parent: 'the polymorphic source record', disposition: 'POLYMORPHIC_SCOPED',
    evidence: 'authorizeSource + filterAuthorizedTargets — the cross-link surface authorizes the source and filters targets.' },

  // ─── SELF / stronger child scope (D29) ─────────────────────────────────────
  { prefix: '/api/v1/actions/:id', parent: 'actions', disposition: 'CHILD_STRONGER_SCOPE',
    evidence: 'Phase 2C-4A. Every handler calls requireActionAccess, which is personal ownership — strictly narrower than project membership. Deliberately NOT converted to record scope: a project peer must not reach another user’s action, its relationships, timeline, dependencies or SLA clock.' },
  { prefix: '/api/v1/notifications/:id', parent: 'notifications', disposition: 'SELF_SCOPED',
    evidence: 'Phase 2C-4B. markRead/dismiss receive the live principal’s user id and role and bind on it, so a caller can only act on their own inbox row.' },
  { prefix: '/api/v1/ask/sessions/:id', parent: 'ask_sessions', disposition: 'SELF_SCOPED',
    evidence: 'Assistant session thread, keyed to the requesting principal under assistant.use.' },

  // ─── Tenant-global children ────────────────────────────────────────────────
  { prefix: '/api/v1/proposals/:id', parent: 'proposals', disposition: 'TENANT_GLOBAL_CHILD',
    evidence: 'migration 062: proposals carries tenant_id and NO project_id — a proposal is pre-award CRM and precedes any project, so there is no project membership to require (§41). Phase 3J bound proposal_items to their parent proposal: PATCH/DELETE /proposals/:id/items/:itemId previously located the item by id and tenant alone and never read :id.' },
  { prefix: '/api/v1/vendors/:id', parent: 'vendors', disposition: 'TENANT_GLOBAL_CHILD',
    evidence: 'Phase 3D/3G: vendors are NO_PROJECT_PARENT tenant master data. Approval is tenant-wide under procurement.approve.' },
  { prefix: '/api/v1/portfolio/anomalies/:anomalyId', parent: 'operational_anomalies', disposition: 'TENANT_GLOBAL_CHILD',
    evidence: 'migration 046: operational_anomalies carries tenant_id and no project column; Phase 3D reclassified it as non-project-bound.' },
  { prefix: '/api/v1/scenarios/:scenarioId', parent: 'scenario_simulations', disposition: 'TENANT_GLOBAL_CHILD',
    evidence: 'migration 046: tenant_id, and only a NULLABLE base_snapshot_id toward the twin graph. Phase 3E-R settled that a nullable parent means what the resource says, so no twin parent is asserted. Holder-neutral today under crossdomain.* (Owner-only).' },
  { prefix: '/api/v1/simulation/:id', parent: 'scenario_simulations', disposition: 'TENANT_GLOBAL_CHILD',
    evidence: 'Same table and the same nullable-parent argument as /scenarios/:scenarioId.' },
  { prefix: '/api/v1/evidence/:id', parent: 'evidence_assets', disposition: 'TENANT_GLOBAL_CHILD',
    evidence: 'evidence_assets carries no project column; the surface is platform automation under platform.automation.' },
  { prefix: '/api/v1/evidence/assets/:id', parent: 'evidence_assets', disposition: 'TENANT_GLOBAL_CHILD',
    evidence: 'Same table as above; write half under crossdomain.write.' },
  { prefix: '/api/v1/evidence/entity/:type', parent: 'the polymorphic evidence subject', disposition: 'TENANT_GLOBAL_CHILD',
    evidence: 'Evidence lookup by entity kind; rows are tenant-scoped and holder-neutral under crossdomain.read.' },

  // ─── AI governance telemetry and queues (Phase 3I) ─────────────────────────
  ...([
    ['/api/v1/adaptive/anomaly-patterns/:anomalyId', 'anomaly_patterns'],
    ['/api/v1/adaptive/feedback/source/:sourceType', 'learning_feedback'],
    ['/api/v1/adaptive/forecast-accuracy/:id',       'forecast_accuracy'],
    ['/api/v1/adaptive/memory/:agentType',           'agent_memory'],
    ['/api/v1/adaptive/outcomes/:id',                'recommendation_outcomes'],
    ['/api/v1/agents/memory/:agentType',             'agent_memory'],
    ['/api/v1/agents/memory/:entryId',               'agent_memory'],
    ['/api/v1/agents/approvals/:id',                 'agent_approvals'],
    ['/api/v1/agents/readiness/plan/:scope',         'agent_tasks'],
    ['/api/v1/ai/recommendations/:id',               'ai_recommendation_queue'],
    ['/api/v1/optimization/proposals/:id',           'optimization_proposals'],
  ] as const).map(([prefix, parent]): NestedFamily => ({
    prefix, parent, disposition: 'TENANT_GLOBAL_CHILD',
    evidence: 'ADR-014 Phase 3I reconciled the ai.govern / crossdomain admission set. These tables carry tenant_id and no project column: they are AI model telemetry and governance queues, not project business records. The recommendation queue’s business columns are field-gated on crossdomain.read.',
  })),

  // ─── Platform administration ───────────────────────────────────────────────
  ...([
    ['/api/v1/admin/automation/background/:id',      'background_jobs'],
    ['/api/v1/admin/automation/mcp-tools/:name',     'mcp_tools'],
    ['/api/v1/ecosystem/adapters/:id',               'ecosystem_adapters'],
    ['/api/v1/ecosystem/edge-nodes/:id',             'edge_nodes'],
    ['/api/v1/ecosystem/external-agents/:id',        'external_agents'],
    ['/api/v1/ecosystem/federated/model-versions/:id','federated_model_versions'],
    ['/api/v1/ecosystem/marketplace/playbooks/:id',  'marketplace_playbooks'],
    ['/api/v1/ecosystem/plugins/:id',                'plugins'],
    ['/api/v1/ecosystem/workflows/:id',              'ecosystem_workflows'],
    ['/api/v1/enterprise/demo/:tenantId',            'tenants'],
    ['/api/v1/enterprise/tenants/:tenantId',         'tenants'],
    ['/api/v1/enterprise/tickets/:id',               'support_tickets'],
    ['/api/v1/exports/:id',                          'export_jobs'],
    ['/api/v1/integrations/:id',                     'integrations'],
    ['/api/v1/integrations/hub/:id',                 'integration_hub'],
    ['/api/v1/integrations/hub/jobs/:id',            'integration_hub_jobs'],
    ['/api/v1/runbooks/:id',                         'runbooks'],
    ['/api/v1/runbooks/executions/:execId',          'runbook_executions'],
    ['/api/v1/webhooks/:id',                         'webhooks'],
  ] as const).map(([prefix, parent]): NestedFamily => ({
    prefix, parent, disposition: 'PLATFORM_GLOBAL',
    evidence: 'Platform administration under platform.* — the control plane the platform administrator legitimately owns. No project business data is returned; Phase 3I confirmed admin holds no business-domain capability.',
  })),

  // ─── Service boundary ──────────────────────────────────────────────────────
  { prefix: '/api/v1/sensors/:uid', parent: 'sensors (by device uid)', disposition: 'SERVICE_BOUNDARY',
    evidence: 'IoT machine ingest. Phase 3D recorded this as device-credential ingress rather than a user-facing route; it carries no user capability by design.' },
]

/** Counters the ratchet and the audit report both read. */
export function nestedDispositionCounters(): Record<NestedDisposition | 'total', number> {
  const out = { total: NESTED_ROUTE_FAMILIES.length } as Record<string, number>
  for (const f of NESTED_ROUTE_FAMILIES) out[f.disposition] = (out[f.disposition] ?? 0) + 1
  return out as Record<NestedDisposition | 'total', number>
}
