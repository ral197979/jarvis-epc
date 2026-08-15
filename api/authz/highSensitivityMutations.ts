/**
 * Denver Engineering — high-sensitivity mutation perimeter (ADR-014 Phase 2C-2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2B-1 decided who may *read* the six highest-sensitivity domains. Phase
 * 2C-1 decided who may *change* the twelve project-delivery domains. This decides
 * who may change the commercial, CRM, portfolio, audit and platform surfaces —
 * the block Phase 2C-1 measured at 97 endpoints and named as the largest
 * remaining exposure in the API.
 *
 * Until now every one of these was authentication-only or rested on a legacy
 * `['owner','admin']` check against the **JWT claim**. Both are defects, and they
 * are different defects:
 *
 *   authentication-only  — any signed-in principal, viewer included, could mint a
 *                          tenant API key, publish a federated pattern, create a
 *                          webhook, edit a budget or open an export job.
 *   legacy role guard    — authority read from the token, so a demoted user kept
 *                          their old power until the token expired. Every guard
 *                          replaced here moves that decision to
 *                          `resolveCurrentUser`, which reads the database.
 *
 * Domain assignment is INHERITED from `highSensitivityReads.ts`, keyed by
 * file + router, so this gate cannot invent a second platform taxonomy. Where a
 * router serves a mixed payload the narrowest capability wins — the same rule
 * Phase 2B-1 applied to `GET /projects/:id/summary`.
 *
 * Capability selection followed one rule: prefer the capability an established
 * sibling on the same resource family already carries. `POST /workflows` is
 * `platform.automation` because `POST /workflows/:id/publish` is;
 * `POST /edge-nodes` is `platform.security` because `POST /edge-nodes/:id/revoke`
 * is; `POST /tenants/:tenantId/lifecycle` is `platform.identity` because
 * provision/suspend/reactivate/archive all are. **No capability was created and
 * no grant was changed.**
 *
 * ADR-014 D2 is load-bearing here. Platform Administrator legitimately holds
 * `platform.*` and `ai.govern`, so those swaps are holder-neutral. It holds no
 * business approval capability, so the four operations whose authority is
 * business approval (autosign rules, baseline deletion, compliance-task
 * deletion, knowledge-fix deletion) narrow from {owner, admin} to {owner}. That
 * narrowing is derived from D2, not invented for this slice.
 */
import type { ServerCapability } from './capabilities'

/** The mutation-side domains this gate closes. */
export type SensitiveDomain =
  | 'commercial'    // budgets, change orders, cost entries, EVM, pay applications
  | 'crm'           // business-development pipeline
  | 'project'       // the project record itself
  | 'portfolio'     // cross-project executive state
  | 'audit'         // audit integrity evidence
  | 'platform'      // platform, identity, integration, automation configuration
  | 'commissioning' // commissioning execution records reached via §22

export interface SensitiveMutation {
  file:   string
  router: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path:   string
  domain: SensitiveDomain
  /** The capability the route's guard must declare. */
  capability: ServerCapability
  /**
   * A second capability, when the operation legitimately needs a conjunction.
   * Used only for export-job creation, where ADR-014 Phase 2C-2 §34 requires
   * both the authority to read the data and the authority to run the export.
   */
  alsoRequires?: ServerCapability
  /** What guarded it before this slice, when that was not "authentication only". */
  previousGuard?: string
  /** Why this capability, when the answer is not obvious. */
  note?: string
}

/**
 * Every high-sensitivity ordinary mutation this gate protects.
 *
 * SCOPE — ordinary mutations only. Anything that approves, certifies, finalises,
 * issues a credential or grants an entitlement is either an already registered
 * consequential transition (`transitions.ts`), a newly registered one added by
 * this slice, or a policy dependency recorded in `POLICY_DEPENDENT_MUTATIONS`.
 */
