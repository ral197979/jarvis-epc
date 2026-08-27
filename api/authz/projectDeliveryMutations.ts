/**
 * Denver Engineering — project-delivery mutation perimeter (ADR-014 Phase 2C-1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2B-2 decided who may *read* the twelve delivery domains. This decides
 * who may *change* them. Until now every one of these endpoints was
 * authentication-only: any signed-in principal of any role — including `viewer`
 * — could create a drawing revision, edit an NCR, delete a punch item or import
 * a schedule.
 *
 * The capability is the write half of the same domain pair Phase 2B-2 already
 * established, and no grant was invented: `<domain>.write` already existed in
 * the capability registry with its holder set, and this gate only attaches it
 * to the routes that mutate that domain. An engineer therefore cannot acquire
 * procurement, and a platform administrator acquires no delivery domain at all
 * (ADR-014 D2 — platform administration is not business authority).
 *
 * Domain assignment is inherited from `projectDeliveryReads.ts`, keyed by
 * file + router, so this gate cannot invent a second taxonomy. That keying
 * matters: `procurement.ts` mounts four routers, and its `/rfis` and
 * `/submittals` routers are construction, not procurement.
 *
 * SCOPE — ordinary writes only. Anything that approves, closes, certifies,
 * commits money or issues a credential is NOT here; it is either an already
 * registered consequential transition (`transitions.ts`), a state guarded by
 * `transitionStates.ts`, or an escalation recorded in
 * `ESCALATED_DELIVERY_MUTATIONS` below. Attaching `<domain>.write` to a
 * consequential operation would hand approval authority to every writer, which
 * is the exact defect Phase 2A-2 closed.
 *
 * Tenant scope is unchanged and independent: capability decides *whether* a
 * principal may write the domain, tenant context decides *which rows*.
 */
import type { ServerCapability } from './capabilities'
import type { DeliveryDomain } from './projectDeliveryReads'

export interface DeliveryMutation {
  file:   string
  router: string
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path:   string
  domain: DeliveryDomain
  note?:  string
}

/**
 * The write capability that governs each delivery domain — the exact mirror of
 * `DELIVERY_DOMAIN_CAPABILITY`, so a route cannot be registered under `quality`
 * while carrying a `construction.write` guard.
 */
export const DELIVERY_DOMAIN_WRITE_CAPABILITY: Record<DeliveryDomain, ServerCapability> = {
  project:       'project.write',
  team:          'team.write',
  schedule:      'schedule.write',
  risk:          'risk.write',
  engineering:   'engineering.write',
  docs:          'docs.write',
  construction:  'construction.write',
  field:         'field.write',
  quality:       'quality.write',
  safety:        'safety.write',
  procurement:   'procurement.write',
  commissioning: 'commissioning.write',
}

