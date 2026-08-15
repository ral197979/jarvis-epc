/**
 * Denver Engineering — high-sensitivity read perimeter (ADR-014 Phase 2B-1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 1 hides sensitive modules from the sidebar and the router. That is a
 * projection, not enforcement: until this file existed, a viewer could still
 * `curl` the tenant's budgets, its CRM pipeline, its audit trail and its
 * platform configuration, because the API asked only "are you authenticated?".
 *
 * This registry names every read whose *response* discloses one of the six
 * highest-sensitivity domains, and the capability that must open it. A ratchet
 * test derives the same set from source and fails the build when the two
 * disagree — a removed guard, a swapped capability, or a brand-new unprotected
 * read in any of these domains.
 *
 * Classification is by RETURNED INFORMATION, never by folder or by HTTP verb
 * (ADR-014 Phase 2B-1 §5, §6). `POST /policies/evaluate` is a read;
 * `POST /enterprise/exports` is not. An export inherits the authority of the
 * data it reveals, so there is deliberately no `/export → platform.export` rule.
 *
 * SCOPE. This slice establishes *functional* authority only: a role must hold
 * the domain capability before the API will answer. It does not establish
 * record scope — "this PM may read only assigned projects" needs a user↔project
 * membership primitive that does not exist yet, and is Phase 3.
 */
import type { ServerCapability } from './capabilities'

/** The six domains this gate closes. */
export type ReadDomain =
  | 'portfolio'         // cross-project executive roll-ups          → portfolio.view
  | 'project_registry'  // the organisation-wide project register    → project.list.all
  | 'commercial'        // budget, cost, EVM, billing, estimates     → cost.view
  | 'crm'               // business-development pipeline             → crm.view
  | 'audit'             // audit trail and security event history    → audit.view
  | 'platform'          // platform/system/integration configuration → platform.admin

export interface HighSensitivityRead {
  file:       string
  router:     string
  method:     string
  path:       string
  domain:     ReadDomain
  capability: ServerCapability
  /** Why this endpoint is classified as it is, when the answer is not obvious. */
  note?:      string
}

/**
 * The capability that governs each domain. Kept as one mapping so a route can
 * never be registered under `commercial` while carrying a `project.view` guard.
 */
export const DOMAIN_CAPABILITY: Record<ReadDomain, ServerCapability> = {
  portfolio:        'portfolio.view',
  project_registry: 'project.list.all',
  commercial:       'cost.view',
  crm:              'crm.view',
  audit:            'audit.view',
  platform:         'platform.admin',
}