export const HIGH_SENSITIVITY_MUTATIONS: readonly SensitiveMutation[] = [

  // ── commercial ────────────────────────────────────────────────────────────
  // cost.write is the ordinary half of the pair whose approval half, cost.approve,
  // already guards change-order approval, estimate approval, invoice approval,
  // cost-entry voiding and the pay-application lifecycle.
  { file: 'budgets.ts', router: 'router', method: 'POST', path: '/projects/:projectId/budget', domain: 'commercial', capability: 'cost.write' },
  { file: 'budgets.ts', router: 'router', method: 'PATCH', path: '/budgets/:id', domain: 'commercial', capability: 'cost.write' },
  { file: 'budgets.ts', router: 'router', method: 'POST', path: '/budgets/:id/items', domain: 'commercial', capability: 'cost.write' },
  { file: 'budgets.ts', router: 'router', method: 'PATCH', path: '/budget-items/:itemId', domain: 'commercial', capability: 'cost.write' },
  { file: 'budgets.ts', router: 'router', method: 'DELETE', path: '/budget-items/:itemId', domain: 'commercial', capability: 'cost.write' },

  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'POST', path: '/projects/:projectId/change-orders', domain: 'commercial', capability: 'cost.write',
    note: 'Raising a change order is ordinary commercial work. Approving one is POST /change-orders/:id/approve, already cost.approve.' },
  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'PATCH', path: '/change-orders/:id', domain: 'commercial', capability: 'cost.write' },
  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'POST', path: '/change-orders/:id/tasks', domain: 'commercial', capability: 'cost.write' },
  { file: 'changeOrders.ts', router: 'changeOrdersRouter', method: 'DELETE', path: '/change-orders/:id/tasks/:taskId', domain: 'commercial', capability: 'cost.write' },

  { file: 'costEntry.ts', router: 'costEntryRouter', method: 'POST', path: '/projects/:projectId/cost-entries', domain: 'commercial', capability: 'cost.write' },
  { file: 'costEntry.ts', router: 'costEntryRouter', method: 'PATCH', path: '/cost-entries/:id', domain: 'commercial', capability: 'cost.write' },
  { file: 'costEntry.ts', router: 'costEntryRouter', method: 'DELETE', path: '/cost-entries/:id', domain: 'commercial', capability: 'cost.write' },

  { file: 'evm.ts', router: 'evmRouter', method: 'POST', path: '/projects/:projectId/evm/baselines', domain: 'commercial', capability: 'cost.write' },
  { file: 'evm.ts', router: 'evmRouter', method: 'POST', path: '/evm/baselines/:baselineId/wbs', domain: 'commercial', capability: 'cost.write' },
  { file: 'evm.ts', router: 'evmRouter', method: 'POST', path: '/projects/:projectId/evm/actuals', domain: 'commercial', capability: 'cost.write' },
  { file: 'evm.ts', router: 'evmRouter', method: 'POST', path: '/projects/:projectId/evm/progress', domain: 'commercial', capability: 'cost.write' },
  { file: 'evm.ts', router: 'evmRouter', method: 'POST', path: '/projects/:projectId/evm/snapshot', domain: 'commercial', capability: 'cost.write' },

  // ── commercial: the D1 pay-application split ──────────────────────────────
  // ADR-014 D1. Ordinary editing and the lifecycle verdict were not separable
  // before this slice: the ordinary half was unguarded and every status change,
  // submission included, went through one cost.approve route. The four
  // operations D1 names are now four distinct server contracts.
  { file: 'payApplications.ts', router: 'router', method: 'POST', path: '/projects/:projectId/sov-items', domain: 'commercial', capability: 'cost.write',
    note: 'D1 "ordinary edit". The Schedule of Values a pay application bills against.' },
  { file: 'payApplications.ts', router: 'router', method: 'POST', path: '/projects/:projectId/pay-applications', domain: 'commercial', capability: 'cost.write',
    note: 'D1 "draft". createPayApplication never inserts status, so the row can only start at the column default; a cost.write holder cannot create one already approved.' },
  { file: 'payApplications.ts', router: 'router', method: 'PATCH', path: '/pay-applications/:id/lines', domain: 'commercial', capability: 'cost.write',
    note: 'D1 "ordinary edit". The handler already refuses any application that is not draft or rejected, so cost.write cannot alter a submitted or approved billing.' },
  { file: 'payApplications.ts', router: 'router', method: 'POST', path: '/pay-applications/:id/submit', domain: 'commercial', capability: 'cost.write',
    note: 'D1 "submit → cost.write". Added by this slice so submission stops being laundered through the cost.approve status route. Refuses anything not draft or rejected; it cannot reach approved, paid or rejected.' },

  // ── project ───────────────────────────────────────────────────────────────
  { file: 'projects.ts', router: 'router', method: 'POST', path: '/', domain: 'project', capability: 'project.write' },
  { file: 'projects.ts', router: 'router', method: 'PATCH', path: '/:id', domain: 'project', capability: 'project.write',
    note: 'guardTransitionOwnedState("projects") still runs after the capability and still refuses status=completed|cancelled and current_phase. '
        + 'The row also carries budget/committed_cost/actual_cost/forecast_cost; Phase 2B-2 already recorded projects.* as MIXED_PAYLOAD_PHASE3 '
        + 'and this slice inherits that deferral rather than opening a second taxonomy. See RESIDUAL_MIXED_PAYLOAD_WRITE below.' },
  { file: 'projects.ts', router: 'router', method: 'DELETE', path: '/:id', domain: 'project', capability: 'project.delete',
    previousGuard: "['owner','admin'] on the JWT role",
    note: 'ADR-014 D4, closed in Phase 2C-2A. Hard deletion carries its own authority rather than borrowing project.write or project.approve — the latter would have extended irreversible destruction of the project root to every project manager. project.delete is held by owner alone and the holder set is asserted as an exact equality.' },
  { file: 'projects.ts', router: 'router', method: 'PATCH', path: '/:id/agent-mode', domain: 'project', capability: 'ai.govern',
    previousGuard: "['owner','admin'] on the JWT role",
    note: 'Sets the project agent autonomy mode (auto | review_all | frozen) — how much an agent may do without human review. That is AI governance, which ADR-014 Phase 2A §22 already assigns to ai.govern. Holders {owner, admin} are exactly the legacy set, so this is holder-neutral and fixes the stale-token read.' },

  // ── crm ───────────────────────────────────────────────────────────────────
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'POST', path: '/proposals', domain: 'crm', capability: 'crm.write' },
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'PATCH', path: '/proposals/:id', domain: 'crm', capability: 'crm.write' },
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'POST', path: '/proposals/:id/items', domain: 'crm', capability: 'crm.write' },
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'PATCH', path: '/proposals/:id/items/:itemId', domain: 'crm', capability: 'crm.write' },
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'DELETE', path: '/proposals/:id/items/:itemId', domain: 'crm', capability: 'crm.write' },
  { file: 'proposals.ts', router: 'proposalsRouter', method: 'POST', path: '/proposals/:id/submit', domain: 'crm', capability: 'crm.write',
    note: 'The exact shape D1 gives pay-application submission: submitting asks for a decision, it does not make one. The three decisions — won, lost, no-bid — keep crm.approve. submitProposal only moves a draft.' },

  // ── audit ─────────────────────────────────────────────────────────────────
  { file: 'auditVerification.ts', router: 'auditVerificationRouter', method: 'POST', path: '/snapshot', domain: 'audit', capability: 'audit.view',
    note: 'Records an integrity snapshot of the chain the caller can already read. The repository has exactly one audit capability — there is no audit.write — and inventing one would fail the §27 materiality test: it would separate two authorities that no workflow separates and whose holder sets would both be {owner, admin}. Guarding with audit.view keeps the audit administrator set intact and is a strict tightening of authentication-only.' },

  // ── platform: automation ──────────────────────────────────────────────────
  { file: 'automation.ts', router: 'router', method: 'POST', path: '/scheduled', domain: 'platform', capability: 'platform.automation', previousGuard: '_requireAdmin — [\'owner\',\'admin\'] on the JWT role' },
  { file: 'automation.ts', router: 'router', method: 'PATCH', path: '/scheduled/:id', domain: 'platform', capability: 'platform.automation', previousGuard: '_requireAdmin — [\'owner\',\'admin\'] on the JWT role' },
  { file: 'automation.ts', router: 'router', method: 'DELETE', path: '/scheduled/:id', domain: 'platform', capability: 'platform.automation', previousGuard: '_requireAdmin — [\'owner\',\'admin\'] on the JWT role' },
  { file: 'automation.ts', router: 'router', method: 'POST', path: '/mcp-tools/:name/disable', domain: 'platform', capability: 'platform.automation', previousGuard: '_requireAdmin — [\'owner\',\'admin\'] on the JWT role' },
  { file: 'automation.ts', router: 'router', method: 'DELETE', path: '/mcp-tools/:name/disable', domain: 'platform', capability: 'platform.automation', previousGuard: '_requireAdmin — [\'owner\',\'admin\'] on the JWT role' },

  { file: 'runbooks.ts', router: 'runbooksRouter', method: 'POST', path: '/', domain: 'platform', capability: 'platform.automation',
    note: 'Same router as POST /:id/execute and POST /executions/:execId/approve/:stepIndex, both already platform.automation.' },
  { file: 'runbooks.ts', router: 'runbooksRouter', method: 'POST', path: '/executions/:execId/rollback', domain: 'platform', capability: 'platform.automation' },

  // ── platform: ecosystem ───────────────────────────────────────────────────
  // Capability per resource family, taken from the sibling Phase 2A already guards.
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/workflows', domain: 'platform', capability: 'platform.automation', note: 'Sibling POST /workflows/:id/publish is platform.automation.' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/workflows/:id/validate', domain: 'platform', capability: 'platform.automation' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/workflows/:id/test', domain: 'platform', capability: 'platform.automation' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/workflows/:id/rollback', domain: 'platform', capability: 'platform.automation' },

  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/marketplace/playbooks', domain: 'platform', capability: 'platform.automation', note: 'Sibling POST /marketplace/playbooks/:id/publish is platform.automation.' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/marketplace/playbooks/:id/install', domain: 'platform', capability: 'platform.automation' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/marketplace/playbooks/:id/uninstall', domain: 'platform', capability: 'platform.automation' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/marketplace/playbooks/:id/review', domain: 'platform', capability: 'platform.automation' },

  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/plugins', domain: 'platform', capability: 'platform.integrations',
    note: 'A plugin is an installed third-party extension — integration administration. registerPlugin takes no tenant argument, so this writes platform-global state; the capability is what stops any authenticated tenant user reaching it.' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/plugins/:id/install', domain: 'platform', capability: 'platform.integrations' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/plugins/:id/rollback', domain: 'platform', capability: 'platform.integrations' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/plugins/:id/disable', domain: 'platform', capability: 'platform.integrations' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/plugins/:id/kill-switch', domain: 'platform', capability: 'platform.security',
    note: 'Not platform.integrations like the rest of the family: the kill switch is platform-global (triggerKillSwitch takes no tenant) and disables a plugin for every tenant at once. That changes the security posture, which is exactly what platform.security is for.' },

  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/adapters', domain: 'platform', capability: 'platform.integrations' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/adapters/:id/ingest', domain: 'platform', capability: 'platform.integrations' },

  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/edge-nodes', domain: 'platform', capability: 'platform.security',
    note: 'The capability registry names edge-node revocation as the reason platform.security exists. Registering the node is the other half of the same connectivity perimeter.' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/edge-nodes/:id/heartbeat', domain: 'platform', capability: 'platform.security' },

  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/external-agents/register', domain: 'platform', capability: 'ai.govern', note: 'Sibling POST /external-agents/:id/execute is ai.govern. Registering the agent is what makes the execute route reachable.' },

  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/federated/opt-in', domain: 'platform', capability: 'ai.govern',
    note: 'The federated family is governed by ai.govern — POST /federated/model-versions/:id/activate already is. Opt-in and opt-out decide whether this tenant\'s data leaves for federated learning.' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/federated/opt-out', domain: 'platform', capability: 'ai.govern' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/federated/contribute', domain: 'platform', capability: 'ai.govern' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/federated/withdraw/:id', domain: 'platform', capability: 'ai.govern' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/federated/patterns', domain: 'platform', capability: 'ai.govern',
    previousGuard: "requireRole('owner','admin') on the JWT role",
    note: 'ai.govern holders are {owner, admin} — exactly the legacy requireRole set — so this is holder-neutral and fixes the stale-token read. publishPattern takes no tenant argument: the pattern is published platform-wide.' },
  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/federated/model-versions', domain: 'platform', capability: 'ai.govern' },

  { file: 'ecosystem.ts', router: 'router', method: 'POST', path: '/certification/generate', domain: 'platform', capability: 'platform.export', alsoRequires: 'platform.admin',
    note: 'Generates a certification export package. ADR-014 Phase 2C-2 §34: an export creator needs both the authority to read the data (platform.admin, the guard on GET /certification/exports) and the authority to run the export (platform.export).' },

  // ── platform: enterprise ──────────────────────────────────────────────────
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/tenants/:tenantId/lifecycle', domain: 'platform', capability: 'platform.identity',
    note: 'The generic lifecycle route beside provision/suspend/reactivate/archive, every one of which is already platform.identity. Its requireTenantAdmin scope guard is unchanged and still runs — capability decides authority, that guard decides which tenant.' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/tickets', domain: 'platform', capability: 'platform.identity', note: 'Sibling POST /tickets/:id/escalate is platform.identity.' },
  { file: 'enterprise.ts', router: 'router', method: 'PATCH', path: '/tickets/:id/status', domain: 'platform', capability: 'platform.identity' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/demo', domain: 'platform', capability: 'platform.identity', note: 'Creates a demo tenant — tenant administration. requirePlatformAdmin (the PLATFORM_ADMIN_USER_IDS allowlist) is unchanged and still runs.' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/demo/:tenantId/reset', domain: 'platform', capability: 'platform.identity' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/deployment/health/check', domain: 'platform', capability: 'platform.automation', note: 'Sibling POST /deployment/health/run is already platform.automation.' },
  { file: 'enterprise.ts', router: 'router', method: 'PUT', path: '/features/:featureKey', domain: 'platform', capability: 'platform.admin', note: 'Feature-flag override — platform configuration. GET /features is platform.admin.' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/usage', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/ai-usage', domain: 'platform', capability: 'platform.admin' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/exports', domain: 'platform', capability: 'platform.export', alsoRequires: 'platform.admin',
    note: 'Compliance export job. §34 conjunction — see /certification/generate. Phase 2B-1 deliberately declined a blanket "/export → platform.export" rule for reads; for the mutation both authorities are required, which is the same principle, not a contradiction of it.' },
  { file: 'enterprise.ts', router: 'router', method: 'POST', path: '/api-keys', domain: 'platform', capability: 'platform.security',
    note: 'Mints a tenant API key. Credential issuance alters the security perimeter, which is the capability\'s stated purpose. Deliberately narrower than GET /enterprise/api-keys (platform.admin, {owner, admin}): a platform administrator may see which keys exist without being able to mint one.' },
  { file: 'enterprise.ts', router: 'router', method: 'DELETE', path: '/api-keys/:id', domain: 'platform', capability: 'platform.security' },

  { file: 'exports.ts', router: 'exportsRouter', method: 'POST', path: '/', domain: 'platform', capability: 'platform.export', alsoRequires: 'platform.admin',
    note: 'Data-warehouse export job. export_type accepts "audit", so this endpoint can stage the audit chain for download; §34 conjunction applies. GET /exports/:id and /:id/download are platform.admin.' },

  // ── platform: integrations ────────────────────────────────────────────────
  { file: 'integrationHub.ts', router: 'integrationHubRouter', method: 'POST', path: '/connect', domain: 'platform', capability: 'platform.integrations', note: 'Sibling POST /jobs/:id/complete is already platform.integrations.' },
  { file: 'integrationHub.ts', router: 'integrationHubRouter', method: 'POST', path: '/sync', domain: 'platform', capability: 'platform.integrations' },
  { file: 'integrationHub.ts', router: 'integrationHubRouter', method: 'POST', path: '/jobs/:id/fail', domain: 'platform', capability: 'platform.integrations' },

  { file: 'integrations.ts', router: 'integrationsRouter', method: 'POST', path: '/', domain: 'platform', capability: 'platform.integrations' },
  { file: 'integrations.ts', router: 'integrationsRouter', method: 'PATCH', path: '/:id', domain: 'platform', capability: 'platform.integrations' },
  { file: 'integrations.ts', router: 'integrationsRouter', method: 'POST', path: '/:id/test', domain: 'platform', capability: 'platform.integrations' },
  { file: 'integrations.ts', router: 'integrationsRouter', method: 'POST', path: '/:id/sync', domain: 'platform', capability: 'platform.integrations' },
  { file: 'integrations.ts', router: 'webhooksRouter', method: 'POST', path: '/', domain: 'platform', capability: 'platform.integrations',
    note: 'A webhook is standing configuration that forwards tenant events to an external URL. ADR-014 Phase 2C-2 §35 names standing rules explicitly; an unguarded create was a self-service exfiltration channel.' },
  { file: 'integrations.ts', router: 'webhooksRouter', method: 'PATCH', path: '/:id', domain: 'platform', capability: 'platform.integrations' },
  { file: 'integrations.ts', router: 'webhooksRouter', method: 'DELETE', path: '/:id', domain: 'platform', capability: 'platform.integrations' },

  // ── platform: policy and identity ─────────────────────────────────────────
  { file: 'policies.ts', router: 'policiesRouter', method: 'POST', path: '/', domain: 'platform', capability: 'platform.admin', note: 'Sibling POST /evaluate is platform.admin, GET / is platform.admin.' },
  { file: 'policies.ts', router: 'policiesRouter', method: 'PATCH', path: '/:id', domain: 'platform', capability: 'platform.admin' },

  { file: 'scim.ts', router: 'adminRouter', method: 'POST', path: '/tokens', domain: 'platform', capability: 'platform.identity',
    previousGuard: "requireRole('owner','admin') on the JWT role",
    note: 'Mints the provisioning credential that authenticates the /scim/v2 protocol router, which can create users and change roles. platform.identity holders are {owner, admin} — exactly the legacy set — so holder-neutral, and the stale-token read is fixed.' },
  { file: 'scim.ts', router: 'adminRouter', method: 'DELETE', path: '/tokens/:id', domain: 'platform', capability: 'platform.identity',
    previousGuard: "requireRole('owner','admin') on the JWT role" },

  { file: 'tenants.ts', router: 'router', method: 'PATCH', path: '/me', domain: 'platform', capability: 'platform.identity',
    previousGuard: "['owner','admin'] on the JWT role" },
  { file: 'tenants.ts', router: 'router', method: 'POST', path: '/me/users', domain: 'platform', capability: 'platform.identity',
    previousGuard: "['owner','admin'] on the JWT role",
    note: 'Creates a user with a caller-supplied role. Authorization-authority mutation — ADR-014 Phase 2C-2 §31. Holder-neutral swap; the stale-token read is fixed, so a demoted admin can no longer create users on an old token.' },
  { file: 'tenants.ts', router: 'router', method: 'PATCH', path: '/me/users/:userId', domain: 'platform', capability: 'platform.identity',
    previousGuard: "['owner','admin'] on the JWT role",
    note: 'Can write users.role. The handler\'s existing self-modification refusal is unchanged and still runs, so this cannot be used to promote oneself.' },
  { file: 'tenants.ts', router: 'router', method: 'DELETE', path: '/me/users/:userId', domain: 'platform', capability: 'platform.identity',
    previousGuard: "['owner','admin'] on the JWT role" },

  // ── §19/§22 unregistered-domain routes registered and protected here ──────
  { file: 'testResults.ts', router: 'testResultsRouter', method: 'POST', path: '/test-results', domain: 'commissioning', capability: 'commissioning.write',
    note: 'ADR-014 Phase 2C-2 §22, resolved from source rather than from the name: createTestResult refuses any payload whose test_pack does not exist in the caller\'s tenant AND project, and the service is cxExecution — the commissioning-execution service. testPacks.ts is already commissioning in the Phase 2B-2 read perimeter and the Phase 2C-1 mutation registry, so the child inherits the parent. The per-step verdict is ordinary execution work; pack acceptance and arbitration keep commissioning.approve.' },
  { file: 'testResults.ts', router: 'testResultsRouter', method: 'PATCH', path: '/test-results/:resultId', domain: 'commissioning', capability: 'commissioning.write' },

  { file: 'monteCarlo.ts', router: 'router', method: 'POST', path: '/runs', domain: 'commercial', capability: 'cost.write',
    note: 'The three monteCarlo reads are already MIXED_PAYLOAD_DELIVERY_READS guarded by cost.view because a run carries p10/p50/p80/p90 cost as well as schedule. The write inherits the same mixed-payload rule: cost.write is the narrower of {cost.write, schedule.write}, so one guard is no wider than either domain.' },

  { file: 'correlations.ts', router: 'router', method: 'POST', path: '/', domain: 'platform', capability: 'crossdomain.read',
    note: 'CLASSIFICATION CORRECTION — this is a read, not a mutation. findCorrelates issues no INSERT/UPDATE/DELETE; the route is POST only because the subject payload is nested. Its response ranks proximate events from audit_log, daily_logs, action_items, compliance_tasks and commissioning_packs, so no conjunction of domain capabilities is truthful — precisely the case ADR-014 Phase 2B-3 created crossdomain.read for.' },
]

