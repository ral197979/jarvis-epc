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
  method:     'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** Path as declared on the router. */
  path:       string
  /** Short description of the state change. */
  operation:  string
  capability: ServerCapability
}

export const ENFORCED_TRANSITIONS: readonly TransitionEndpoint[] = [
  // ── Team / workforce ────────────────────────────────────────────────────────
  { file: 'timesheets.ts', method: 'POST', path: '/timesheets/:id/submit',  operation: 'submit timesheet for review',   capability: 'team.write' },
  { file: 'timesheets.ts', method: 'POST', path: '/timesheets/:id/approve', operation: 'approve timesheet',             capability: 'team.approve' },
  { file: 'timesheets.ts', method: 'POST', path: '/timesheets/:id/reject',  operation: 'reject timesheet',              capability: 'team.approve' },
  { file: 'team.ts',       method: 'POST', path: '/team/assignments',       operation: 'create project assignment',     capability: 'team.approve' },
  { file: 'team.ts',       method: 'POST', path: '/team/assignments/:id/end', operation: 'end project assignment',     capability: 'team.approve' },

  // ── Construction / field ────────────────────────────────────────────────────
  { file: 'dailyLogs.ts', method: 'POST', path: '/daily-logs/:id/submit',  operation: 'submit daily log',  capability: 'construction.write' },
  { file: 'dailyLogs.ts', method: 'POST', path: '/daily-logs/:id/approve', operation: 'approve daily log', capability: 'construction.approve' },

  // ── Quality ─────────────────────────────────────────────────────────────────
  { file: 'punchLists.ts',  method: 'POST', path: '/punch-items/:id/verify',    operation: 'verify punch item',   capability: 'quality.verify' },
  { file: 'punchLists.ts',  method: 'POST', path: '/punch-items/:id/close',     operation: 'close punch item',    capability: 'quality.verify' },
  { file: 'inspections.ts', method: 'POST', path: '/inspections/:id/complete',  operation: 'complete inspection', capability: 'quality.verify' },

  // ── Risk ────────────────────────────────────────────────────────────────────
  { file: 'riskRegister.ts', method: 'POST', path: '/risks/:id/close', operation: 'close risk', capability: 'risk.approve' },

  // ── Documents / meetings ────────────────────────────────────────────────────
  { file: 'transmittals.ts', method: 'POST', path: '/:id/send',              operation: 'issue transmittal',  capability: 'docs.publish' },
  { file: 'transmittals.ts', method: 'POST', path: '/:id/close',             operation: 'close transmittal',  capability: 'docs.publish' },
  { file: 'meetings.ts',     method: 'POST', path: '/meetings/:id/publish',  operation: 'publish minutes',    capability: 'docs.publish' },
  { file: 'meetings.ts',     method: 'POST', path: '/meetings/:id/archive',  operation: 'archive minutes',    capability: 'docs.publish' },

  // ── Commercial (Owner-only under the temporary delegation policy) ───────────
  { file: 'changeOrders.ts', method: 'POST', path: '/change-orders/:id/submit',  operation: 'submit change order',  capability: 'cost.write' },
  { file: 'changeOrders.ts', method: 'POST', path: '/change-orders/:id/approve', operation: 'approve change order', capability: 'cost.approve' },
  { file: 'changeOrders.ts', method: 'POST', path: '/change-orders/:id/reject',  operation: 'reject change order',  capability: 'cost.approve' },
  { file: 'changeOrders.ts', method: 'POST', path: '/change-orders/:id/void',    operation: 'void change order',    capability: 'cost.approve' },
  { file: 'costEntry.ts',    method: 'POST', path: '/cost-entries/:id/void',     operation: 'void cost entry',      capability: 'cost.approve' },
  { file: 'estimating.ts',   method: 'POST', path: '/estimates/:id/approve',     operation: 'approve estimate',     capability: 'cost.approve' },

  // ── Procurement (Owner-only under the temporary delegation policy) ──────────
  { file: 'subcontracts.ts', method: 'POST', path: '/bid-packages/:id/issue',   operation: 'issue bid package',      capability: 'procurement.approve' },
  { file: 'subcontracts.ts', method: 'POST', path: '/bid-packages/:id/close',   operation: 'close bid package',      capability: 'procurement.approve' },
  { file: 'subcontracts.ts', method: 'POST', path: '/bid-packages/:id/cancel',  operation: 'cancel bid package',     capability: 'procurement.approve' },
  { file: 'subcontracts.ts', method: 'POST', path: '/bid-submissions/:id/award', operation: 'award bid',             capability: 'procurement.approve' },
  { file: 'subcontracts.ts', method: 'POST', path: '/sc-invoices/:id/submit',   operation: 'submit sc invoice',      capability: 'procurement.write' },
  { file: 'subcontracts.ts', method: 'POST', path: '/sc-invoices/:id/approve',  operation: 'approve sc invoice',     capability: 'procurement.approve' },
  { file: 'subcontracts.ts', method: 'POST', path: '/sc-invoices/:id/reject',   operation: 'reject sc invoice',      capability: 'procurement.approve' },
  { file: 'procurement.ts',  method: 'POST', path: '/:id/approve',              operation: 'approve purchase order', capability: 'procurement.approve' },

  // ── Commissioning (Owner-only under the temporary delegation policy) ───────
  { file: 'commissioning.ts', method: 'POST', path: '/finalize', operation: 'finalize commissioning pack', capability: 'commissioning.approve' },

  // ── AI governance (Owner + Platform Administrator) ─────────────────────────
  { file: 'aiGovernance.ts',    method: 'POST', path: '/recommendations/:id/approve', operation: 'approve AI recommendation', capability: 'ai.govern' },
  { file: 'aiGovernance.ts',    method: 'POST', path: '/recommendations/:id/reject',  operation: 'reject AI recommendation',  capability: 'ai.govern' },
  { file: 'aiGovernance.ts',    method: 'POST', path: '/recommendations/:id/execute', operation: 'execute AI recommendation', capability: 'ai.govern' },
  { file: 'aiGovernance.ts',    method: 'POST', path: '/recommendations/expire',      operation: 'expire recommendations',    capability: 'ai.govern' },
  { file: 'agentApprovals.ts',  method: 'POST', path: '/:id/approve',                 operation: 'approve agent action',      capability: 'ai.govern' },
  { file: 'agentApprovals.ts',  method: 'POST', path: '/:id/reject',                  operation: 'reject agent action',       capability: 'ai.govern' },
  { file: 'agents.ts',          method: 'POST', path: '/execute',                     operation: 'execute agent',             capability: 'ai.govern' },
  { file: 'autoCoordination.ts', method: 'POST', path: '/coordination/recommendations/:id/approve', operation: 'approve coordination recommendation', capability: 'ai.govern' },
  { file: 'autoCoordination.ts', method: 'POST', path: '/coordination/recommendations/:id/dismiss', operation: 'dismiss coordination recommendation', capability: 'ai.govern' },
  { file: 'optimization.ts',    method: 'POST', path: '/proposals/:id/approve',       operation: 'approve optimization proposal', capability: 'ai.govern' },

  // ── Platform automation ────────────────────────────────────────────────────
  { file: 'runbooks.ts', method: 'POST', path: '/:id/execute',                      operation: 'execute runbook',          capability: 'platform.automation' },
  { file: 'runbooks.ts', method: 'POST', path: '/executions/:execId/approve/:stepIndex', operation: 'approve runbook step', capability: 'platform.automation' },
  { file: 'mcp.ts',      method: 'POST', path: '/execute',                          operation: 'execute MCP tool',         capability: 'platform.automation' },

  // ── Knowledge corpus ───────────────────────────────────────────────────────
  { file: 'fixLibrary.ts', method: 'POST', path: '/:id/verify', operation: 'verify knowledge fix', capability: 'assistant.admin' },
]

