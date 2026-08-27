/**
 * Denver Engineering — AI / cross-domain read policy (ADR-014 Phase 2B-3)
 * ─────────────────────────────────────────────────────────────────────────────
 * The rule this file exists to enforce:
 *
 *   Using AI, agents, copilots, simulations, digital twins or readiness
 *   engines must never grant a caller information they could not read directly
 *   through the underlying domain APIs.
 *
 * AI authority and data authority are two dimensions, not one:
 *
 *   assistant.use     may invoke end-user assistant functionality.
 *                     It grants NO source data — not cost, not engineering,
 *                     not procurement, not anything.
 *   <domain>.view     may read that domain. It does NOT imply permission to
 *                     invoke an assistant over it.
 *   ai.govern         may administer AI itself — the agent control plane, the
 *                     recommendation queue, model telemetry. It is NOT a
 *                     licence to read project or commercial records, which is
 *                     why a platform administrator holding it still reads no
 *                     delivery data.
 *
 * A domain-aware assistant read therefore requires BOTH, expressed as
 * `requireAllCapabilities(...)`. `requireAnyCapability` is never correct for a
 * combined output: it would hand the cost half of a briefing to an
 * engineering-only caller and the engineering half to a cost-only one.
 *
 * Where the source domains cannot be bounded
 * ──────────────────────────────────────────
 * Several payloads here are free-form JSONB whose provenance the schema does
 * not record — twin state captures, agent memory and execution output, the
 * realtime event log, optimisation proposals, recommendation before/after
 * snapshots. No conjunction of domain capabilities is truthful about them,
 * because what they contain is decided at write time. Those endpoints take
 * `crossdomain.read`: Owner-only, temporary, and superseded as soon as the
 * payloads carry source-domain provenance a retrieval filter can enforce.
 * That is ADR-014 Phase 3, and this gate does not claim it.
 *
 * SCOPE. Route-level authorization is not retrieval authorization. This file
 * controls who may CALL an endpoint. For an authorized caller, nothing here
 * filters which records or chunks the retriever behind it may see.
 */
import type { ServerCapability } from './capabilities'

export type AiReadCategory =
  /** Administration of AI itself — control plane, queues, model telemetry. */
  | 'AI_GOVERNANCE_READ'
  /** End-user assistant over one bounded domain. */
  | 'DOMAIN_AI_READ'
  /** Output spanning several domains, or a payload with no bounded provenance. */
  | 'CROSS_DOMAIN_AI_READ'
  /** Operational aggregate over named delivery domains. */
  | 'OPS_OR_READINESS_AGGREGATE'

export interface AiRead {
  file:      string
  router:    string
  method:    string
  path:      string
  category:  AiReadCategory
  /** EVERY capability the caller must hold. Conjunction, never "any of". */
  allOf:     readonly ServerCapability[]
  /** The information domains the response can disclose. `any` = unbounded. */
  sources:   readonly string[]
  /** Set when the endpoint relies on the temporary Owner-only fail-closed policy. */
  temporary?: boolean
  reason:    string
}

/** The temporary Owner-only capability, named once so tests can assert on it. */
export const TEMPORARY_CROSS_DOMAIN_CAPABILITY = 'crossdomain.read' as const