/**
 * Operations this slice found to be consequential rather than ordinary, and
 * which are therefore registered in `transitions.ts` instead of above.
 *
 * ADR-014 Phase 2C-2 §42: correctness outranks counter stability. Both are new
 * discoveries, so the confirmed consequential-transition count moves 84 → 86.
 */
export interface NewlyConsequential {
  file: string; router: string; method: string; path: string
  capability: ServerCapability
  reason: string
}

export const NEWLY_DISCOVERED_CONSEQUENTIAL: readonly NewlyConsequential[] = [
  { file: 'portfolio.ts', router: 'router', method: 'POST', path: '/anomalies/:anomalyId/false-positive', capability: 'portfolio.approve',
    reason: 'An unguarded second path to an outcome the registry already protects. POST /anomalies/:anomalyId/resolve is a registered transition requiring portfolio.approve; markFalsePositive sets false_positive=true, which retires the same anomaly. Leaving it ordinary would let any authenticated principal dispose of portfolio anomalies while the canonical route required an approval capability.' },
  { file: 'costEntry.ts', router: 'costEntryRouter', method: 'POST', path: '/cost-entries/:id/post', capability: 'cost.approve',
    reason: 'Posts a draft cost entry to the ledger: it resolves the WBS entry and commits an actual cost that feeds EVM and cost control. Its inverse, POST /cost-entries/:id/void, already requires cost.approve, and postCostEntry is the only route out of draft. An operation whose undo needs approval authority must not be reachable with ordinary write authority.' },
]