/**
 * Transitions identified by the census that are NOT yet enforced. Phase 2A is
 * complete only when this is empty. Kept as data so the coverage ratchet can
 * assert it rather than trusting a report.
 */
export const PENDING_TRANSITIONS: readonly Omit<TransitionEndpoint, 'capability'>[] = [
  { file: 'ecosystem.ts',   method: 'POST', path: '/federated/model-versions/:id/activate', operation: 'activate federated model version' },
  { file: 'ecosystem.ts',   method: 'POST', path: '/marketplace/playbooks/:id/publish',     operation: 'publish marketplace playbook' },
  { file: 'ecosystem.ts',   method: 'POST', path: '/external-agents/:id/execute',           operation: 'execute external agent' },
  { file: 'ecosystem.ts',   method: 'POST', path: '/edge-nodes/:id/revoke',                 operation: 'revoke edge node' },
  { file: 'ecosystem.ts',   method: 'POST', path: '/air-gap/activate',                      operation: 'activate air-gap mode' },
  { file: 'ecosystem.ts',   method: 'POST', path: '/workflows/:id/publish',                 operation: 'publish workflow' },
  { file: 'enterprise.ts',  method: 'POST', path: '/tenants/:tenantId/provision',           operation: 'provision tenant' },
  { file: 'enterprise.ts',  method: 'POST', path: '/tenants/:tenantId/suspend',             operation: 'suspend tenant' },
  { file: 'enterprise.ts',  method: 'POST', path: '/tenants/:tenantId/reactivate',          operation: 'reactivate tenant' },
  { file: 'enterprise.ts',  method: 'POST', path: '/tenants/:tenantId/archive',             operation: 'archive tenant' },
  { file: 'enterprise.ts',  method: 'POST', path: '/tickets/:id/escalate',                  operation: 'escalate support ticket' },
  { file: 'enterprise.ts',  method: 'POST', path: '/deployment/health/run',                 operation: 'run deployment health check' },
  { file: 'automation.ts',  method: 'POST', path: '/background/:id/retry',                  operation: 'retry background job' },
  { file: 'autosignRules.ts', method: 'POST', path: '/arbitrate',                           operation: 'arbitrate autosign' },
  { file: 'compliance.ts',  method: 'POST', path: '/:id/complete',                          operation: 'complete compliance task' },
  { file: 'evidence.ts',    method: 'POST', path: '/:id/retry',                             operation: 'retry evidence job' },
  { file: 'integrationHub.ts', method: 'POST', path: '/jobs/:id/complete',                  operation: 'complete integration job' },
  { file: 'novaIntegrationStatus.ts', method: 'POST', path: '/projects/:projectId/nova-integration/retry', operation: 'retry Nova integration' },
  { file: 'ops.ts',         method: 'POST', path: '/reassign',                              operation: 'reassign ops item' },
  { file: 'ops.ts',         method: 'POST', path: '/escalate',                              operation: 'escalate ops item' },
  { file: 'ops.ts',         method: 'POST', path: '/freeze',                                operation: 'freeze ops' },
  { file: 'ops.ts',         method: 'POST', path: '/unfreeze',                              operation: 'unfreeze ops' },
  { file: 'portfolio.ts',   method: 'POST', path: '/anomalies/:anomalyId/resolve',          operation: 'resolve portfolio anomaly' },
  { file: 'proposals.ts',   method: 'POST', path: '/proposals/:id/submit',                  operation: 'submit proposal' },
  { file: 'scenarios.ts',   method: 'POST', path: '/:scenarioId/run',                       operation: 'run scenario' },
  { file: 'scenarios.ts',   method: 'POST', path: '/:scenarioId/cancel',                    operation: 'cancel scenario' },
  { file: 'sync.ts',        method: 'POST', path: '/resolve',                               operation: 'resolve sync conflict' },
  { file: 'monteCarlo.ts',  method: 'POST', path: '/runs',                                  operation: 'run Monte Carlo simulation' },
]