/** Ordinary project-delivery mutations, guarded by their domain's write capability. */
export const PROJECT_DELIVERY_MUTATIONS: readonly DeliveryMutation[] = [
  { file: 'bim.ts', router: 'router', method: 'POST', path: '/projects/:projectId/bim-models', domain: 'engineering' },
  { file: 'bim.ts', router: 'router', method: 'PATCH', path: '/bim-models/:id', domain: 'engineering' },
  { file: 'bim.ts', router: 'router', method: 'DELETE', path: '/bim-models/:id', domain: 'engineering' },
  { file: 'bim.ts', router: 'router', method: 'POST', path: '/projects/:projectId/bim-issues', domain: 'engineering' },
  { file: 'bim.ts', router: 'router', method: 'PATCH', path: '/bim-issues/:id', domain: 'engineering' },
  { file: 'calculations.ts', router: 'router', method: 'POST', path: '/projects/:projectId/calc-sessions', domain: 'engineering' },
  { file: 'calculations.ts', router: 'router', method: 'PATCH', path: '/calc-sessions/:id', domain: 'engineering' },
  { file: 'calculations.ts', router: 'router', method: 'DELETE', path: '/calc-sessions/:id', domain: 'engineering' },
  { file: 'commissioning.ts', router: 'router', method: 'POST', path: '/uploads/text-ingest', domain: 'commissioning' },
  { file: 'commissioning.ts', router: 'router', method: 'POST', path: '/generate-draft', domain: 'commissioning',
    note: 'Debits one commissioning credit. Spending a purchased resource on the intended operator workflow is an ordinary commissioning write; GRANTING credits is escalated below.' },
  { file: 'commissioning.ts', router: 'router', method: 'POST', path: '/packs/manual', domain: 'commissioning' },
  { file: 'commissioning.ts', router: 'router', method: 'PATCH', path: '/packs/:id/review', domain: 'commissioning',
    note: 'Saves review notes and moves the pack to ready_for_review. Phase 2A confirmed it accepts notes only — it records no verdict, so it is a write, not an approval.' },
  { file: 'commissioningItems.ts', router: 'commissioningItemsRouter', method: 'POST', path: '/commissioning-items', domain: 'commissioning' },
  { file: 'commissioningItems.ts', router: 'commissioningItemsRouter', method: 'PATCH', path: '/commissioning-items/:itemId', domain: 'commissioning' },
  { file: 'compliance.ts', router: 'router', method: 'POST', path: '/', domain: 'safety' },
  { file: 'compliance.ts', router: 'router', method: 'PATCH', path: '/:id', domain: 'safety' },
  { file: 'dailyLogs.ts', router: 'router', method: 'POST', path: '/projects/:projectId/daily-logs', domain: 'construction' },
  { file: 'dailyLogs.ts', router: 'router', method: 'PATCH', path: '/daily-logs/:id', domain: 'construction' },
  { file: 'dailyLogs.ts', router: 'router', method: 'DELETE', path: '/daily-logs/:id', domain: 'construction' },
  { file: 'deficiencies.ts', router: 'deficienciesRouter', method: 'POST', path: '/deficiencies', domain: 'quality' },
  { file: 'deficiencies.ts', router: 'deficienciesRouter', method: 'PATCH', path: '/deficiencies/:deficiencyId', domain: 'quality' },
  { file: 'drawings.ts', router: 'router', method: 'POST', path: '/projects/:projectId/drawings', domain: 'engineering' },
  { file: 'drawings.ts', router: 'router', method: 'PATCH', path: '/drawings/:id', domain: 'engineering' },
  { file: 'drawings.ts', router: 'router', method: 'DELETE', path: '/drawings/:id', domain: 'engineering' },
  { file: 'drawings.ts', router: 'router', method: 'POST', path: '/drawings/:id/revisions', domain: 'engineering' },
  { file: 'drawings.ts', router: 'router', method: 'POST', path: '/drawings/:id/markups', domain: 'engineering' },
  { file: 'drawings.ts', router: 'router', method: 'PATCH', path: '/markups/:markupId', domain: 'engineering' },
  { file: 'drawings.ts', router: 'router', method: 'DELETE', path: '/markups/:markupId', domain: 'engineering' },
  { file: 'estimating.ts', router: 'router', method: 'POST', path: '/bim-models/:modelId/parse-elements', domain: 'engineering' },
  { file: 'estimating.ts', router: 'router', method: 'POST', path: '/bim-models/:modelId/parse-job', domain: 'engineering' },
  { file: 'estimating.ts', router: 'router', method: 'POST', path: '/bim-models/:modelId/elements/:id/link', domain: 'engineering' },
  { file: 'estimating.ts', router: 'router', method: 'POST', path: '/bim-models/:modelId/takeoff', domain: 'engineering' },
  { file: 'estimating.ts', router: 'router', method: 'POST', path: '/bim-models/:modelId/takeoff/auto', domain: 'engineering' },
  { file: 'estimating.ts', router: 'router', method: 'POST', path: '/estimates', domain: 'engineering',
    note: 'Cross-domain by design: estimating.ts is engineering for reads (Phase 2B-2), so creating an estimate is engineering.write. Approving one stays cost.approve on /estimates/:id/approve.' },
  { file: 'estimating.ts', router: 'router', method: 'POST', path: '/estimates/:id/lines', domain: 'engineering' },
  { file: 'estimating.ts', router: 'router', method: 'POST', path: '/bim-models/:modelId/ava-estimate', domain: 'engineering' },
  { file: 'fieldSync.ts', router: 'router', method: 'POST', path: '/batch', domain: 'field' },
  { file: 'files.ts', router: 'router', method: 'POST', path: '/request-upload', domain: 'docs' },
  { file: 'files.ts', router: 'router', method: 'PUT', path: '/upload/:token', domain: 'docs' },
  { file: 'files.ts', router: 'router', method: 'POST', path: '/confirm/:versionId', domain: 'docs' },
  { file: 'files.ts', router: 'router', method: 'PATCH', path: '/documents/:id', domain: 'docs' },
  { file: 'files.ts', router: 'router', method: 'DELETE', path: '/documents/:id', domain: 'docs' },
  { file: 'files.ts', router: 'router', method: 'POST', path: '/folders', domain: 'docs' },
  { file: 'fixLibrary.ts', router: 'router', method: 'POST', path: '/', domain: 'engineering' },
  { file: 'fixLibrary.ts', router: 'router', method: 'PATCH', path: '/:id', domain: 'engineering' },
  { file: 'inspections.ts', router: 'router', method: 'POST', path: '/inspection-templates', domain: 'quality' },
  { file: 'inspections.ts', router: 'router', method: 'PATCH', path: '/inspection-templates/:id', domain: 'quality' },
  { file: 'inspections.ts', router: 'router', method: 'POST', path: '/projects/:projectId/inspections', domain: 'quality' },
  { file: 'inspections.ts', router: 'router', method: 'PATCH', path: '/inspections/:id', domain: 'quality' },
  { file: 'iot.ts', router: 'authRouter', method: 'POST', path: '/projects/:projectId/sensors', domain: 'construction' },
  { file: 'iot.ts', router: 'authRouter', method: 'PATCH', path: '/sensors/:id/thresholds', domain: 'construction' },
  { file: 'iot.ts', router: 'authRouter', method: 'POST', path: '/sensors/alerts/:alertId/acknowledge', domain: 'construction',
    note: 'Records who acknowledged a sensor alert. Comparable to dismissing a notification, which Phase 2A already classified an ordinary write; it resolves nothing.' },
  { file: 'meetings.ts', router: 'meetingsRouter', method: 'POST', path: '/projects/:projectId/meetings', domain: 'project' },
  { file: 'meetings.ts', router: 'meetingsRouter', method: 'PATCH', path: '/meetings/:id', domain: 'project' },
  { file: 'meetings.ts', router: 'meetingsRouter', method: 'POST', path: '/meetings/:id/agenda', domain: 'project' },
  { file: 'meetings.ts', router: 'meetingsRouter', method: 'PATCH', path: '/meetings/:id/agenda/:itemId', domain: 'project' },
  { file: 'meetings.ts', router: 'meetingsRouter', method: 'DELETE', path: '/meetings/:id/agenda/:itemId', domain: 'project' },
  { file: 'meetings.ts', router: 'meetingsRouter', method: 'POST', path: '/meetings/:id/actions', domain: 'project' },
  { file: 'ncr.ts', router: 'router', method: 'POST', path: '/projects/:projectId/ncrs', domain: 'quality' },
  { file: 'ncr.ts', router: 'router', method: 'PATCH', path: '/ncrs/:id', domain: 'quality' },
  { file: 'ncr.ts', router: 'router', method: 'POST', path: '/ncrs/:id/capas', domain: 'quality' },
  { file: 'ncr.ts', router: 'router', method: 'PATCH', path: '/capas/:id', domain: 'quality' },
  { file: 'ncr.ts', router: 'router', method: 'POST', path: '/projects/:projectId/ncrs/auto-raise', domain: 'quality',
    note: 'Bulk-creates NCRs from failed inspections. Creation only — the resulting NCRs still need quality.verify to close.' },
  { file: 'procurement.ts', router: 'vendorsRouter', method: 'POST', path: '/', domain: 'procurement' },
  { file: 'procurement.ts', router: 'vendorsRouter', method: 'PATCH', path: '/:id', domain: 'procurement' },
  { file: 'procurement.ts', router: 'purchaseOrdersRouter', method: 'POST', path: '/', domain: 'procurement' },
  { file: 'procurement.ts', router: 'purchaseOrdersRouter', method: 'PATCH', path: '/:id', domain: 'procurement' },
  { file: 'procurement.ts', router: 'rfisRouter', method: 'POST', path: '/', domain: 'construction' },
  { file: 'procurement.ts', router: 'rfisRouter', method: 'POST', path: '/:id/respond', domain: 'construction',
    note: 'Answering an RFI supplies information rather than deciding an outcome — the classification Phase 2A-2 recorded and this gate preserves.' },
  { file: 'procurement.ts', router: 'submittalsRouter', method: 'POST', path: '/', domain: 'construction' },
  { file: 'procurement.ts', router: 'submittalsRouter', method: 'PATCH', path: '/:id', domain: 'construction' },
  { file: 'punchLists.ts', router: 'router', method: 'POST', path: '/projects/:projectId/punch-lists', domain: 'quality' },
  { file: 'punchLists.ts', router: 'router', method: 'PATCH', path: '/punch-lists/:id', domain: 'quality' },
  { file: 'punchLists.ts', router: 'router', method: 'DELETE', path: '/punch-lists/:id', domain: 'quality' },
  { file: 'punchLists.ts', router: 'router', method: 'POST', path: '/punch-lists/:id/items', domain: 'quality' },
  { file: 'punchLists.ts', router: 'router', method: 'PATCH', path: '/punch-items/:id', domain: 'quality' },
  { file: 'punchLists.ts', router: 'router', method: 'DELETE', path: '/punch-items/:id', domain: 'quality' },
  { file: 'riskRegister.ts', router: 'riskRegisterRouter', method: 'POST', path: '/projects/:projectId/risks', domain: 'risk' },
  { file: 'riskRegister.ts', router: 'riskRegisterRouter', method: 'PATCH', path: '/risks/:id', domain: 'risk' },
  { file: 'safety.ts', router: 'router', method: 'POST', path: '/projects/:projectId/safety/observations', domain: 'safety' },
  { file: 'safety.ts', router: 'router', method: 'PATCH', path: '/safety/observations/:id', domain: 'safety',
    note: 'Writes status including closed. Closure is on the owner backlog for a future workflow-authority review; until then it stays ordinary, and safety.write is a strict tightening of what was authentication-only.' },
  { file: 'safety.ts', router: 'router', method: 'POST', path: '/projects/:projectId/safety/incidents', domain: 'safety' },
  { file: 'safety.ts', router: 'router', method: 'PATCH', path: '/safety/incidents/:id', domain: 'safety',
    note: 'Same as observations, and the more material of the two: incident closure ends an investigation. Backlog item preserved unresolved; safety.write only stops any authenticated principal doing it.' },
  { file: 'schedule.ts', router: 'router', method: 'POST', path: '/:projectId/tasks', domain: 'schedule' },
  { file: 'schedule.ts', router: 'router', method: 'PATCH', path: '/tasks/:id', domain: 'schedule' },
  { file: 'schedule.ts', router: 'router', method: 'DELETE', path: '/tasks/:id', domain: 'schedule' },
  { file: 'schedule.ts', router: 'router', method: 'POST', path: '/:projectId/dependencies', domain: 'schedule' },
  { file: 'schedule.ts', router: 'router', method: 'DELETE', path: '/dependencies/:id', domain: 'schedule' },
  { file: 'scheduleCriticalPath.ts', router: 'router', method: 'POST', path: '/:projectId/what-if', domain: 'schedule' },
  { file: 'scheduleImport.ts', router: 'scheduleImportRouter', method: 'POST', path: '/projects/:projectId/schedule/import', domain: 'schedule' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'POST', path: '/projects/:projectId/bid-packages', domain: 'procurement' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'POST', path: '/bid-packages/:id/submissions', domain: 'procurement' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'POST', path: '/projects/:projectId/subcontracts', domain: 'procurement' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'POST', path: '/subcontracts/:id/invoices', domain: 'procurement' },
  { file: 'sync.ts', router: 'syncRouter', method: 'POST', path: '/register', domain: 'field' },
  { file: 'sync.ts', router: 'syncRouter', method: 'POST', path: '/upload', domain: 'field' },
  { file: 'sync.ts', router: 'syncRouter', method: 'POST', path: '/pull', domain: 'field' },
  { file: 'systems.ts', router: 'systemsRouter', method: 'POST', path: '/projects/:projectId/systems', domain: 'commissioning' },
  { file: 'systems.ts', router: 'systemsRouter', method: 'PATCH', path: '/systems/:systemId', domain: 'commissioning' },
  { file: 'systems.ts', router: 'systemsRouter', method: 'POST', path: '/systems/:systemId/subsystems', domain: 'commissioning' },
  { file: 'systems.ts', router: 'systemsRouter', method: 'PATCH', path: '/subsystems/:subsystemId', domain: 'commissioning' },
  { file: 'systems.ts', router: 'systemsRouter', method: 'POST', path: '/systems/:systemId/tags', domain: 'commissioning' },
  { file: 'systems.ts', router: 'systemsRouter', method: 'PATCH', path: '/tags/:tagId', domain: 'commissioning' },
  { file: 'team.ts', router: 'teamRouter', method: 'POST', path: '/team/members', domain: 'team' },
  { file: 'team.ts', router: 'teamRouter', method: 'PATCH', path: '/team/members/:id', domain: 'team' },
  { file: 'testPacks.ts', router: 'testPacksRouter', method: 'POST', path: '/test-packs', domain: 'commissioning' },
  { file: 'testPacks.ts', router: 'testPacksRouter', method: 'PATCH', path: '/test-packs/:packId', domain: 'commissioning' },
  { file: 'timesheets.ts', router: 'timesheetsRouter', method: 'PUT', path: '/projects/:projectId/timesheets', domain: 'team' },
  { file: 'transmittals.ts', router: 'router', method: 'POST', path: '/', domain: 'docs' },
  { file: 'transmittals.ts', router: 'router', method: 'POST', path: '/:id/respond', domain: 'docs' },
  { file: 'turnover.ts', router: 'router', method: 'POST', path: '/projects/:projectId/turnover-packages', domain: 'docs' },
  { file: 'turnover.ts', router: 'router', method: 'PATCH', path: '/turnover-packages/:id', domain: 'docs' },]