/**
 * §20 decision table for the mutations that had no domain-registry entry at
 * entry to this slice. Every one is accounted for; none is left as a residual.
 */
export type UnregisteredAction =
  | 'REGISTER_AND_PROTECT_IN_2C2'
  | 'REGISTER_FOR_LATER_SLICE'
  | 'OWNER_POLICY_REQUIRED'
  | 'SERVICE_BOUNDARY'
  | 'PUBLIC_EXCEPTION'
  | 'CLASSIFICATION_CORRECTION'

export interface UnregisteredDecision {
  file: string; router: string; method: string; path: string
  action: UnregisteredAction
  /** The domain the repository evidence supports, when there is one. */
  domain?: string
  evidence: string
}

export const UNREGISTERED_MUTATION_DECISIONS: readonly UnregisteredDecision[] = [
  // ── PERSONAL_INBOX: registered by Phase 2B-2, deferred with its reads ──────
  // These were reported as "unregistered" at entry. They are not: Phase 2B-2
  // classified actions.ts, notifications.ts and personalAgent.ts as
  // PERSONAL_INBOX in DEFERRED_DELIVERY_READS — "the signed-in user's own
  // queue/inbox — Phase 1 governs it with personal.view". The reads are
  // themselves still deferred, there is no `personal.write` capability, and
  // `admin` does not hold `personal.view`. Inventing personal.write to close
  // the mutation half while the read half stays open would fail §27 and would
  // decide the personal-inbox policy this gate has no evidence for.
  ...(['PATCH /:id', 'POST /:id/relationships', 'POST /:id/sla/pause', 'POST /:id/sla/resume',
       'POST /delegations', 'PATCH /delegations/:id', 'DELETE /relationships/:relId',
       'POST /sla-rules', 'PATCH /sla-rules/:id'] as const).map(sig => {
    const [method, path] = sig.split(' ') as [string, string]
    return {
      file: 'actions.ts', router: 'actionsRouter', method, path,
      action: 'REGISTER_FOR_LATER_SLICE' as UnregisteredAction, domain: 'personal_inbox',
      evidence: 'actions.ts is classified PERSONAL_INBOX in DEFERRED_DELIVERY_READS (Phase 2B-2). No personal.write capability exists and the reads are still deferred.',
    }
  }),
  ...(['POST /notifications/:id/dismiss', 'POST /notifications/:id/read', 'POST /notifications/clear',
       'POST /notifications/read-all', 'POST /notifications/scan'] as const).map(sig => {
    const [method, path] = sig.split(' ') as [string, string]
    return {
      file: 'notifications.ts', router: 'notificationsRouter', method, path,
      action: 'REGISTER_FOR_LATER_SLICE' as UnregisteredAction, domain: 'personal_inbox',
      evidence: 'notifications.ts is classified PERSONAL_INBOX in DEFERRED_DELIVERY_READS (Phase 2B-2).',
    }
  }),
  ...(['POST /me/agent/ask', 'POST /me/agent/memory', 'DELETE /me/agent/memory/:key'] as const).map(sig => {
    const [method, path] = sig.split(' ') as [string, string]
    return {
      file: 'personalAgent.ts', router: 'router', method, path,
      action: 'REGISTER_FOR_LATER_SLICE' as UnregisteredAction, domain: 'personal_inbox',
      evidence: 'personalAgent.ts is classified PERSONAL_INBOX in DEFERRED_DELIVERY_READS (Phase 2B-2).',
    }
  }),

  // ── protected here ────────────────────────────────────────────────────────
  { file: 'testResults.ts', router: 'testResultsRouter', method: 'POST', path: '/test-results', action: 'REGISTER_AND_PROTECT_IN_2C2', domain: 'commissioning',
    evidence: 'createTestResult verifies the parent test_pack in the caller tenant+project; service is cxExecution; testPacks.ts is already commissioning in both the 2B-2 read perimeter and the 2C-1 mutation registry.' },
  { file: 'testResults.ts', router: 'testResultsRouter', method: 'PATCH', path: '/test-results/:resultId', action: 'REGISTER_AND_PROTECT_IN_2C2', domain: 'commissioning',
    evidence: 'Same parent-pack verification and the same service as POST /test-results.' },
  { file: 'monteCarlo.ts', router: 'router', method: 'POST', path: '/runs', action: 'REGISTER_AND_PROTECT_IN_2C2', domain: 'commercial',
    evidence: 'The same router\'s three reads are already registered MIXED_PAYLOAD_DELIVERY_READS under cost.view for carrying p10/p50/p80/p90 cost alongside schedule.' },
  { file: 'correlations.ts', router: 'router', method: 'POST', path: '/', action: 'CLASSIFICATION_CORRECTION', domain: 'crossdomain',
    evidence: 'Not a mutation: findCorrelates performs no write. A cross-domain read over audit_log, daily_logs, action_items, compliance_tasks and commissioning_packs — protected here with crossdomain.read.' },

  // ── boundaries that a user capability cannot express ──────────────────────
  ...(['POST /Users', 'PUT /Users/:id', 'PATCH /Users/:id', 'DELETE /Users/:id'] as const).map(sig => {
    const [method, path] = sig.split(' ') as [string, string]
    return {
      file: 'scim.ts', router: 'scimRouter', method, path,
      action: 'SERVICE_BOUNDARY' as UnregisteredAction, domain: 'identity_protocol',
      evidence: 'scimRouter carries a router-wide requireScimToken: a SHA-256 token-hash lookup against scim_tokens requiring is_active and honouring expires_at, which binds req.scimTenantId from the verified row. There is no user session, so no user capability can apply — the same conclusion Phase 2B-1 reached for the GET half of this router. Left in the pending count rather than reclassified, because the manifest\'s SERVICE_HMAC class means HMAC and this is a bearer token.',
    }
  }),
  { file: 'iot.ts', router: 'iotRouter', method: 'POST', path: '/iot/ingest', action: 'SERVICE_BOUNDARY', domain: 'construction',
    evidence: 'ADR-014 D5, closed in Phase 2C-2A. Hybrid by design and now deterministic: a 64-hex bearer credential commits the request to the verified service path, anything else to the session path under platform.integrations. Registered in HYBRID_AUTH_MUTATIONS; stays PENDING_PHASE2 because no census class truthfully describes "service credential OR user capability".' },
  { file: 'iot.ts', router: 'iotRouter', method: 'POST', path: '/sensors/:uid/readings', action: 'SERVICE_BOUNDARY', domain: 'construction',
    evidence: 'Identical hybrid model to POST /iot/ingest; closed by ADR-014 D6 in Phase 2C-2A and registered in HYBRID_AUTH_MUTATIONS.' },
  { file: 'denverMcp.ts', router: 'router', method: 'POST', path: '/call', action: 'CLASSIFICATION_CORRECTION', domain: 'dead_route',
    evidence: 'denverMcpRouter is never mounted in server.ts, so no request can reach the handler — the same DEAD_ROUTE conclusion Phase 2B-1 and Phase 2B-2 recorded for its GET half. Left in the pending count; the coverage model counts declarations, and removing a declaration to lower a counter is exactly what §37 forbids.' },
]