/** Every in-scope AI / cross-domain read, with its full capability requirement. */
export const AI_CROSS_DOMAIN_READS: readonly AiRead[] = [

  // ══ AI_GOVERNANCE_READ ════════════════════════════════════════
  //   ai.govern
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/anomaly-patterns',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Model-quality telemetry: learning signals, forecast error, drift and anomaly-pattern definitions. `forecast_accuracy_history` stores predicted/actual numerics and entity references for readiness/risk/workload/sla/maintenance forecasts — no schedule, cost or delivery record values.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/anomaly-patterns/:type',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Model-quality telemetry: learning signals, forecast error, drift and anomaly-pattern definitions. `forecast_accuracy_history` stores predicted/actual numerics and entity references for readiness/risk/workload/sla/maintenance forecasts — no schedule, cost or delivery record values.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/calibrate/drift/:type',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Model-quality telemetry: learning signals, forecast error, drift and anomaly-pattern definitions. `forecast_accuracy_history` stores predicted/actual numerics and entity references for readiness/risk/workload/sla/maintenance forecasts — no schedule, cost or delivery record values.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/feedback',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Model-quality telemetry: learning signals, forecast error, drift and anomaly-pattern definitions. `forecast_accuracy_history` stores predicted/actual numerics and entity references for readiness/risk/workload/sla/maintenance forecasts — no schedule, cost or delivery record values.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/feedback/health',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Model-quality telemetry: learning signals, forecast error, drift and anomaly-pattern definitions. `forecast_accuracy_history` stores predicted/actual numerics and entity references for readiness/risk/workload/sla/maintenance forecasts — no schedule, cost or delivery record values.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/feedback/signals/:type',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Model-quality telemetry: learning signals, forecast error, drift and anomaly-pattern definitions. `forecast_accuracy_history` stores predicted/actual numerics and entity references for readiness/risk/workload/sla/maintenance forecasts — no schedule, cost or delivery record values.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/feedback/source/:sourceType/:sourceId',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Model-quality telemetry: learning signals, forecast error, drift and anomaly-pattern definitions. `forecast_accuracy_history` stores predicted/actual numerics and entity references for readiness/risk/workload/sla/maintenance forecasts — no schedule, cost or delivery record values.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/forecast-accuracy',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Model-quality telemetry: learning signals, forecast error, drift and anomaly-pattern definitions. `forecast_accuracy_history` stores predicted/actual numerics and entity references for readiness/risk/workload/sla/maintenance forecasts — no schedule, cost or delivery record values.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/forecast-accuracy/stats/:type',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Model-quality telemetry: learning signals, forecast error, drift and anomaly-pattern definitions. `forecast_accuracy_history` stores predicted/actual numerics and entity references for readiness/risk/workload/sla/maintenance forecasts — no schedule, cost or delivery record values.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/simulation-outcomes/stats',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Model-quality telemetry: learning signals, forecast error, drift and anomaly-pattern definitions. `forecast_accuracy_history` stores predicted/actual numerics and entity references for readiness/risk/workload/sla/maintenance forecasts — no schedule, cost or delivery record values.',
  },
  {
    file: 'agentActionsRoutes.ts', router: 'router', method: 'GET', path: '/_stats',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Aggregate counts of agent activity. Counts only, with no business record payload.',
  },
  {
    file: 'agents.ts', router: 'agentsRouter', method: 'GET', path: '/',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Agent control plane — registry, declared capabilities and objectives. Configuration, not agent output.',
  },
  {
    file: 'agentApprovals.ts', router: 'agentApprovalsRouter', method: 'GET', path: '/',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Agent approval queue from `agent_approvals` — governance state deciding whether an agent may act.',
  },
  {
    file: 'agentApprovals.ts', router: 'agentApprovalsRouter', method: 'GET', path: '/:id',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Agent approval queue from `agent_approvals` — governance state deciding whether an agent may act.',
  },
  {
    file: 'agents.ts', router: 'agentsRouter', method: 'GET', path: '/capabilities',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Agent control plane — registry, declared capabilities and objectives. Configuration, not agent output.',
  },
  {
    file: 'agents.ts', router: 'agentsRouter', method: 'GET', path: '/objectives',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'Agent control plane — registry, declared capabilities and objectives. Configuration, not agent output.',
  },
  {
    file: 'aiGovernance.ts', router: 'aiGovernanceRouter', method: 'GET', path: '/recommendations',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'The AI recommendation queue: scores, category, status, reason and entity references. Its transitions already require ai.govern, so the read belongs with them.',
  },

  // ══ DOMAIN_AI_READ ════════════════════════════════════════════
  //   assistant.use AND construction.view
  {
    file: 'rfiCopilot.ts', router: 'router', method: 'GET', path: '/:id/copilot',
    category: 'DOMAIN_AI_READ', allOf: ['assistant.use', 'construction.view'],
    sources: ['construction'],
    reason: '`buildRfiCopilot` reads rfis and action_relations only — precedent, responder and impact within the RFI/construction domain.',
  },
  //   assistant.use AND project.view AND quality.view AND schedule.view
  {
    file: 'fieldAssistant.ts', router: 'router', method: 'GET', path: '/projects/:projectId/field-assistant',
    category: 'DOMAIN_AI_READ', allOf: ['assistant.use', 'project.view', 'quality.view', 'schedule.view'],
    sources: ['project', 'quality', 'schedule'],
    reason: 'Despite the name, `buildProjectFieldBriefing` reads inspections and punch items (quality) and schedule_dependencies — it touches no field-domain table. Classified by returned information, not by route name.',
  },

  // ══ CROSS_DOMAIN_AI_READ ══════════════════════════════════════
  //   assistant.use AND project.view AND construction.view AND engineering.view AND schedule.view AND cost.view
  {
    file: 'copilot.ts', router: 'router', method: 'GET', path: '/copilot/coordination',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['assistant.use', 'project.view', 'construction.view', 'engineering.view', 'schedule.view', 'cost.view'],
    sources: ['project', 'construction', 'engineering', 'schedule', 'cost'],
    reason: '`buildProjectCoordination` reads change_orders including cost_impact, bim_issues (engineering), rfis and submittals (construction) and schedule_dependencies.',
  },
  {
    file: 'copilot.ts', router: 'router', method: 'GET', path: '/copilot/projects/:projectId/coordination',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['assistant.use', 'project.view', 'construction.view', 'engineering.view', 'schedule.view', 'cost.view'],
    sources: ['project', 'construction', 'engineering', 'schedule', 'cost'],
    reason: '`buildProjectCoordination` reads change_orders including cost_impact, bim_issues (engineering), rfis and submittals (construction) and schedule_dependencies.',
  },
  {
    file: 'autoCoordination.ts', router: 'router', method: 'GET', path: '/projects/:projectId/coordination/recommendations',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['assistant.use', 'project.view', 'construction.view', 'engineering.view', 'schedule.view', 'cost.view'],
    sources: ['project', 'construction', 'engineering', 'schedule', 'cost'],
    reason: '`coordination_recommendations.source` is one of rfi, submittal, action, schedule, bim or change_order, and its category set includes commercial_gate — a statically bounded but genuinely cross-domain set.',
  },
  //   assistant.use AND project.view AND construction.view AND risk.view AND quality.view AND cost.view
  {
    file: 'copilot.ts', router: 'router', method: 'GET', path: '/copilot/focus',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['assistant.use', 'project.view', 'construction.view', 'risk.view', 'quality.view', 'cost.view'],
    sources: ['project', 'construction', 'risk', 'quality', 'cost'],
    reason: '`buildProjectFocus` selects budget, committed_cost, actual_cost and forecast_cost from projects, plus rfis and submittals (construction), risks, inspections and punch items (quality).',
  },
  {
    file: 'copilot.ts', router: 'router', method: 'GET', path: '/copilot/projects/:projectId/focus',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['assistant.use', 'project.view', 'construction.view', 'risk.view', 'quality.view', 'cost.view'],
    sources: ['project', 'construction', 'risk', 'quality', 'cost'],
    reason: '`buildProjectFocus` selects budget, committed_cost, actual_cost and forecast_cost from projects, plus rfis and submittals (construction), risks, inspections and punch items (quality).',
  },
  //   assistant.use AND project.view AND cost.view
  {
    file: 'copilot.ts', router: 'router', method: 'GET', path: '/copilot/projects/:projectId/report',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['assistant.use', 'project.view', 'cost.view'],
    sources: ['project', 'cost'],
    reason: '`buildProjectReport` computes budget, spend, forecast and cost variance, and labels a Budget tile.',
  },
  {
    file: 'copilot.ts', router: 'router', method: 'GET', path: '/copilot/report',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['assistant.use', 'project.view', 'cost.view'],
    sources: ['project', 'cost'],
    reason: '`buildProjectReport` computes budget, spend, forecast and cost variance, and labels a Budget tile.',
  },
  //   assistant.use AND project.view AND cost.view AND safety.view AND quality.view
  {
    file: 'copilot.ts', router: 'router', method: 'GET', path: '/copilot/projects/:projectId/narrative-report',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['assistant.use', 'project.view', 'cost.view', 'safety.view', 'quality.view'],
    sources: ['project', 'cost', 'safety', 'quality'],
    reason: '`buildNarrativeReport` composes the executive report (cost), cost intelligence, safety intelligence and the NCR summary.',
  },
  //   crossdomain.read
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/memory',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`agent_memory_entries.value` is free-form JSONB with no source-domain provenance column, so what a memory entry contains cannot be bounded. ADR-014 Phase 2B-3 §24.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/memory/:agentType/:scopeType/:key',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`agent_memory_entries.value` is free-form JSONB with no source-domain provenance column, so what a memory entry contains cannot be bounded. ADR-014 Phase 2B-3 §24.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/outcomes/effectiveness',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`recommendation_outcomes` stores `before_state` and `after_state` as free-form JSONB snapshots of whatever entity the recommendation touched, so the payload has no statically bounded source domain.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/outcomes/top',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`recommendation_outcomes` stores `before_state` and `after_state` as free-form JSONB snapshots of whatever entity the recommendation touched, so the payload has no statically bounded source domain.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/rank/top',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`recommendation_outcomes` stores `before_state` and `after_state` as free-form JSONB snapshots of whatever entity the recommendation touched, so the payload has no statically bounded source domain.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'GET', path: '/simulation-outcomes',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`recommendation_outcomes` stores `before_state` and `after_state` as free-form JSONB snapshots of whatever entity the recommendation touched, so the payload has no statically bounded source domain.',
  },
  {
    file: 'agentActionsRoutes.ts', router: 'router', method: 'GET', path: '/',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Agent action records reference the `actions` spine, whose `source_module` spans every module including change orders, so the set of domains disclosed is not statically bounded.',
  },
  {
    file: 'agentActionsRoutes.ts', router: 'router', method: 'GET', path: '/:id',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Agent action records reference the `actions` spine, whose `source_module` spans every module including change orders, so the set of domains disclosed is not statically bounded.',
  },
  {
    file: 'agents.ts', router: 'agentsRouter', method: 'GET', path: '/executions',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`agent_executions.input_snapshot` and `.output` are free-form JSONB carrying whatever the task read and produced — agent business output, not control plane.',
  },
  {
    file: 'agents.ts', router: 'agentsRouter', method: 'GET', path: '/executions/:id',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`agent_executions.input_snapshot` and `.output` are free-form JSONB carrying whatever the task read and produced — agent business output, not control plane.',
  },
  {
    file: 'agentMemory.ts', router: 'agentMemoryRouter', method: 'GET', path: '/',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`agent_memory_entries.value` is free-form JSONB with no source-domain provenance; memory scope spans project, workflow, action and global. ADR-014 Phase 2B-3 §24.',
  },
  {
    file: 'agentMemory.ts', router: 'agentMemoryRouter', method: 'GET', path: '/:agentType/:scopeType/:scopeId/:key',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`agent_memory_entries.value` is free-form JSONB with no source-domain provenance; memory scope spans project, workflow, action and global. ADR-014 Phase 2B-3 §24.',
  },
  {
    file: 'agentMemory.ts', router: 'agentMemoryRouter', method: 'GET', path: '/:entryId/links',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`agent_memory_entries.value` is free-form JSONB with no source-domain provenance; memory scope spans project, workflow, action and global. ADR-014 Phase 2B-3 §24.',
  },
  {
    file: 'agentReadiness.ts', router: 'agentReadinessRouter', method: 'GET', path: '/plan/:scope/:id',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Agent-generated readiness plan synthesised across whichever domains the agent consulted. ADR-014 Phase 2C-5 §19: this route used to enqueue a generate_readiness_plan task, so a read capability created durable work. It now reads the newest such task for the scope and enqueues nothing; the orchestrator (POST /agents/readiness/coordinate, ai.govern) remains the creation path.',
  },
  {
    file: 'agentRisk.ts', router: 'agentRiskRouter', method: 'GET', path: '/overview',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Risk-agent synthesis across the tenant, distinct from the project risk register. ADR-014 Phase 2C-5 §19: this route used to enqueue an analyze_risk task, so a read capability created durable work. It now reads the newest such task for the scope; POST /agents/risk/analyze (crossdomain.write) remains the creation path.',
  },
  {
    file: 'agents.ts', router: 'agentsRouter', method: 'GET', path: '/tasks',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`agent_executions.input_snapshot` and `.output` are free-form JSONB carrying whatever the task read and produced — agent business output, not control plane.',
  },
  {
    file: 'agents.ts', router: 'agentsRouter', method: 'GET', path: '/tasks/:id',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`agent_executions.input_snapshot` and `.output` are free-form JSONB carrying whatever the task read and produced — agent business output, not control plane.',
  },
  {
    file: 'aiGovernance.ts', router: 'aiGovernanceRouter', method: 'GET', path: '/recommendations/:id/preview',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`preview_data` is free-form JSONB projected outcome data — the projected change to whichever records the recommendation would touch. ai.govern alone would disclose business state (§15).',
  },
  {
    file: 'evidence.ts', router: 'evidenceRouter', method: 'GET', path: '/:id',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`evidence_links.entity_type` is an open string — action, inspection, punch_item, asset and others — so the domain of an evidence asset follows whatever it was linked to. ADR-014 Phase 2B-3 §32.',
  },
  {
    file: 'evidence.ts', router: 'evidenceRouter', method: 'GET', path: '/entity/:type/:id',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`evidence_links.entity_type` is an open string — action, inspection, punch_item, asset and others — so the domain of an evidence asset follows whatever it was linked to. ADR-014 Phase 2B-3 §32.',
  },
  {
    file: 'ops.ts', router: 'opsRouter', method: 'GET', path: '/blockers',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'The `actions` spine carries `source_module` across every module including change orders, and `/live-feed` streams `realtime_event_log.payload` verbatim. Neither has a statically bounded domain set. Deliberately NOT platform.admin: these are delivery data, and ADR-014 forbids handing them to a platform administrator.',
  },
  {
    file: 'ops.ts', router: 'opsRouter', method: 'GET', path: '/escalations',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'The `actions` spine carries `source_module` across every module including change orders, and `/live-feed` streams `realtime_event_log.payload` verbatim. Neither has a statically bounded domain set. Deliberately NOT platform.admin: these are delivery data, and ADR-014 forbids handing them to a platform administrator.',
  },
  {
    file: 'ops.ts', router: 'opsRouter', method: 'GET', path: '/live-feed',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'The `actions` spine carries `source_module` across every module including change orders, and `/live-feed` streams `realtime_event_log.payload` verbatim. Neither has a statically bounded domain set. Deliberately NOT platform.admin: these are delivery data, and ADR-014 forbids handing them to a platform administrator.',
  },
  {
    file: 'ops.ts', router: 'opsRouter', method: 'GET', path: '/overview',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'The `actions` spine carries `source_module` across every module including change orders, and `/live-feed` streams `realtime_event_log.payload` verbatim. Neither has a statically bounded domain set. Deliberately NOT platform.admin: these are delivery data, and ADR-014 forbids handing them to a platform administrator.',
  },
  {
    file: 'ops.ts', router: 'opsRouter', method: 'GET', path: '/recommendations',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'The `actions` spine carries `source_module` across every module including change orders, and `/live-feed` streams `realtime_event_log.payload` verbatim. Neither has a statically bounded domain set. Deliberately NOT platform.admin: these are delivery data, and ADR-014 forbids handing them to a platform administrator.',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'GET', path: '/proposals',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`optimization_feedback.proposal` is free-form JSONB spanning resource, workload, scheduling, risk and capacity optimisation over twin state. A project manager’s team.view must not yield cost optimisation output (§33).',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'GET', path: '/proposals/summary',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`optimization_feedback.proposal` is free-form JSONB spanning resource, workload, scheduling, risk and capacity optimisation over twin state. A project manager’s team.view must not yield cost optimisation output (§33).',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'GET', path: '/resources',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`optimization_feedback.proposal` is free-form JSONB spanning resource, workload, scheduling, risk and capacity optimisation over twin state. A project manager’s team.view must not yield cost optimisation output (§33).',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'GET', path: '/resources/balance-plan',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`optimization_feedback.proposal` is free-form JSONB spanning resource, workload, scheduling, risk and capacity optimisation over twin state. A project manager’s team.view must not yield cost optimisation output (§33).',
  },
  {
    file: 'scenarios.ts', router: 'router', method: 'GET', path: '/',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Scenario simulation and temporal replay read `twin_state_snapshots.state` directly, inheriting the twin block’s unbounded payload. ADR-014 Phase 2B-3 §29.',
  },
  {
    file: 'scenarios.ts', router: 'router', method: 'GET', path: '/:scenarioId',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Scenario simulation and temporal replay read `twin_state_snapshots.state` directly, inheriting the twin block’s unbounded payload. ADR-014 Phase 2B-3 §29.',
  },
  {
    file: 'scenarios.ts', router: 'router', method: 'GET', path: '/projection/:twinId',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Scenario simulation and temporal replay read `twin_state_snapshots.state` directly, inheriting the twin block’s unbounded payload. ADR-014 Phase 2B-3 §29.',
  },
  {
    file: 'scenarios.ts', router: 'router', method: 'GET', path: '/temporal/:twinId/at',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Scenario simulation and temporal replay read `twin_state_snapshots.state` directly, inheriting the twin block’s unbounded payload. ADR-014 Phase 2B-3 §29.',
  },
  {
    file: 'scenarios.ts', router: 'router', method: 'GET', path: '/temporal/:twinId/diff',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Scenario simulation and temporal replay read `twin_state_snapshots.state` directly, inheriting the twin block’s unbounded payload. ADR-014 Phase 2B-3 §29.',
  },
  {
    file: 'scenarios.ts', router: 'router', method: 'GET', path: '/temporal/:twinId/replay',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Scenario simulation and temporal replay read `twin_state_snapshots.state` directly, inheriting the twin block’s unbounded payload. ADR-014 Phase 2B-3 §29.',
  },
  {
    file: 'scenarios.ts', router: 'router', method: 'GET', path: '/temporal/:twinId/trend/:field',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Scenario simulation and temporal replay read `twin_state_snapshots.state` directly, inheriting the twin block’s unbounded payload. ADR-014 Phase 2B-3 §29.',
  },
  {
    file: 'scenarios.ts', router: 'router', method: 'GET', path: '/temporal/:twinId/velocity',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'Scenario simulation and temporal replay read `twin_state_snapshots.state` directly, inheriting the twin block’s unbounded payload. ADR-014 Phase 2B-3 §29.',
  },
  {
    file: 'simulation.ts', router: 'simulationRouter', method: 'GET', path: '/',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'The replay engine reads `realtime_event_log.payload` — free-form JSONB for every event type published in the tenant.',
  },
  {
    file: 'simulation.ts', router: 'simulationRouter', method: 'GET', path: '/:id/results',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: 'The replay engine reads `realtime_event_log.payload` — free-form JSONB for every event type published in the tenant.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/:twinId',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/:twinId/impact',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/:twinId/relationships',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/:twinId/risk-propagation',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/:twinId/snapshots',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/:twinId/snapshots/:snapshotId',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/:twinId/snapshots/latest',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/:twinId/state',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },
  // `twin.ts PATCH /:twinId/status` was registered here as a CROSS_DOMAIN_AI_READ.
  // It is not a read: the handler calls `updateTwinStatus`, which runs
  // `UPDATE operational_twins SET status = $3, updated_at = now()`. ADR-014
  // Phase 2C-5 §17 moved it to `crossdomain.write` and re-registered it in
  // `AI_CROSS_DOMAIN_MUTATIONS` as a CROSS_DOMAIN_MUTATION. Removed from this
  // registry rather than left behind, because the perimeter test asserts that the
  // set of routes using `crossdomain.read` equals the set listed here as temporary.
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/:twinId/traverse',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/entity/:entityType/:entityId',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },
  {
    file: 'twin.ts', router: 'router', method: 'GET', path: '/graph/overview',
    category: 'CROSS_DOMAIN_AI_READ', allOf: ['crossdomain.read'],
    sources: ['any'],
    temporary: true,
    reason: '`twin_entity_type` spans project, system, subsystem, equipment, tag, workflow, action, inspection, deficiency, permit, vendor, workforce, site and region, and `twin_state_snapshots.state` is an unbounded "full state capture" JSONB. No capability filter exists over twin content. ADR-014 Phase 2B-3 §20C, §27.',
  },

  // ══ OPS_OR_READINESS_AGGREGATE ════════════════════════════════
  //   commissioning.view AND quality.view
  {
    file: 'readiness.ts', router: 'readinessRouter', method: 'GET', path: '/subsystem/:id',
    category: 'OPS_OR_READINESS_AGGREGATE', allOf: ['commissioning.view', 'quality.view'],
    sources: ['commissioning', 'quality'],
    reason: 'System and subsystem readiness: the entity is a commissioning system, and the score is computed from inspection and action state.',
  },
  {
    file: 'readiness.ts', router: 'readinessRouter', method: 'GET', path: '/system/:id',
    category: 'OPS_OR_READINESS_AGGREGATE', allOf: ['commissioning.view', 'quality.view'],
    sources: ['commissioning', 'quality'],
    reason: 'System and subsystem readiness: the entity is a commissioning system, and the score is computed from inspection and action state.',
  },
  //   project.view AND quality.view
  {
    file: 'ops.ts', router: 'opsRouter', method: 'GET', path: '/readiness',
    category: 'OPS_OR_READINESS_AGGREGATE', allOf: ['project.view', 'quality.view'],
    sources: ['project', 'quality'],
    reason: '`computeReadiness` aggregates actions, inspections and readiness thresholds against the project list.',
  },
  {
    file: 'readiness.ts', router: 'readinessRouter', method: 'GET', path: '/overview',
    category: 'OPS_OR_READINESS_AGGREGATE', allOf: ['project.view', 'quality.view'],
    sources: ['project', 'quality'],
    reason: 'Project readiness scores computed from actions, inspections and readiness thresholds.',
  },
  {
    file: 'readiness.ts', router: 'readinessRouter', method: 'GET', path: '/project/:id',
    category: 'OPS_OR_READINESS_AGGREGATE', allOf: ['project.view', 'quality.view'],
    sources: ['project', 'quality'],
    reason: 'Project readiness scores computed from actions, inspections and readiness thresholds.',
  },
  {
    file: 'readiness.ts', router: 'readinessRouter', method: 'GET', path: '/project/:id/history',
    category: 'OPS_OR_READINESS_AGGREGATE', allOf: ['project.view', 'quality.view'],
    sources: ['project', 'quality'],
    reason: 'Project readiness scores computed from actions, inspections and readiness thresholds.',
  },

  // ══ added by ADR-014 Phase 2C-2 ═══════════════════════════════
  // A POST that is a read. The high-sensitivity mutation sweep surfaced it as an
  // unprotected mutation; inspection shows findCorrelates issues no write, and
  // the verb is POST only because the subject payload is nested. It belongs to
  // this gate's policy, not to Phase 2C-2's mutation registry.
  {
    file: 'correlations.ts', router: 'router', method: 'POST', path: '/',
    category: 'CROSS_DOMAIN_AI_READ', allOf: [TEMPORARY_CROSS_DOMAIN_CAPABILITY],
    sources: ['any'],
    temporary: true,
    reason: 'Ranks events proximate to a caller-supplied subject across audit_log, daily_logs, action_items, compliance_tasks and commissioning_packs. The audit trail alone puts it past any delivery capability, and the domain set is decided by what happened near the subject rather than at authorization time — so no conjunction of domain capabilities is truthful. ADR-014 Phase 2B-3 §24.',
  },

  // ══ added by ADR-014 Phase 2C-3 ═══════════════════════════════
  // Seven more POSTs that are reads. The AI / cross-domain mutation sweep
  // reported all seven as unprotected mutations because the backlog is derived
  // partly from HTTP method; inspection of each service shows no INSERT, UPDATE,
  // DELETE or durable job anywhere in the call graph. They are registered here,
  // under this gate's policy, rather than left in the mutation registry to keep
  // a count intact. `api/authz/aiCrossDomainMutations.ts` records the same seven
  // as CLASSIFICATION_CORRECTION_READ so the arithmetic reconciles from either
  // side.
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/calibrate',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'calibratePrediction reads getAccuracyStats and returns a bias-adjusted number; forecastCalibrationEngine.ts contains no write. Forecast accuracy is model-quality telemetry, not business data — its sibling GET /calibrate/drift/:type is already ai.govern. ADR-014 Phase 2C-3 §6.',
  },
  {
    file: 'adaptive.ts', router: 'router', method: 'POST', path: '/rank',
    category: 'CROSS_DOMAIN_AI_READ', allOf: [TEMPORARY_CROSS_DOMAIN_CAPABILITY],
    sources: ['any'],
    temporary: true,
    reason: 'rankRecommendations scores the candidates supplied in the body against getAgentEffectiveness; recommendationRankingEngine.ts contains no write. The historical effectiveness it reads spans whatever entities the recommendations touched, which is why GET /rank/top is crossdomain.read. ADR-014 Phase 2C-3 §6.',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'POST', path: '/strategy',
    category: 'CROSS_DOMAIN_AI_READ', allOf: [TEMPORARY_CROSS_DOMAIN_CAPABILITY],
    sources: ['any'],
    temporary: true,
    reason: 'generateStrategyPlan SELECTs operational_twins, operational_anomalies and optimization_feedback and returns a plan; operationalStrategyPlanner.ts contains no INSERT, UPDATE or DELETE. Twin entity types span every domain, so provenance is unbounded. ADR-014 Phase 2C-3 §6.',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'POST', path: '/consensus',
    category: 'CROSS_DOMAIN_AI_READ', allOf: [TEMPORARY_CROSS_DOMAIN_CAPABILITY],
    sources: ['any'],
    temporary: true,
    reason: 'buildConsensus reconciles the votes supplied in the body against historical effectiveness. The only query in optimizationCoordinator.ts is the SELECT inside getOptimizationSummary; the agent votes concern any domain. ADR-014 Phase 2C-3 §6.',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'POST', path: '/coordinate',
    category: 'CROSS_DOMAIN_AI_READ', allOf: [TEMPORARY_CROSS_DOMAIN_CAPABILITY],
    sources: ['any'],
    temporary: true,
    reason: 'coordinateRecommendations deduplicates and ranks the inputs supplied in the body via rankRecommendations. No write in optimizationCoordinator.ts, and the recommendations span any domain. ADR-014 Phase 2C-3 §6.',
  },
  {
    file: 'optimization.ts', router: 'router', method: 'POST', path: '/root-cause',
    category: 'CROSS_DOMAIN_AI_READ', allOf: [TEMPORARY_CROSS_DOMAIN_CAPABILITY],
    sources: ['any'],
    temporary: true,
    reason: 'synthesizeRootCause SELECTs operational_anomalies, realtime_event_log and twin_state_snapshots and returns a report; rootCauseSynthesisEngine.ts contains no write. realtime_event_log payloads carry no bounded provenance — the same reason ops /live-feed is crossdomain.read. ADR-014 Phase 2C-3 §6.',
  },
  {
    file: 'agents.ts', router: 'agentsRouter', method: 'POST', path: '/plan',
    category: 'AI_GOVERNANCE_READ', allOf: ['ai.govern'],
    sources: ['ai-governance'],
    reason: 'orchestrate() is called with options.dryRun = true and returns { tasksCreated: 0 } before enqueueTask or openExecution runs. checkGovernance is invoked without an executionId so it appends no execution event, and evaluateAgentPolicies is read-only. The response describes the agent plan and its governance level — AI control-plane information, which is what GET /agents/objectives already discloses under ai.govern. ADR-014 Phase 2C-3 §6.',
  },
]

/** In-scope AI reads confirmed but NOT yet protected. Phase 2B-3 closes only when empty. */
export const PENDING_AI_READS: readonly AiRead[] = []

export interface ReclassifiedAiRead {
  file:     string
  method:   string
  path:     string
  category: 'ORDINARY_MUTATION' | 'ALREADY_PROTECTED' | 'PROTOCOL_AUTH' | 'DEAD_ROUTE'
  reason:   string
}

/**
 * Endpoints the AI candidate sweep surfaced that this gate does not authorize.
 * An unexplained omission and a deliberate exclusion must not look the same.
 */
export const RECLASSIFIED_NOT_AI_READS: readonly ReclassifiedAiRead[] = [
  {
    file: 'aiGovernance.ts', method: 'POST', path: '/recommendations',
    category: 'ORDINARY_MUTATION',
    reason: 'Matched the read-shaped path sweep on /recommendations, but `queueRecommendation` inserts a row into ai_recommendation_queue. An ordinary mutation — Phase 2C (§39). Closed by ADR-014 Phase 2C-3 as an AI_GOVERNANCE_MUTATION under ai.govern; it stays reclassified here because it is a mutation, not a read.',
  },]