/** Every high-sensitivity read, with the capability its guard must declare. */
export const HIGH_SENSITIVITY_READS: readonly HighSensitivityRead[] = [

  // ── portfolio ───────────────────────────────────────────────────
  { file: 'copilot.ts', router: 'router', method: 'GET', path: '/copilot/portfolio', domain: 'portfolio', capability: 'portfolio.view', note: 'Cross-project comparison and resource-conflict insights — a portfolio roll-up, not a single-project copilot briefing.' },
  { file: 'executive.ts', router: 'executiveRouter', method: 'GET', path: '/ai-acceptance', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'executive.ts', router: 'executiveRouter', method: 'GET', path: '/contractor-performance', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'executive.ts', router: 'executiveRouter', method: 'GET', path: '/escalation-hotspots', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'executive.ts', router: 'executiveRouter', method: 'GET', path: '/overview', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'executive.ts', router: 'executiveRouter', method: 'GET', path: '/portfolio-risk', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'executive.ts', router: 'executiveRouter', method: 'GET', path: '/sla-compliance', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'executive.ts', router: 'executiveRouter', method: 'GET', path: '/throughput', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'portfolio.ts', router: 'router', method: 'GET', path: '/anomalies', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'portfolio.ts', router: 'router', method: 'POST', path: '/anomalies/detect', domain: 'portfolio', capability: 'portfolio.view', note: 'Read-shaped: returns the tenant portfolio anomaly set. It also persists detections, so its write half still needs an ordinary-mutation grant in Phase 2C; the read guard is what closes the bypass of GET /anomalies.' },
  { file: 'portfolio.ts', router: 'router', method: 'GET', path: '/bottlenecks', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'portfolio.ts', router: 'router', method: 'GET', path: '/conflicts', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'portfolio.ts', router: 'router', method: 'GET', path: '/forecast', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'portfolio.ts', router: 'router', method: 'GET', path: '/maintenance/health/:twinId', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'portfolio.ts', router: 'router', method: 'GET', path: '/maintenance/recommendations', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'portfolio.ts', router: 'router', method: 'GET', path: '/readiness', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'portfolio.ts', router: 'router', method: 'GET', path: '/readiness/:scopeType/:scopeId', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'predict.ts', router: 'predictRouter', method: 'GET', path: '/predict/portfolio', domain: 'portfolio', capability: 'portfolio.view' },
  { file: 'predict.ts', router: 'predictRouter', method: 'GET', path: '/predict/projects/:id', domain: 'portfolio', capability: 'portfolio.view' },

  // ── project_registry ────────────────────────────────────────────
  { file: 'projects.ts', router: 'router', method: 'GET', path: '/', domain: 'project_registry', capability: 'project.list.all', note: 'MIXED: the row is `projects.*`, which carries budget/committed_cost/actual_cost/forecast_cost. project.list.all and cost.view are both Owner-only, so the guard is no wider than either domain.' },

  // ── commercial ──────────────────────────────────────────────────
  { file: 'budgets.ts', router: 'router', method: 'GET', path: '/budgets/:id/items', domain: 'commercial', capability: 'cost.view' },
  { file: 'budgets.ts', router: 'router', method: 'GET', path: '/projects/:projectId/budget', domain: 'commercial', capability: 'cost.view' },
  { file: 'budgets.ts', router: 'router', method: 'GET', path: '/projects/:projectId/budget/rollup', domain: 'commercial', capability: 'cost.view' },
  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'GET', path: '/change-orders/:id', domain: 'commercial', capability: 'cost.view' },
  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'GET', path: '/change-orders/:id/tasks', domain: 'commercial', capability: 'cost.view' },
  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'GET', path: '/projects/:projectId/change-orders', domain: 'commercial', capability: 'cost.view' },
  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'GET', path: '/projects/:projectId/change-orders/summary', domain: 'commercial', capability: 'cost.view' },
  { file: 'commitments.ts', router: 'router', method: 'GET', path: '/projects/:projectId/commitments', domain: 'commercial', capability: 'cost.view' },
  { file: 'costControl.ts', router: 'costControlRouter', method: 'GET', path: '/projects/:projectId/cost-control', domain: 'commercial', capability: 'cost.view' },
  { file: 'costEntry.ts', router: 'costEntryRouter', method: 'GET', path: '/cost-entries/:id', domain: 'commercial', capability: 'cost.view' },
  { file: 'costEntry.ts', router: 'costEntryRouter', method: 'GET', path: '/projects/:projectId/cost-entries', domain: 'commercial', capability: 'cost.view' },
  { file: 'costEntry.ts', router: 'costEntryRouter', method: 'GET', path: '/projects/:projectId/cost-entries/summary', domain: 'commercial', capability: 'cost.view' },
  { file: 'costIntelligence.ts', router: 'router', method: 'GET', path: '/projects/:projectId/cost-intelligence', domain: 'commercial', capability: 'cost.view' },
  { file: 'estimating.ts', router: 'router', method: 'GET', path: '/cost-items/search', domain: 'commercial', capability: 'cost.view' },
  { file: 'estimating.ts', router: 'router', method: 'GET', path: '/estimates', domain: 'commercial', capability: 'cost.view' },
  { file: 'estimating.ts', router: 'router', method: 'GET', path: '/estimates/:id', domain: 'commercial', capability: 'cost.view' },
  { file: 'evm.ts', router: 'evmRouter', method: 'GET', path: '/evm/baselines/:baselineId/wbs', domain: 'commercial', capability: 'cost.view' },
  { file: 'evm.ts', router: 'evmRouter', method: 'GET', path: '/projects/:projectId/evm/actuals', domain: 'commercial', capability: 'cost.view' },
  { file: 'evm.ts', router: 'evmRouter', method: 'GET', path: '/projects/:projectId/evm/baselines', domain: 'commercial', capability: 'cost.view' },
  { file: 'evm.ts', router: 'evmRouter', method: 'GET', path: '/projects/:projectId/evm/metrics', domain: 'commercial', capability: 'cost.view' },
  { file: 'evm.ts', router: 'evmRouter', method: 'GET', path: '/projects/:projectId/evm/scurve', domain: 'commercial', capability: 'cost.view' },
  { file: 'payApplications.ts', router: 'router', method: 'GET', path: '/pay-applications/:id', domain: 'commercial', capability: 'cost.view' },
  { file: 'payApplications.ts', router: 'router', method: 'GET', path: '/projects/:projectId/pay-applications', domain: 'commercial', capability: 'cost.view' },
  { file: 'payApplications.ts', router: 'router', method: 'GET', path: '/projects/:projectId/sov-items', domain: 'commercial', capability: 'cost.view' },
  { file: 'projects.ts', router: 'router', method: 'GET', path: '/:id/summary', domain: 'commercial', capability: 'cost.view', note: 'MIXED: project record + explicit budget variance + the project audit_log tail. cost.view (owner) is a subset of both audit.view (owner, admin) and project.view holders, so one guard is no wider than any domain in the payload.' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'GET', path: '/subcontracts/:id/invoices', domain: 'commercial', capability: 'cost.view', note: 'Subcontract invoice values are commercial data. ADR-014 Phase 2B-1 §16: procurement responsibility does not imply cost visibility.' },

  // ── crm ─────────────────────────────────────────────────────────
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'GET', path: '/proposals', domain: 'crm', capability: 'crm.view' },
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'GET', path: '/proposals/:id', domain: 'crm', capability: 'crm.view' },
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'GET', path: '/proposals/:id/items', domain: 'crm', capability: 'crm.view' },
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'GET', path: '/proposals/summary', domain: 'crm', capability: 'crm.view' },

  // ── audit ───────────────────────────────────────────────────────
  { file: 'audit.ts', router: 'router', method: 'GET', path: '/', domain: 'audit', capability: 'audit.view' },
  { file: 'audit.ts', router: 'router', method: 'GET', path: '/_meta/actions', domain: 'audit', capability: 'audit.view' },
  { file: 'audit.ts', router: 'router', method: 'GET', path: '/:id', domain: 'audit', capability: 'audit.view' },
  { file: 'audit.ts', router: 'router', method: 'GET', path: '/export', domain: 'audit', capability: 'audit.view' },
  { file: 'auditVerification.ts', router: 'auditVerificationRouter', method: 'GET', path: '/export', domain: 'audit', capability: 'audit.view' },
  { file: 'auditVerification.ts', router: 'auditVerificationRouter', method: 'GET', path: '/integrity', domain: 'audit', capability: 'audit.view' },
  { file: 'auditVerification.ts', router: 'auditVerificationRouter', method: 'GET', path: '/verify', domain: 'audit', capability: 'audit.view' },
  { file: 'policies.ts', router: 'policiesRouter', method: 'GET', path: '/audit', domain: 'audit', capability: 'audit.view', note: 'Policy evaluation history is tenant authorization/security event history.' },
  { file: 'scim.ts', router: 'adminRouter', method: 'GET', path: '/audit', domain: 'audit', capability: 'audit.view', note: 'SCIM provisioning history is administrative audit history.' },

  // ── platform ────────────────────────────────────────────────────
  { file: 'automation.ts', router: 'router', method: 'GET', path: '/background', domain: 'platform', capability: 'platform.admin' },
  { file: 'automation.ts', router: 'router', method: 'GET', path: '/handlers', domain: 'platform', capability: 'platform.admin' },
  { file: 'automation.ts', router: 'router', method: 'GET', path: '/kpi-snapshots', domain: 'platform', capability: 'platform.admin' },
  { file: 'automation.ts', router: 'router', method: 'GET', path: '/mcp-tools', domain: 'platform', capability: 'platform.admin' },
  { file: 'automation.ts', router: 'router', method: 'GET', path: '/scheduled', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/adapters', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/air-gap/status', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/benchmarks/industry', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/benchmarks/readiness', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/benchmarks/sla', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/benchmarks/tenant', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/certification/exports', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/edge-nodes', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/edge-nodes/admin/status', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/external-agents/:id/capabilities', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/federated/opt-in', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/federated/patterns', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/knowledge-graph/entities/:id', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/knowledge-graph/neighborhood/:id', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/knowledge-graph/query', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/marketplace/playbooks', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/plugins', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/workflows', domain: 'platform', capability: 'platform.admin' },
  { file: 'ecosystem.ts', router: 'router', method: 'GET', path: '/workflows/:id/versions', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/ai-usage', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/ai-usage/budget', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/ai-usage/by-agent', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/api-keys', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/demo', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/deployment/health', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/entitlements', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/exports', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/exports/:id', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/features', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/features/:featureKey', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/health-score', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/quota/api', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/quota/seats', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/subscriptions', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/tenants/:tenantId/lifecycle/history', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/tenants/:tenantId/subscription', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/tickets', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/tickets/:id', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/tickets/sla-breaches', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/usage', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'GET', path: '/usage/summary', domain: 'platform', capability: 'platform.admin' },
  { file: 'exports.ts', router: 'exportsRouter', method: 'GET', path: '/:id', domain: 'platform', capability: 'platform.admin', note: 'Data-warehouse export job status and download. Export types are analytics/audit/actions/readiness/events/sla_predictions/recommendations — every one sits inside the {owner, admin} platform/audit envelope.' },
  { file: 'exports.ts', router: 'exportsRouter', method: 'GET', path: '/:id/download', domain: 'platform', capability: 'platform.admin', note: 'Data-warehouse export job status and download. Export types are analytics/audit/actions/readiness/events/sla_predictions/recommendations — every one sits inside the {owner, admin} platform/audit envelope.' },
  { file: 'integrationHub.ts', router: 'integrationHubRouter', method: 'GET', path: '/', domain: 'platform', capability: 'platform.admin' },
  { file: 'integrationHub.ts', router: 'integrationHubRouter', method: 'GET', path: '/:id/health', domain: 'platform', capability: 'platform.admin' },
  { file: 'integrationHub.ts', router: 'integrationHubRouter', method: 'GET', path: '/health', domain: 'platform', capability: 'platform.admin' },
  { file: 'integrations.ts', router: 'integrationsRouter', method: 'GET', path: '/', domain: 'platform', capability: 'platform.admin' },
  { file: 'integrations.ts', router: 'integrationsRouter', method: 'GET', path: '/:id', domain: 'platform', capability: 'platform.admin' },
  { file: 'integrations.ts', router: 'syncJobsRouter', method: 'GET', path: '/', domain: 'platform', capability: 'platform.admin' },
  { file: 'integrations.ts', router: 'webhooksRouter', method: 'GET', path: '/', domain: 'platform', capability: 'platform.admin' },
  { file: 'integrations.ts', router: 'webhooksRouter', method: 'GET', path: '/:id/deliveries', domain: 'platform', capability: 'platform.admin' },
  { file: 'mcp.ts', router: 'router', method: 'GET', path: '/ava/health', domain: 'platform', capability: 'platform.admin' },
  { file: 'mcp.ts', router: 'router', method: 'GET', path: '/sessions', domain: 'platform', capability: 'platform.admin' },
  { file: 'mcp.ts', router: 'router', method: 'GET', path: '/tools', domain: 'platform', capability: 'platform.admin' },
  { file: 'policies.ts', router: 'policiesRouter', method: 'GET', path: '/', domain: 'platform', capability: 'platform.admin' },
  { file: 'policies.ts', router: 'policiesRouter', method: 'POST', path: '/evaluate', domain: 'platform', capability: 'platform.admin' },
  { file: 'runbooks.ts', router: 'runbooksRouter', method: 'GET', path: '/', domain: 'platform', capability: 'platform.admin' },
  { file: 'runbooks.ts', router: 'runbooksRouter', method: 'GET', path: '/:id/executions', domain: 'platform', capability: 'platform.admin' },
  { file: 'runbooks.ts', router: 'runbooksRouter', method: 'POST', path: '/:id/simulate', domain: 'platform', capability: 'platform.admin' },
  { file: 'scim.ts', router: 'adminRouter', method: 'GET', path: '/tokens', domain: 'platform', capability: 'platform.admin' },
  { file: 'tenants.ts', router: 'router', method: 'GET', path: '/me', domain: 'platform', capability: 'platform.admin' },
  { file: 'tenants.ts', router: 'router', method: 'GET', path: '/me/usage', domain: 'platform', capability: 'platform.admin' },
  { file: 'tenants.ts', router: 'router', method: 'GET', path: '/me/users', domain: 'platform', capability: 'platform.admin' },]