/**
 * High-sensitivity mutations left exactly as they behave today because the
 * authority decision is genuinely the owner's (ADR-014 Phase 2C-2 §53).
 *
 * None of these is described as protected. Each still carries whatever guard it
 * had, and each still reads the JWT role rather than the database — that is the
 * cost of not inventing the policy, and it is why they should not wait long.
 */
export interface PolicyDependentMutation {
  file: string; router: string; method: string; path: string
  current:   string
  candidates: string
  why:       string
}

export const POLICY_DEPENDENT_MUTATIONS: readonly PolicyDependentMutation[] = []

/**
 * ADR-014 Phase 2C-2A — the owner decisions that emptied the list above.
 *
 * Each entry names what the owner decided, what the route carried before, and
 * what it carries now. The ratchet asserts the route really does carry the
 * declared capability, so a reverted guard fails the build rather than leaving a
 * report that says "closed".
 */
export interface OwnerPolicyResolution {
  decision: 'D3' | 'D4' | 'D5' | 'D6' | 'D7'
  file: string; router: string; method: string; path: string
  before: string
  after:  string
  /** The capability now required of a *user* principal, when there is one. */
  capability?: ServerCapability
  rationale: string
}

export const OWNER_POLICY_RESOLUTIONS: readonly OwnerPolicyResolution[] = [
  { decision: 'D3',
    file: 'commissioning.ts', router: 'router', method: 'POST', path: '/credits',
    before: "_requireRole(req, res, 'owner', 'admin') — the JWT role claim",
    after:  "requireCapability('platform.admin') — the live database role",
    capability: 'platform.admin',
    rationale: 'Credit issuance is platform entitlement administration, not ordinary project cost approval: the route writes billing_credits with a caller-supplied delta that may add or remove entitlement, which is not the approval of a change order, estimate, invoice or pay application that cost.approve exists for. platform.admin already governs platform feature and usage administration and its holders are {owner, admin} — exactly the legacy role set — so the authority is preserved while the stale-token read is closed.' },

  { decision: 'D4',
    file: 'projects.ts', router: 'router', method: 'DELETE', path: '/:id',
    before: "['owner','admin'] on the JWT role, inline in the handler",
    after:  "requireCapability('project.delete') — a new capability held by owner alone",
    capability: 'project.delete',
    rationale: 'Hard deletion irreversibly removes the project root and the delivery and commercial history hanging off it. Reusing project.approve would have extended that to every project manager, a broadening explicitly rejected; project.write is ordinary editing. Under ADR-014 §27 the distinction is materially meaningful, no existing capability expresses it, and the real workflow needs it, so a new capability is authorised. Granted to owner only, and the holder set is asserted as an exact equality so an accidental future grant fails the ratchet.' },

  { decision: 'D5',
    file: 'iot.ts', router: 'iotRouter', method: 'POST', path: '/iot/ingest',
    before: 'requireAuth + requireTenant + a permissive ingestAuth that fell through to session authentication when the machine token failed',
    after:  "hybridIngestAuth('platform.integrations') — deterministic mode selection, fail-closed",
    capability: 'platform.integrations',
    rationale: 'See HYBRID_AUTH_MUTATIONS below.' },

  { decision: 'D6',
    file: 'iot.ts', router: 'iotRouter', method: 'POST', path: '/sensors/:uid/readings',
    before: 'requireAuth + requireTenant + the same permissive ingestAuth fall-through',
    after:  "hybridIngestAuth('platform.integrations') — deterministic mode selection, fail-closed",
    capability: 'platform.integrations',
    rationale: 'See HYBRID_AUTH_MUTATIONS below.' },

  { decision: 'D7',
    file: 'scim.ts', router: 'scimRouter', method: 'POST', path: '/Users',
    before: 'the supplied role was written to users.role with no validation — a live SCIM token could create or promote a user to owner',
    after:  '_rejectScimRole refuses `owner` and any role the repository does not define, on create, replace and patch alike',
    rationale: 'A SCIM provisioning credential federates identity; it is not business authority. owner holds every capability in the registry, so allowing the protocol to assign it made the provisioning token a route to full tenant control. Non-owner roles the protocol legitimately provisions today, admin included, are unchanged — this narrows one authority rather than redesigning SCIM role policy.' },
]

