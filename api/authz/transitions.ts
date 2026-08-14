/**
 * Denver Engineering — consequential transition registry (ADR-014 Phase 2A)
 * ─────────────────────────────────────────────────────────────────────────────
 * The endpoints that change business state in a way a user must be explicitly
 * authorized to cause: approve, reject, execute, publish, issue, close, verify,
 * award, void, finalize, complete, archive, dismiss, end.
 *
 * This is data, not enforcement — the guard lives on the route. It exists so the
 * sweep tests and the coverage ratchet can both iterate the same list, and so
 * the report can be generated rather than transcribed.
 *
 * `submit` operations are classified as WRITE, not approval: submitting your own
 * timesheet, daily log, change order or invoice moves it into review, it does
 * not decide it.
 */
import type { ServerCapability } from './capabilities'

export interface TransitionEndpoint {
  file:       string
  /** Router variable the route is declared on — part of the endpoint identity. */
  router:     string
  method:     'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** Path as declared on the router. */
  path:       string
  /** Short description of the state change. */
  operation:  string
  capability: ServerCapability
}

export const ENFORCED_TRANSITIONS: readonly TransitionEndpoint[] = [
  // ── Team / workforce ────────────────────────────────────────────────────────
  { file: 'timesheets.ts', router: 'timesheetsRouter', method: 'POST', path: '/timesheets/:id/submit',  operation: 'submit timesheet for review',   capability: 'team.write' },
  { file: 'timesheets.ts', router: 'timesheetsRouter', method: 'POST', path: '/timesheets/:id/approve', operation: 'approve timesheet',             capability: 'team.approve' },
  { file: 'timesheets.ts', router: 'timesheetsRouter', method: 'POST', path: '/timesheets/:id/reject',  operation: 'reject timesheet',              capability: 'team.approve' },
  { file: 'team.ts', router: 'teamRouter',       method: 'POST', path: '/team/assignments',       operation: 'create project assignment',     capability: 'team.approve' },
  { file: 'team.ts', router: 'teamRouter',       method: 'POST', path: '/team/assignments/:id/end', operation: 'end project assignment',     capability: 'team.approve' },

  // ── Construction / field ────────────────────────────────────────────────────
  { file: 'dailyLogs.ts', router: 'router', method: 'POST', path: '/daily-logs/:id/submit',  operation: 'submit daily log',  capability: 'construction.write' },
  { file: 'dailyLogs.ts', router: 'router', method: 'POST', path: '/daily-logs/:id/approve', operation: 'approve daily log', capability: 'construction.approve' },

  // ── Quality ─────────────────────────────────────────────────────────────────
  { file: 'punchLists.ts', router: 'router',  method: 'POST', path: '/punch-items/:id/verify',    operation: 'verify punch item',   capability: 'quality.verify' },
  { file: 'punchLists.ts', router: 'router',  method: 'POST', path: '/punch-items/:id/close',     operation: 'close punch item',    capability: 'quality.verify' },
  { file: 'inspections.ts', router: 'router', method: 'POST', path: '/inspections/:id/complete',  operation: 'complete inspection', capability: 'quality.verify' },

  // ── Risk ────────────────────────────────────────────────────────────────────
  { file: 'riskRegister.ts', router: 'riskRegisterRouter', method: 'POST', path: '/risks/:id/close', operation: 'close risk', capability: 'risk.approve' },

  // ── Documents / meetings ────────────────────────────────────────────────────
  { file: 'transmittals.ts', router: 'router', method: 'POST', path: '/:id/send',              operation: 'issue transmittal',  capability: 'docs.publish' },
  { file: 'transmittals.ts', router: 'router', method: 'POST', path: '/:id/close',             operation: 'close transmittal',  capability: 'docs.publish' },
  { file: 'meetings.ts', router: 'meetingsRouter',     method: 'POST', path: '/meetings/:id/publish',  operation: 'publish minutes',    capability: 'docs.publish' },
  { file: 'meetings.ts', router: 'meetingsRouter',     method: 'POST', path: '/meetings/:id/archive',  operation: 'archive minutes',    capability: 'docs.publish' },

  // ── Commercial (Owner-only under the temporary delegation policy) ───────────
  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'POST', path: '/change-orders/:id/submit',  operation: 'submit change order',  capability: 'cost.write' },
  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'POST', path: '/change-orders/:id/approve', operation: 'approve change order', capability: 'cost.approve' },
  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'POST', path: '/change-orders/:id/reject',  operation: 'reject change order',  capability: 'cost.approve' },
  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'POST', path: '/change-orders/:id/void',    operation: 'void change order',    capability: 'cost.approve' },
  { file: 'costEntry.ts', router: 'costEntryRouter',    method: 'POST', path: '/cost-entries/:id/void',     operation: 'void cost entry',      capability: 'cost.approve' },
  { file: 'estimating.ts', router: 'router',   method: 'POST', path: '/estimates/:id/approve',     operation: 'approve estimate',     capability: 'cost.approve' },

  // ── Procurement (Owner-only under the temporary delegation policy) ──────────
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'POST', path: '/bid-packages/:id/issue',   operation: 'issue bid package',      capability: 'procurement.approve' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'POST', path: '/bid-packages/:id/close',   operation: 'close bid package',      capability: 'procurement.approve' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'POST', path: '/bid-packages/:id/cancel',  operation: 'cancel bid package',     capability: 'procurement.approve' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'POST', path: '/bid-submissions/:id/award', operation: 'award bid',             capability: 'procurement.approve' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'POST', path: '/sc-invoices/:id/submit',   operation: 'submit sc invoice',      capability: 'procurement.write' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'POST', path: '/sc-invoices/:id/approve',  operation: 'approve sc invoice',     capability: 'procurement.approve' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'POST', path: '/sc-invoices/:id/reject',   operation: 'reject sc invoice',      capability: 'procurement.approve' },
  { file: 'procurement.ts', router: 'purchaseOrdersRouter',  method: 'POST', path: '/:id/approve',              operation: 'approve purchase order', capability: 'procurement.approve' },

  // ── Commissioning (Owner-only under the temporary delegation policy) ───────
  { file: 'commissioning.ts', router: 'router', method: 'POST', path: '/finalize', operation: 'finalize commissioning pack', capability: 'commissioning.approve' },

  // ── AI governance (Owner + Platform Administrator) ─────────────────────────
  { file: 'aiGovernance.ts', router: 'aiGovernanceRouter',    method: 'POST', path: '/recommendations/:id/approve', operation: 'approve AI recommendation', capability: 'ai.govern' },
  { file: 'aiGovernance.ts', router: 'aiGovernanceRouter',    method: 'POST', path: '/recommendations/:id/reject',  operation: 'reject AI recommendation',  capability: 'ai.govern' },
  { file: 'aiGovernance.ts', router: 'aiGovernanceRouter',    method: 'POST', path: '/recommendations/:id/execute', operation: 'execute AI recommendation', capability: 'ai.govern' },
  { file: 'aiGovernance.ts', router: 'aiGovernanceRouter',    method: 'POST', path: '/recommendations/expire',      operation: 'expire recommendations',    capability: 'ai.govern' },
  { file: 'agentApprovals.ts', router: 'agentApprovalsRouter',  method: 'POST', path: '/:id/approve',                 operation: 'approve agent action',      capability: 'ai.govern' },
  { file: 'agentApprovals.ts', router: 'agentApprovalsRouter',  method: 'POST', path: '/:id/reject',                  operation: 'reject agent action',       capability: 'ai.govern' },
  { file: 'agents.ts', router: 'agentsRouter',          method: 'POST', path: '/execute',                     operation: 'execute agent',             capability: 'ai.govern' },
  { file: 'autoCoordination.ts', router: 'router', method: 'POST', path: '/coordination/recommendations/:id/approve', operation: 'approve coordination recommendation', capability: 'ai.govern' },
  { file: 'autoCoordination.ts', router: 'router', method: 'POST', path: '/coordination/recommendations/:id/dismiss', operation: 'dismiss coordination recommendation', capability: 'ai.govern' },
  { file: 'optimization.ts', router: 'router',    method: 'POST', path: '/proposals/:id/approve',       operation: 'approve optimization proposal', capability: 'ai.govern' },

  // ── Platform automation ────────────────────────────────────────────────────
  { file: 'runbooks.ts', router: 'runbooksRouter', method: 'POST', path: '/:id/execute',                      operation: 'execute runbook',          capability: 'platform.automation' },
  { file: 'runbooks.ts', router: 'runbooksRouter', method: 'POST', path: '/executions/:execId/approve/:stepIndex', operation: 'approve runbook step', capability: 'platform.automation' },
  { file: 'mcp.ts', router: 'router',      method: 'POST', path: '/execute',                          operation: 'execute MCP tool',         capability: 'platform.automation' },

  // ── Knowledge corpus ───────────────────────────────────────────────────────
  { file: 'fixLibrary.ts', router: 'router', method: 'POST', path: '/:id/verify', operation: 'verify knowledge fix', capability: 'assistant.admin' },
  // ── Platform / ecosystem / tenant lifecycle (Phase 2A completion) ──────────
  { file: 'agentApprovals.ts', router: 'agentApprovalsRouter', method: 'POST', path: '/expire', operation: 'expire agent approvals', capability: 'ai.govern' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/federated/model-versions/:id/activate', operation: 'activate federated model version', capability: 'ai.govern' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/external-agents/:id/execute',           operation: 'execute external agent',          capability: 'ai.govern' },
  { file: 'optimization.ts', router: 'router', method: 'POST', path: '/proposals/:id/apply',                operation: 'apply optimization proposal',     capability: 'ai.govern' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/marketplace/playbooks/:id/publish',     operation: 'publish marketplace playbook',    capability: 'platform.automation' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/workflows/:id/publish',                 operation: 'publish workflow',                capability: 'platform.automation' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/edge-nodes/:id/revoke',                 operation: 'revoke edge node',                capability: 'platform.security' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/air-gap/activate',                      operation: 'activate air-gap licence',        capability: 'platform.security' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/tenants/:tenantId/provision',          operation: 'provision tenant',                capability: 'platform.identity' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/tenants/:tenantId/suspend',            operation: 'suspend tenant',                  capability: 'platform.identity' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/tenants/:tenantId/reactivate',         operation: 'reactivate tenant',               capability: 'platform.identity' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/tenants/:tenantId/archive',            operation: 'archive tenant',                  capability: 'platform.identity' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/tickets/:id/escalate',                 operation: 'escalate support ticket',         capability: 'platform.identity' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/deployment/health/run',                operation: 'run deployment health check',     capability: 'platform.automation' },
  { file: 'automation.ts', router: 'router', method: 'POST', path: '/background/:id/retry',                 operation: 'retry background job',            capability: 'platform.automation' },
  { file: 'evidence.ts', router: 'evidenceRouter',   method: 'POST', path: '/:id/retry',                            operation: 'retry evidence job',              capability: 'platform.automation' },
  { file: 'ops.ts', router: 'opsRouter', method: 'POST', path: '/reassign',  operation: 'reassign ops item', capability: 'platform.automation' },
  { file: 'ops.ts', router: 'opsRouter', method: 'POST', path: '/escalate',  operation: 'escalate ops item', capability: 'platform.automation' },
  { file: 'ops.ts', router: 'opsRouter', method: 'POST', path: '/freeze',    operation: 'freeze operations',   capability: 'platform.automation' },
  { file: 'ops.ts', router: 'opsRouter', method: 'POST', path: '/unfreeze',  operation: 'unfreeze operations', capability: 'platform.automation' },
  { file: 'integrationHub.ts', router: 'integrationHubRouter',        method: 'POST', path: '/jobs/:id/complete', operation: 'complete integration job', capability: 'platform.integrations' },
  { file: 'novaIntegrationStatus.ts', router: 'router', method: 'POST', path: '/projects/:projectId/nova-integration/retry', operation: 'retry Nova integration', capability: 'platform.integrations' },

  // ── Business transitions completed in this gate ────────────────────────────
  { file: 'autosignRules.ts', router: 'router', method: 'POST', path: '/arbitrate',   operation: 'arbitrate commissioning autosign', capability: 'commissioning.approve' },
  { file: 'compliance.ts', router: 'router',    method: 'POST', path: '/:id/complete', operation: 'complete compliance task',        capability: 'safety.approve' },
  { file: 'portfolio.ts', router: 'router',     method: 'POST', path: '/anomalies/:anomalyId/resolve', operation: 'resolve portfolio anomaly', capability: 'portfolio.approve' },
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'POST', path: '/proposals/:id/won',    operation: 'mark proposal won',    capability: 'crm.approve' },
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'POST', path: '/proposals/:id/lost',   operation: 'mark proposal lost',   capability: 'crm.approve' },
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'POST', path: '/proposals/:id/no-bid', operation: 'mark proposal no-bid', capability: 'crm.approve' },
  { file: 'sync.ts', router: 'syncRouter', method: 'POST', path: '/resolve', operation: 'resolve field-sync conflict', capability: 'field.write' },
]