/**
 * High-sensitivity reads that are confirmed but NOT yet protected.
 *
 * Phase 2B-1 closes only when this is empty. It exists so that a slice which
 * identifies a read it cannot yet guard has somewhere honest to record it,
 * rather than quietly dropping it out of the census.
 */
export const PENDING_HIGH_SENSITIVITY_READS: readonly HighSensitivityRead[] = []

export interface ReclassifiedRead {
  file:   string
  method: string
  path:   string
  reason: string
}

/**
 * Endpoints the mechanical candidate sweep surfaces but which are NOT
 * high-sensitivity reads in this gate. Each needs a reason: an unexplained
 * omission and a deliberate exclusion must not look the same.
 */
export const RECLASSIFIED_NOT_HIGH_SENSITIVITY_READS: readonly ReclassifiedRead[] = [
  {
    file: 'optimization.ts', method: 'GET', path: '/proposals',
    reason: 'Resource-optimisation proposals from the Phase 7 optimisation engine — not the CRM/business-development pipeline the name suggests. Deferred to Phase 2B-2.',
  },
  {
    file: 'optimization.ts', method: 'GET', path: '/proposals/summary',
    reason: 'Same optimisation-engine surface as GET /proposals; not CRM. Deferred to Phase 2B-2.',
  },
  {
    file: 'scim.ts', method: 'GET', path: '/ServiceProviderConfig',
    reason: 'SCIM 2.0 protocol endpoint on scimRouter, authenticated by a provisioning bearer token (requireScimToken) with no user session. A user capability cannot apply; its authorization model is the token, tracked separately from the Phase 2 capability model.',
  },
  {
    file: 'scim.ts', method: 'GET', path: '/Schemas',
    reason: 'SCIM 2.0 protocol endpoint on scimRouter — provisioning bearer token, no user session. See GET /ServiceProviderConfig.',
  },
  {
    file: 'scim.ts', method: 'GET', path: '/Users',
    reason: 'SCIM 2.0 protocol endpoint on scimRouter — provisioning bearer token, no user session. See GET /ServiceProviderConfig.',
  },
  {
    file: 'scim.ts', method: 'GET', path: '/Users/:id',
    reason: 'SCIM 2.0 protocol endpoint on scimRouter — provisioning bearer token, no user session. See GET /ServiceProviderConfig.',
  },
  {
    file: 'enterprise.ts', method: 'PATCH', path: '/tickets/:id/status',
    reason: 'Matches the read-shaped path sweep on /status, but updates a support ticket. An ordinary mutation — Phase 2C.',
  },
  {
    file: 'enterprise.ts', method: 'POST', path: '/exports',
    reason: 'Creates a compliance export job (ADR-014 Phase 2B-1 §29 — causes a job, so not a read). The resulting data is read through GET /enterprise/exports/:id, which IS protected.',
  },
  {
    file: 'enterprise.ts', method: 'POST', path: '/deployment/health/check',
    reason: 'Persists a health-check record rather than returning existing state. An ordinary mutation — Phase 2C. The corresponding read, GET /enterprise/deployment/health, IS protected.',
  },
  {
    file: 'denverMcp.ts', method: 'GET', path: '/tools',
    reason: 'denverMcpRouter is deliberately not mounted in server.ts (see the file header) — unreachable, so there is no request path to authorize.',
  },
  {
    file: 'denverMcp.ts', method: 'POST', path: '/call',
    reason: 'Same unmounted denverMcpRouter as GET /tools — server.ts never mounts it, so no request can reach the handler and there is no request path to authorize.',
  },
  {
    file: 'enterprise.ts', method: 'POST', path: '/deployment/health/run',
    reason: 'Runs the platform check suite and is already an ADR-014 Phase 2A consequential transition guarded by platform.automation. Executing checks is an action, not a read; the read of the resulting state is GET /enterprise/deployment/health, which IS protected here.',
  },
]