/**
 * Routes whose authentication model is legitimately EITHER a verified service
 * credential OR a user capability, and which therefore cannot be described by a
 * single census class.
 *
 * These stay numerically `PENDING_PHASE2`. That is deliberate and it is the
 * honest answer: the manifest's `SERVICE_HMAC` means HMAC and this is a bearer
 * token, `CAPABILITY` would claim a user capability always applies when for the
 * machine path there is no user at all, and inventing a class purely to move a
 * counter is what ADR-014 Phase 2C-2 §37 forbids. Their **authorization** status
 * is closed and proven; their **census** status is unchanged, and the two are
 * reported separately.
 *
 * The ratchet asserts, from source, that each route really does carry
 * `hybridIngestAuth('<capability>')` — so this cannot become a bucket that
 * unprotected routes are quietly moved into.
 */
export interface HybridAuthMutation {
  file: string; router: string; method: string; path: string
  /** The middleware whose presence in source the ratchet requires. */
  middleware: 'hybridIngestAuth'
  /** The capability a human caller must hold. */
  userCapability: ServerCapability
  /** How the machine path authenticates, and how its tenant is bound. */
  serviceCredential: string
  censusClass: 'PENDING_PHASE2'
  reason: string
}

export const HYBRID_AUTH_MUTATIONS: readonly HybridAuthMutation[] = [
  { file: 'iot.ts', router: 'iotRouter', method: 'POST', path: '/iot/ingest',
    middleware: 'hybridIngestAuth', userCapability: 'platform.integrations',
    serviceCredential: 'A 64-hex bearer ingest token, SHA-256-hashed and looked up in sensor_ingest_tokens with revoked_at IS NULL and expires_at honoured; tenant is bound from the verified row and no caller-supplied identifier can override it.',
    censusClass: 'PENDING_PHASE2',
    reason: 'Machine ingest and human integration use are both legitimate and carry different authority. Credential ISSUANCE stays platform.security on POST /sensors/tokens; ordinary integration USE by a session is platform.integrations. The two must not be collapsed merely because both concern IoT.' },
  { file: 'iot.ts', router: 'iotRouter', method: 'POST', path: '/sensors/:uid/readings',
    middleware: 'hybridIngestAuth', userCapability: 'platform.integrations',
    serviceCredential: 'Identical to POST /iot/ingest: the same 64-hex bearer token, the same hashed lookup with revocation and expiry honoured, and the same tenant binding taken from the verified row rather than from the request.',
    censusClass: 'PENDING_PHASE2',
    reason: 'Identical model to POST /iot/ingest; the single-reading webhook variant of the same surface.' },
]