/**
 * Transitions identified by the census that are NOT yet enforced. Phase 2A is
 * complete only when this is empty. Kept as data so the coverage ratchet can
 * assert it rather than trusting a report.
 */
/**
 * Candidates the semantic review REJECTED as consequential transitions. Kept as
 * data so the classification is reviewable and the census is reproducible.
 * Their ordinary-write authorization belongs to a later Phase 2 slice.
 */
export const RECLASSIFIED_NOT_TRANSITIONS: readonly { file: string; path: string; reason: string }[] = [
  { file: 'proposals.ts',    path: '/proposals/:id/submit', reason: 'Moves the author\'s own draft into review; decides nothing (Phase 2A §8 case A).' },
  { file: 'scenarios.ts',    path: '/:scenarioId/run',      reason: 'Runs a simulation — computation, not a business state decision.' },
  { file: 'scenarios.ts',    path: '/:scenarioId/cancel',   reason: 'Cancels the caller\'s own simulation run; controls computation.' },
  { file: 'monteCarlo.ts',   path: '/runs',                 reason: 'Executes a Monte Carlo simulation and returns results; computation.' },
  { file: 'evidence.ts',     path: '/confirm',              reason: 'Confirms an upload completed (storage key + checksum); ordinary write.' },
  { file: 'files.ts',        path: '/confirm/:versionId',   reason: 'Confirms a file upload completed; ordinary write.' },
  { file: 'notifications.ts', path: '/notifications/:id/dismiss', reason: "Dismisses the caller's own notification; ordinary write." },
  { file: 'bim.ts',          path: '/bim-issues/:id',       reason: 'General edit endpoint with status among eight updatable columns; ordinary write.' },
  { file: 'aiGovernance.ts', path: '/recommendations',      reason: 'Creates a recommendation; the transition is approve/reject/execute.' },
  { file: 'meetings.ts',     path: '/meetings/:id/agenda',  reason: 'Agenda item CRUD.' },
  { file: 'schedule.ts',     path: '/:projectId/dependencies', reason: 'Schedule dependency CRUD.' },
]

/** Phase 2A is complete when this is empty. */
export const PENDING_TRANSITIONS: readonly Omit<TransitionEndpoint, 'capability'>[] = []