/**
 * Delivery-file mutations deliberately NOT given `<domain>.write` in this gate.
 *
 * Every one of these already carries an owner/admin check today, or issues a
 * credential, or moves money. Attaching the domain write capability would be a
 * policy change in both directions at once — it would grant the operation to
 * project managers, engineers and field operatives who cannot perform it now,
 * and simultaneously remove the platform administrator who can. Neither
 * direction is inferable from the repository, so each is reported for an owner
 * decision and left exactly as it behaves today (ADR-014 Phase 2C-1 §8).
 */
export interface EscalatedDeliveryMutation {
  file:    string
  router:  string
  method:  string
  path:    string
  domain:  DeliveryDomain
  /** What it does that is not an ordinary domain write. */
  reason:  string
  /** What guards it today. */
  current: string
}

export const ESCALATED_DELIVERY_MUTATIONS: readonly EscalatedDeliveryMutation[] = [
  { file: 'commissioning.ts', router: 'router', method: 'POST', path: '/credits', domain: 'commissioning',
    reason: 'Inserts into billing_credits — it grants a purchased resource, which is a commercial act sitting in a '
          + 'commissioning route file. Spending a credit (/generate-draft) is ordinary commissioning work and IS '
          + 'guarded by commissioning.write; granting one is not. Belongs with the Commercial Mutation slice.',
    current: "_requireRole(req, res, 'owner', 'admin') on the JWT role" },
  { file: 'iot.ts', router: 'authRouter', method: 'POST', path: '/sensors/tokens', domain: 'construction',
    reason: 'Mints a 90-day bearer ingest token that writes to the tenant ingest endpoints, returned once and never '
          + 'shown again. That is credential issuance, not construction work; construction.write is held by engineer '
          + 'and field_ops, who have no evident authority to create tenant ingest credentials. Reads as platform.security.',
    current: 'authentication only' },
  { file: 'autosignRules.ts', router: 'router', method: 'POST', path: '/', domain: 'commissioning',
    reason: 'Autosign rules decide what gets signed without a human — configuring them is at least as consequential as '
          + 'the /arbitrate transition they drive, which already requires commissioning.approve.',
    current: "_requireAdmin — ['owner','admin'] on the JWT role" },
  { file: 'autosignRules.ts', router: 'router', method: 'PATCH', path: '/:id', domain: 'commissioning',
    reason: 'Editing a rule is the same control surface as creating one — a changed predicate silently alters which '
          + 'documents the arbitration transition signs without human review, and does so retroactively for every '
          + 'later run.',
    current: "_requireAdmin — ['owner','admin'] on the JWT role" },
  { file: 'autosignRules.ts', router: 'router', method: 'DELETE', path: '/:id', domain: 'commissioning',
    reason: 'Removing an autosign rule silently changes what the arbitration transition will do.',
    current: "_requireAdmin — ['owner','admin'] on the JWT role" },
  { file: 'baselinesRoutes.ts', router: 'router', method: 'DELETE', path: '/:id', domain: 'commissioning',
    reason: 'Destroys the commissioning baseline every later comparison is measured against. Deletion of a controlled '
          + 'reference artifact is not an ordinary write.',
    current: "_requireAdmin — ['owner','admin'] on the JWT role" },
  { file: 'compliance.ts', router: 'router', method: 'DELETE', path: '/:id', domain: 'safety',
    reason: 'Deleting a compliance task removes the obligation outright — strictly more consequential than waiving it, '
          + 'and /:id/waive and /:id/complete both already require safety.approve.',
    current: "_requireAdmin — ['owner','admin'] on the JWT role" },
  { file: 'fixLibrary.ts', router: 'router', method: 'DELETE', path: '/:id', domain: 'engineering',
    reason: 'Removes a knowledge-corpus fix whose verification transition is governed by assistant.admin, not by '
          + 'engineering.write. The delete should follow the same authority as the verify it undoes.',
    current: "_requireAdmin — ['owner','admin'] on the JWT role" },
]