/**
 * The write half of a deferral Phase 2B-2 already recorded on the read half.
 *
 * `PATCH /projects/:id` now requires `project.write`, but its `allowed` list
 * still contains budget, committed_cost, actual_cost and forecast_cost — cost
 * data whose *reads* are Owner-only. A project manager or engineer can
 * therefore write commercial columns they cannot read.
 *
 * This is not closed here, and it is not hidden. Phase 2B-2 registered
 * `projects.ts GET /:id` as MIXED_PAYLOAD_PHASE3 because the repository has no
 * bounded project DTO and separating the columns is field-level authorization.
 * The write side has the same shape and the same answer. Reserving the columns
 * instead was considered and rejected: `PATCH /:id` is their only writer — a
 * repository-wide search finds no other UPDATE of committed_cost — so reserving
 * them would leave no route able to set them at all.
 *
 * What did change: before this slice a viewer could write them.
 */
export const RESIDUAL_MIXED_PAYLOAD_WRITE = {
  file: 'projects.ts', router: 'router', method: 'PATCH', path: '/:id',
  fields: ['budget', 'committed_cost', 'actual_cost', 'forecast_cost', 'contingency_pct'],
  guardedBy: 'project.write',
  readAuthority: 'cost.view',
  deferredTo: 'Phase 3 record/field authorization — the same deferral as MIXED_PAYLOAD_PHASE3 on GET /:id',
} as const

/**
 * Endpoints reclassified out of the pending-mutation set by evidence rather
 * than by convenience. Kept here so the arithmetic is inspectable.
 */
export const RECLASSIFIED_MUTATIONS = [
  {
    file: 'tenants.ts', router: 'router', method: 'POST', path: '/',
    to: 'PUBLIC',
    evidence: 'Tenant self-registration. `router.use(requireAuth, requireTenant())` appears at line 110, AFTER this route is declared at line 45, so no authenticated session exists or can exist at this point — a capability guard here would make signup impossible. It carries its own registrationLimiter (5/hour/IP) and creates the tenant together with its first owner. Recorded as an ENDPOINT_EXCEPTION so the census states this rather than counting it as unprotected debt.',
  },
] as const
