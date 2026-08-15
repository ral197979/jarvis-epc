/**
 * Denver Engineering — project-delivery read perimeter (ADR-014 Phase 2B-2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2B-1 closed the six highest-sensitivity read domains. This closes the
 * ordinary delivery ones: a user may read a project-delivery domain through the
 * API only if their current authenticated server role holds the same functional
 * view capability that opens it in Phase 1.
 *
 * The capabilities here are Phase 1's, unchanged. No grant was invented: a
 * parity test asserts each holder set still equals the client projection, so an
 * engineer cannot acquire procurement through the API, and a platform
 * administrator acquires no delivery domain at all.
 *
 * Classification is by RETURNED INFORMATION, not by route file (§14). Two route
 * files illustrate why: `procurement.ts` mounts four routers, and its `/rfis`
 * and `/submittals` routers are construction reads, not procurement ones;
 * `safety.ts` serves quality-adjacent analytics that stay safety-domain because
 * that is what the payload contains.
 *
 * SCOPE. Functional authority at tenant level. A role holding `engineering.view`
 * can read engineering-domain records across the tenant, subject to tenant
 * isolation. Assigned-project scope needs a user↔project membership primitive
 * that does not exist, and is Phase 3.
 */
import type { ServerCapability } from './capabilities'

/** The twelve delivery domains this gate closes. */
export type DeliveryDomain =
  | 'project' | 'team' | 'schedule' | 'risk'
  | 'engineering' | 'docs' | 'construction' | 'field'
  | 'quality' | 'safety' | 'procurement' | 'commissioning'

export interface DeliveryRead {
  file:       string
  router:     string
  method:     string
  path:       string
  domain:     DeliveryDomain
  capability: ServerCapability
  note?:      string
}

/**
 * The capability that governs each domain — one mapping, so a route cannot be
 * registered under `quality` while carrying a `construction.view` guard.
 */
export const DELIVERY_DOMAIN_CAPABILITY: Record<DeliveryDomain, ServerCapability> = {
  project:       'project.view',
  team:          'team.view',
  schedule:      'schedule.view',
  risk:          'risk.view',
  engineering:   'engineering.view',
  docs:          'docs.view',
  construction:  'construction.view',
  field:         'field.view',
  quality:       'quality.view',
  safety:        'safety.view',
  procurement:   'procurement.view',
  commissioning: 'commissioning.view',
}

/**
 * Clean project-delivery reads — a single domain governs the whole response.
 */
export const PROJECT_DELIVERY_READS: readonly DeliveryRead[] = [

  // ── project → project.view ───────────────────────────
  { file: 'meetings.ts', router: 'meetingsRouter', method: 'GET', path: '/meetings/:id', domain: 'project', capability: 'project.view' },
  { file: 'meetings.ts', router: 'meetingsRouter', method: 'GET', path: '/meetings/:id/actions', domain: 'project', capability: 'project.view' },
  { file: 'meetings.ts', router: 'meetingsRouter', method: 'GET', path: '/meetings/:id/agenda', domain: 'project', capability: 'project.view' },
  { file: 'lifecycle.ts', router: 'router', method: 'GET', path: '/projects/:projectId/lifecycle', domain: 'project', capability: 'project.view' },
  { file: 'meetings.ts', router: 'meetingsRouter', method: 'GET', path: '/projects/:projectId/meetings', domain: 'project', capability: 'project.view' },
  { file: 'novaIntegrationStatus.ts', router: 'router', method: 'GET', path: '/projects/:projectId/nova-integration', domain: 'project', capability: 'project.view' },

  // ── team → team.view ─────────────────────────────────
  { file: 'team.ts', router: 'teamRouter', method: 'GET', path: '/projects/:projectId/team', domain: 'team', capability: 'team.view' },
  { file: 'timesheets.ts', router: 'timesheetsRouter', method: 'GET', path: '/projects/:projectId/timesheets', domain: 'team', capability: 'team.view' },
  { file: 'timesheets.ts', router: 'timesheetsRouter', method: 'GET', path: '/projects/:projectId/timesheets/summary', domain: 'team', capability: 'team.view' },
  { file: 'team.ts', router: 'teamRouter', method: 'GET', path: '/team/members', domain: 'team', capability: 'team.view' },
  { file: 'team.ts', router: 'teamRouter', method: 'GET', path: '/team/members/:id', domain: 'team', capability: 'team.view' },
  { file: 'team.ts', router: 'teamRouter', method: 'GET', path: '/team/members/:id/assignments', domain: 'team', capability: 'team.view' },
  { file: 'timesheets.ts', router: 'timesheetsRouter', method: 'GET', path: '/team/members/:memberId/timesheets', domain: 'team', capability: 'team.view' },
  { file: 'team.ts', router: 'teamRouter', method: 'GET', path: '/team/summary', domain: 'team', capability: 'team.view' },

  // ── schedule → schedule.view ─────────────────────────
  { file: 'scheduleImport.ts', router: 'scheduleImportRouter', method: 'GET', path: '/projects/:projectId/schedule/imports', domain: 'schedule', capability: 'schedule.view' },
  { file: 'schedule.ts', router: 'router', method: 'GET', path: '/:projectId/cpm', domain: 'schedule', capability: 'schedule.view' },
  { file: 'scheduleCriticalPath.ts', router: 'router', method: 'GET', path: '/:projectId/critical-path', domain: 'schedule', capability: 'schedule.view' },
  { file: 'schedule.ts', router: 'router', method: 'GET', path: '/:projectId/dependencies', domain: 'schedule', capability: 'schedule.view' },
  { file: 'scheduleForecast.ts', router: 'router', method: 'GET', path: '/:projectId/forecast', domain: 'schedule', capability: 'schedule.view' },
  { file: 'schedule.ts', router: 'router', method: 'GET', path: '/:projectId/tasks', domain: 'schedule', capability: 'schedule.view' },

  // ── risk → risk.view ─────────────────────────────────
  { file: 'riskRegister.ts', router: 'riskRegisterRouter', method: 'GET', path: '/projects/:projectId/risks', domain: 'risk', capability: 'risk.view' },
  { file: 'riskRegister.ts', router: 'riskRegisterRouter', method: 'GET', path: '/projects/:projectId/risks/summary', domain: 'risk', capability: 'risk.view' },
  { file: 'riskRegister.ts', router: 'riskRegisterRouter', method: 'GET', path: '/risks/:id', domain: 'risk', capability: 'risk.view' },

  // ── engineering → engineering.view ───────────────────
  { file: 'bim.ts', router: 'router', method: 'GET', path: '/bim-models/:id', domain: 'engineering', capability: 'engineering.view' },
  { file: 'bim.ts', router: 'router', method: 'GET', path: '/bim-models/:id/viewer-token', domain: 'engineering', capability: 'engineering.view' },
  { file: 'estimating.ts', router: 'router', method: 'GET', path: '/bim-models/:modelId/elements', domain: 'engineering', capability: 'engineering.view' },
  { file: 'estimating.ts', router: 'router', method: 'GET', path: '/bim-models/:modelId/elements/:id', domain: 'engineering', capability: 'engineering.view' },
  { file: 'estimating.ts', router: 'router', method: 'GET', path: '/bim-models/:modelId/parse-job', domain: 'engineering', capability: 'engineering.view' },
  { file: 'estimating.ts', router: 'router', method: 'GET', path: '/bim-models/:modelId/quantity-summary', domain: 'engineering', capability: 'engineering.view' },
  { file: 'estimating.ts', router: 'router', method: 'GET', path: '/bim-models/:modelId/takeoff', domain: 'engineering', capability: 'engineering.view' },
  { file: 'calculations.ts', router: 'router', method: 'GET', path: '/calc-sessions/:id', domain: 'engineering', capability: 'engineering.view' },
  { file: 'drawings.ts', router: 'router', method: 'GET', path: '/drawings/:id', domain: 'engineering', capability: 'engineering.view' },
  { file: 'drawings.ts', router: 'router', method: 'GET', path: '/drawings/:id/markups', domain: 'engineering', capability: 'engineering.view' },
  { file: 'drawings.ts', router: 'router', method: 'GET', path: '/drawings/:id/revisions', domain: 'engineering', capability: 'engineering.view' },
  { file: 'fixLibrary.ts', router: 'router', method: 'GET', path: '/', domain: 'engineering', capability: 'engineering.view' },
  { file: 'fixLibrary.ts', router: 'router', method: 'GET', path: '/_meta/symptoms', domain: 'engineering', capability: 'engineering.view' },
  { file: 'fixLibrary.ts', router: 'router', method: 'GET', path: '/:id', domain: 'engineering', capability: 'engineering.view' },
  { file: 'fixLibrary.ts', router: 'router', method: 'POST', path: '/search', domain: 'engineering', capability: 'engineering.view' },
  { file: 'bim.ts', router: 'router', method: 'GET', path: '/projects/:projectId/bim-issues', domain: 'engineering', capability: 'engineering.view' },
  { file: 'bim.ts', router: 'router', method: 'GET', path: '/projects/:projectId/bim-models', domain: 'engineering', capability: 'engineering.view' },
  { file: 'calculations.ts', router: 'router', method: 'GET', path: '/projects/:projectId/calc-sessions', domain: 'engineering', capability: 'engineering.view' },
  { file: 'drawings.ts', router: 'router', method: 'GET', path: '/projects/:projectId/drawings', domain: 'engineering', capability: 'engineering.view' },

  // ── docs → docs.view ─────────────────────────────────
  { file: 'files.ts', router: 'router', method: 'GET', path: '/documents', domain: 'docs', capability: 'docs.view' },
  { file: 'files.ts', router: 'router', method: 'GET', path: '/documents/:id', domain: 'docs', capability: 'docs.view' },
  { file: 'files.ts', router: 'router', method: 'GET', path: '/download/:token', domain: 'docs', capability: 'docs.view' },
  { file: 'files.ts', router: 'router', method: 'GET', path: '/folders', domain: 'docs', capability: 'docs.view' },
  { file: 'files.ts', router: 'router', method: 'GET', path: '/presign/:versionId', domain: 'docs', capability: 'docs.view' },
  { file: 'turnover.ts', router: 'router', method: 'GET', path: '/projects/:projectId/turnover-packages', domain: 'docs', capability: 'docs.view' },
  { file: 'transmittals.ts', router: 'router', method: 'GET', path: '/', domain: 'docs', capability: 'docs.view' },
  { file: 'transmittals.ts', router: 'router', method: 'GET', path: '/:id', domain: 'docs', capability: 'docs.view' },
  { file: 'transmittals.ts', router: 'router', method: 'GET', path: '/overdue', domain: 'docs', capability: 'docs.view' },

  // ── construction → construction.view ─────────────────
  { file: 'dailyLogs.ts', router: 'router', method: 'GET', path: '/daily-logs/:id', domain: 'construction', capability: 'construction.view' },
  { file: 'dailyLogs.ts', router: 'router', method: 'GET', path: '/projects/:projectId/daily-logs', domain: 'construction', capability: 'construction.view' },
  { file: 'iot.ts', router: 'authRouter', method: 'GET', path: '/projects/:projectId/sensors', domain: 'construction', capability: 'construction.view' },
  { file: 'iot.ts', router: 'authRouter', method: 'GET', path: '/projects/:projectId/sensors/alerts', domain: 'construction', capability: 'construction.view' },
  { file: 'procurement.ts', router: 'rfisRouter', method: 'GET', path: '/', domain: 'construction', capability: 'construction.view' },
  { file: 'iot.ts', router: 'authRouter', method: 'GET', path: '/sensors/:id', domain: 'construction', capability: 'construction.view' },
  { file: 'iot.ts', router: 'authRouter', method: 'GET', path: '/sensors/:id/readings', domain: 'construction', capability: 'construction.view' },
  { file: 'procurement.ts', router: 'submittalsRouter', method: 'GET', path: '/', domain: 'construction', capability: 'construction.view' },
  { file: 'submittalReview.ts', router: 'router', method: 'GET', path: '/:id/review', domain: 'construction', capability: 'construction.view' },

  // ── field → field.view ───────────────────────────────
  { file: 'fieldSync.ts', router: 'router', method: 'GET', path: '/operations', domain: 'field', capability: 'field.view' },
  { file: 'sync.ts', router: 'syncRouter', method: 'GET', path: '/conflicts', domain: 'field', capability: 'field.view' },

  // ── quality → quality.view ───────────────────────────
  { file: 'inspections.ts', router: 'router', method: 'GET', path: '/inspections/:id', domain: 'quality', capability: 'quality.view' },
  { file: 'ncr.ts', router: 'router', method: 'GET', path: '/ncrs/:id/capas', domain: 'quality', capability: 'quality.view' },
  { file: 'deficiencies.ts', router: 'deficienciesRouter', method: 'GET', path: '/projects/:projectId/deficiencies', domain: 'quality', capability: 'quality.view' },
  { file: 'inspections.ts', router: 'router', method: 'GET', path: '/projects/:projectId/inspection-templates', domain: 'quality', capability: 'quality.view' },
  { file: 'inspections.ts', router: 'router', method: 'GET', path: '/projects/:projectId/inspections', domain: 'quality', capability: 'quality.view' },
  { file: 'ncr.ts', router: 'router', method: 'GET', path: '/projects/:projectId/ncr-summary', domain: 'quality', capability: 'quality.view' },
  { file: 'ncr.ts', router: 'router', method: 'GET', path: '/projects/:projectId/ncrs', domain: 'quality', capability: 'quality.view' },
  { file: 'punchLists.ts', router: 'router', method: 'GET', path: '/projects/:projectId/punch-lists', domain: 'quality', capability: 'quality.view' },
  { file: 'qualityIntelligence.ts', router: 'router', method: 'GET', path: '/projects/:projectId/quality-intelligence', domain: 'quality', capability: 'quality.view' },
  { file: 'punchLists.ts', router: 'router', method: 'GET', path: '/punch-lists/:id', domain: 'quality', capability: 'quality.view' },
  { file: 'punchLists.ts', router: 'router', method: 'GET', path: '/punch-lists/:id/items', domain: 'quality', capability: 'quality.view' },

  // ── safety → safety.view ─────────────────────────────
  { file: 'compliance.ts', router: 'router', method: 'GET', path: '/', domain: 'safety', capability: 'safety.view' },
  { file: 'compliance.ts', router: 'router', method: 'GET', path: '/:id', domain: 'safety', capability: 'safety.view' },
  { file: 'safety.ts', router: 'router', method: 'GET', path: '/projects/:projectId/safety/incidents', domain: 'safety', capability: 'safety.view' },
  { file: 'safety.ts', router: 'router', method: 'GET', path: '/projects/:projectId/safety/intelligence', domain: 'safety', capability: 'safety.view' },
  { file: 'safety.ts', router: 'router', method: 'GET', path: '/projects/:projectId/safety/observations', domain: 'safety', capability: 'safety.view' },

  // ── procurement → procurement.view ───────────────────
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'GET', path: '/bid-packages/:id', domain: 'procurement', capability: 'procurement.view' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'GET', path: '/bid-packages/:id/submissions', domain: 'procurement', capability: 'procurement.view' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'GET', path: '/projects/:projectId/bid-packages', domain: 'procurement', capability: 'procurement.view' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'GET', path: '/projects/:projectId/bid-packages/summary', domain: 'procurement', capability: 'procurement.view' },
  { file: 'procurementRisk.ts', router: 'router', method: 'GET', path: '/projects/:projectId/procurement-risk', domain: 'procurement', capability: 'procurement.view' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'GET', path: '/projects/:projectId/subcontracts', domain: 'procurement', capability: 'procurement.view' },
  { file: 'vendorScorecard.ts', router: 'router', method: 'GET', path: '/projects/:projectId/vendor-scorecard', domain: 'procurement', capability: 'procurement.view' },
  { file: 'procurement.ts', router: 'purchaseOrdersRouter', method: 'GET', path: '/', domain: 'procurement', capability: 'procurement.view' },
  { file: 'procurement.ts', router: 'purchaseOrdersRouter', method: 'GET', path: '/:id', domain: 'procurement', capability: 'procurement.view' },
  { file: 'subcontracts.ts', router: 'subcontractsRouter', method: 'GET', path: '/subcontracts/:id', domain: 'procurement', capability: 'procurement.view' },
  { file: 'procurement.ts', router: 'vendorsRouter', method: 'GET', path: '/', domain: 'procurement', capability: 'procurement.view' },
  { file: 'procurement.ts', router: 'vendorsRouter', method: 'GET', path: '/:id', domain: 'procurement', capability: 'procurement.view' },

  // ── commissioning → commissioning.view ───────────────
  { file: 'autosignRules.ts', router: 'router', method: 'GET', path: '/', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'commissioning.ts', router: 'router', method: 'GET', path: '/balance', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'baselinesRoutes.ts', router: 'router', method: 'GET', path: '/', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'baselinesRoutes.ts', router: 'router', method: 'GET', path: '/:id', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'commissioning.ts', router: 'router', method: 'GET', path: '/jobs', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'commissioning.ts', router: 'router', method: 'GET', path: '/packs', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'commissioning.ts', router: 'router', method: 'GET', path: '/packs/:id', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'commissioning.ts', router: 'router', method: 'GET', path: '/packs/:id/download/:format', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'commissioning.ts', router: 'router', method: 'GET', path: '/uploads', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'commissioningItems.ts', router: 'commissioningItemsRouter', method: 'GET', path: '/projects/:projectId/commissioning-items', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'systems.ts', router: 'systemsRouter', method: 'GET', path: '/projects/:projectId/coverage', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'systems.ts', router: 'systemsRouter', method: 'GET', path: '/projects/:projectId/systems', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'systems.ts', router: 'systemsRouter', method: 'GET', path: '/projects/:projectId/tags', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'testPacks.ts', router: 'testPacksRouter', method: 'GET', path: '/projects/:projectId/test-packs', domain: 'commissioning', capability: 'commissioning.view' },
  { file: 'testPacks.ts', router: 'testPacksRouter', method: 'GET', path: '/test-packs/:packId', domain: 'commissioning', capability: 'commissioning.view' },]

/**
 * Reads that are in scope but whose response spans more than one protected
 * domain, and which can still be guarded because one capability is no wider
 * than every domain present.
 *
 * `requireAnyCapability(A, B)` is never correct here: it would hand the A-data
 * to a caller holding only B. The guard is always the most restrictive.
 */
export interface MixedDeliveryRead {
  file:       string
  router:     string
  method:     string
  path:       string
  capability: ServerCapability
  /** Every protected domain the response discloses. */
  contains:   readonly ServerCapability[]
  reason:     string
}

export const MIXED_PAYLOAD_DELIVERY_READS: readonly MixedDeliveryRead[] = [
  {
    file: 'monteCarlo.ts', router: 'router', method: 'GET', path: '/runs',
    capability: 'cost.view',
    contains: ['schedule.view', 'cost.view'],
    reason: 'Probabilistic schedule AND cost risk analysis — runs carry p10/p50/p80/p90 cost and per-iteration total_cost. cost.view holders {owner} are a subset of schedule.view holders, so one guard is no wider than either domain.',
  },
  {
    file: 'monteCarlo.ts', router: 'router', method: 'GET', path: '/runs/:id',
    capability: 'cost.view',
    contains: ['schedule.view', 'cost.view'],
    reason: 'Probabilistic schedule AND cost risk analysis — runs carry p10/p50/p80/p90 cost and per-iteration total_cost. cost.view holders {owner} are a subset of schedule.view holders, so one guard is no wider than either domain.',
  },
  {
    file: 'monteCarlo.ts', router: 'router', method: 'GET', path: '/runs/:id/distribution',
    capability: 'cost.view',
    contains: ['schedule.view', 'cost.view'],
    reason: 'Probabilistic schedule AND cost risk analysis — runs carry p10/p50/p80/p90 cost and per-iteration total_cost. cost.view holders {owner} are a subset of schedule.view holders, so one guard is no wider than either domain.',
  },]

/**
 * In-scope delivery reads that are confirmed but NOT yet protected.
 * Phase 2B-2 closes only when this is empty.
 */
export const PENDING_DELIVERY_READS: readonly DeliveryRead[] = []

export type DeferralCategory =
  /** AI, agent, adaptive, twin, ops — needs the cross-domain read policy pass. */
  | 'AI_READ_POLICY'
  /** The signed-in user's own queue/inbox — Phase 1 governs it with personal.view. */
  | 'PERSONAL_INBOX'
  /** Response mixes domains inseparably; needs record/field authorization (Phase 3). */
  | 'MIXED_PAYLOAD_PHASE3'
  /** Read-shaped by path, but the handler persists. Phase 2C. */
  | 'MUTATION'
  /** Authenticated by a service/protocol token, not a user session. */
  | 'PROTOCOL_AUTH'
  /** Router is never mounted — no request path to authorize. */
  | 'DEAD_ROUTE'

export interface DeferredRead {
  file:     string
  method:   string
  path:     string
  category: DeferralCategory
  reason:   string
}

/**
 * Every read-shaped endpoint the census surfaced that this gate does NOT close,
 * each with the reason it is out of scope. An unexplained omission and a
 * deliberate exclusion must not look the same.
 */
export const DEFERRED_DELIVERY_READS: readonly DeferredRead[] = [

  // ── AI_READ_POLICY ──
  { file: 'adaptive.ts', method: 'GET', path: '/anomaly-patterns', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/anomaly-patterns/:type', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/calibrate/drift/:type', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/feedback', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/feedback/health', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/feedback/signals/:type', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/feedback/source/:sourceType/:sourceId', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/forecast-accuracy', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/forecast-accuracy/stats/:type', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/memory', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/memory/:agentType/:scopeType/:key', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/outcomes/effectiveness', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/outcomes/top', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/rank/top', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/simulation-outcomes', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'adaptive.ts', method: 'GET', path: '/simulation-outcomes/stats', category: 'AI_READ_POLICY', reason: 'Phase-7 adaptive learning: feedback signals, forecast accuracy, model drift, agent memory. Cross-domain AI state whose domain ownership is not the route folder.' },
  { file: 'agentActionsRoutes.ts', method: 'GET', path: '/', category: 'AI_READ_POLICY', reason: 'Agent action log and review queue — agent governance state, not a project-delivery record.' },
  { file: 'agentActionsRoutes.ts', method: 'GET', path: '/_stats', category: 'AI_READ_POLICY', reason: 'Agent action log and review queue — agent governance state, not a project-delivery record.' },
  { file: 'agentActionsRoutes.ts', method: 'GET', path: '/:id', category: 'AI_READ_POLICY', reason: 'Agent action log and review queue — agent governance state, not a project-delivery record.' },
  { file: 'agents.ts', method: 'GET', path: '/', category: 'AI_READ_POLICY', reason: 'Multi-agent registry, objectives, tasks and executions. Agent authority is governed by ai.govern, not by a delivery capability.' },
  { file: 'agentApprovals.ts', method: 'GET', path: '/', category: 'AI_READ_POLICY', reason: 'Agent approval queue — governed by ai.govern policy, which this gate does not settle.' },
  { file: 'agentApprovals.ts', method: 'GET', path: '/:id', category: 'AI_READ_POLICY', reason: 'Agent approval queue — governed by ai.govern policy, which this gate does not settle.' },
  { file: 'agents.ts', method: 'GET', path: '/capabilities', category: 'AI_READ_POLICY', reason: 'Multi-agent registry, objectives, tasks and executions. Agent authority is governed by ai.govern, not by a delivery capability.' },
  { file: 'agents.ts', method: 'GET', path: '/executions', category: 'AI_READ_POLICY', reason: 'Multi-agent registry, objectives, tasks and executions. Agent authority is governed by ai.govern, not by a delivery capability.' },
  { file: 'agents.ts', method: 'GET', path: '/executions/:id', category: 'AI_READ_POLICY', reason: 'Multi-agent registry, objectives, tasks and executions. Agent authority is governed by ai.govern, not by a delivery capability.' },
  { file: 'agentMemory.ts', method: 'GET', path: '/', category: 'AI_READ_POLICY', reason: 'Agent memory store spanning every domain the agents touch.' },
  { file: 'agentMemory.ts', method: 'GET', path: '/:agentType/:scopeType/:scopeId/:key', category: 'AI_READ_POLICY', reason: 'Agent memory store spanning every domain the agents touch.' },
  { file: 'agentMemory.ts', method: 'GET', path: '/:entryId/links', category: 'AI_READ_POLICY', reason: 'Agent memory store spanning every domain the agents touch.' },
  { file: 'agents.ts', method: 'GET', path: '/objectives', category: 'AI_READ_POLICY', reason: 'Multi-agent registry, objectives, tasks and executions. Agent authority is governed by ai.govern, not by a delivery capability.' },
  { file: 'agentReadiness.ts', method: 'GET', path: '/plan/:scope/:id', category: 'AI_READ_POLICY', reason: 'Readiness agent plan — agent-generated cross-domain synthesis.' },
  { file: 'agentRisk.ts', method: 'GET', path: '/overview', category: 'AI_READ_POLICY', reason: 'Risk agent overview — agent-generated synthesis, not the project risk register.' },
  { file: 'agents.ts', method: 'GET', path: '/tasks', category: 'AI_READ_POLICY', reason: 'Multi-agent registry, objectives, tasks and executions. Agent authority is governed by ai.govern, not by a delivery capability.' },
  { file: 'agents.ts', method: 'GET', path: '/tasks/:id', category: 'AI_READ_POLICY', reason: 'Multi-agent registry, objectives, tasks and executions. Agent authority is governed by ai.govern, not by a delivery capability.' },
  { file: 'aiGovernance.ts', method: 'GET', path: '/recommendations', category: 'AI_READ_POLICY', reason: 'AI recommendation queue and preview. Its transitions already require ai.govern; the read policy belongs with them.' },
  { file: 'aiGovernance.ts', method: 'POST', path: '/recommendations', category: 'AI_READ_POLICY', reason: 'AI recommendation queue and preview. Its transitions already require ai.govern; the read policy belongs with them.' },
  { file: 'aiGovernance.ts', method: 'GET', path: '/recommendations/:id/preview', category: 'AI_READ_POLICY', reason: 'AI recommendation queue and preview. Its transitions already require ai.govern; the read policy belongs with them.' },
  { file: 'copilot.ts', method: 'GET', path: '/copilot/coordination', category: 'AI_READ_POLICY', reason: 'Project Copilot focus briefings, coordination and narrative reports — cross-domain synthesis that reaches into schedule, risk, quality and commercial state at once.' },
  { file: 'copilot.ts', method: 'GET', path: '/copilot/focus', category: 'AI_READ_POLICY', reason: 'Project Copilot focus briefings, coordination and narrative reports — cross-domain synthesis that reaches into schedule, risk, quality and commercial state at once.' },
  { file: 'copilot.ts', method: 'GET', path: '/copilot/projects/:projectId/coordination', category: 'AI_READ_POLICY', reason: 'Project Copilot focus briefings, coordination and narrative reports — cross-domain synthesis that reaches into schedule, risk, quality and commercial state at once.' },
  { file: 'copilot.ts', method: 'GET', path: '/copilot/projects/:projectId/focus', category: 'AI_READ_POLICY', reason: 'Project Copilot focus briefings, coordination and narrative reports — cross-domain synthesis that reaches into schedule, risk, quality and commercial state at once.' },
  { file: 'copilot.ts', method: 'GET', path: '/copilot/projects/:projectId/narrative-report', category: 'AI_READ_POLICY', reason: 'Project Copilot focus briefings, coordination and narrative reports — cross-domain synthesis that reaches into schedule, risk, quality and commercial state at once.' },
  { file: 'copilot.ts', method: 'GET', path: '/copilot/projects/:projectId/report', category: 'AI_READ_POLICY', reason: 'Project Copilot focus briefings, coordination and narrative reports — cross-domain synthesis that reaches into schedule, risk, quality and commercial state at once.' },
  { file: 'copilot.ts', method: 'GET', path: '/copilot/report', category: 'AI_READ_POLICY', reason: 'Project Copilot focus briefings, coordination and narrative reports — cross-domain synthesis that reaches into schedule, risk, quality and commercial state at once.' },
  { file: 'evidence.ts', method: 'GET', path: '/:id', category: 'AI_READ_POLICY', reason: 'Evidence attachments linked to entities of any type; the payload domain follows the linked entity, so one delivery capability cannot govern it.' },
  { file: 'evidence.ts', method: 'GET', path: '/entity/:type/:id', category: 'AI_READ_POLICY', reason: 'Evidence attachments linked to entities of any type; the payload domain follows the linked entity, so one delivery capability cannot govern it.' },
  { file: 'ops.ts', method: 'GET', path: '/blockers', category: 'AI_READ_POLICY', reason: 'Operations command centre: action, incident, escalation and readiness roll-ups spanning delivery domains. Putting it under platform.admin would hand Admin project-delivery data, which ADR-014 forbids.' },
  { file: 'ops.ts', method: 'GET', path: '/escalations', category: 'AI_READ_POLICY', reason: 'Operations command centre: action, incident, escalation and readiness roll-ups spanning delivery domains. Putting it under platform.admin would hand Admin project-delivery data, which ADR-014 forbids.' },
  { file: 'ops.ts', method: 'GET', path: '/live-feed', category: 'AI_READ_POLICY', reason: 'Operations command centre: action, incident, escalation and readiness roll-ups spanning delivery domains. Putting it under platform.admin would hand Admin project-delivery data, which ADR-014 forbids.' },
  { file: 'ops.ts', method: 'GET', path: '/overview', category: 'AI_READ_POLICY', reason: 'Operations command centre: action, incident, escalation and readiness roll-ups spanning delivery domains. Putting it under platform.admin would hand Admin project-delivery data, which ADR-014 forbids.' },
  { file: 'ops.ts', method: 'GET', path: '/readiness', category: 'AI_READ_POLICY', reason: 'Operations command centre: action, incident, escalation and readiness roll-ups spanning delivery domains. Putting it under platform.admin would hand Admin project-delivery data, which ADR-014 forbids.' },
  { file: 'ops.ts', method: 'GET', path: '/recommendations', category: 'AI_READ_POLICY', reason: 'Operations command centre: action, incident, escalation and readiness roll-ups spanning delivery domains. Putting it under platform.admin would hand Admin project-delivery data, which ADR-014 forbids.' },
  { file: 'optimization.ts', method: 'GET', path: '/proposals', category: 'AI_READ_POLICY', reason: 'Phase-7 resource optimisation and strategy proposals — cross-domain optimisation output.' },
  { file: 'optimization.ts', method: 'GET', path: '/proposals/summary', category: 'AI_READ_POLICY', reason: 'Phase-7 resource optimisation and strategy proposals — cross-domain optimisation output.' },
  { file: 'optimization.ts', method: 'GET', path: '/resources', category: 'AI_READ_POLICY', reason: 'Phase-7 resource optimisation and strategy proposals — cross-domain optimisation output.' },
  { file: 'optimization.ts', method: 'GET', path: '/resources/balance-plan', category: 'AI_READ_POLICY', reason: 'Phase-7 resource optimisation and strategy proposals — cross-domain optimisation output.' },
  { file: 'autoCoordination.ts', method: 'GET', path: '/projects/:projectId/coordination/recommendations', category: 'AI_READ_POLICY', reason: 'Autonomous coordination recommendations — AI recommend/approve/execute surface governed by ai.govern.' },
  { file: 'fieldAssistant.ts', method: 'GET', path: '/projects/:projectId/field-assistant', category: 'AI_READ_POLICY', reason: 'AI field assistant — assistant surface, not a field record read.' },
  { file: 'readiness.ts', method: 'GET', path: '/overview', category: 'AI_READ_POLICY', reason: 'Ava readiness engine scores for project/system/subsystem — computed across commissioning, quality and schedule state.' },
  { file: 'readiness.ts', method: 'GET', path: '/project/:id', category: 'AI_READ_POLICY', reason: 'Ava readiness engine scores for project/system/subsystem — computed across commissioning, quality and schedule state.' },
  { file: 'readiness.ts', method: 'GET', path: '/project/:id/history', category: 'AI_READ_POLICY', reason: 'Ava readiness engine scores for project/system/subsystem — computed across commissioning, quality and schedule state.' },
  { file: 'readiness.ts', method: 'GET', path: '/subsystem/:id', category: 'AI_READ_POLICY', reason: 'Ava readiness engine scores for project/system/subsystem — computed across commissioning, quality and schedule state.' },
  { file: 'readiness.ts', method: 'GET', path: '/system/:id', category: 'AI_READ_POLICY', reason: 'Ava readiness engine scores for project/system/subsystem — computed across commissioning, quality and schedule state.' },
  { file: 'rfiCopilot.ts', method: 'GET', path: '/:id/copilot', category: 'AI_READ_POLICY', reason: 'RFI Copilot precedent/responder/impact — assistant surface over construction data.' },
  { file: 'scenarios.ts', method: 'GET', path: '/', category: 'AI_READ_POLICY', reason: 'Scenario simulation and temporal twin replay/diff/velocity — twin-derived cross-domain projection.' },
  { file: 'scenarios.ts', method: 'GET', path: '/:scenarioId', category: 'AI_READ_POLICY', reason: 'Scenario simulation and temporal twin replay/diff/velocity — twin-derived cross-domain projection.' },
  { file: 'scenarios.ts', method: 'GET', path: '/projection/:twinId', category: 'AI_READ_POLICY', reason: 'Scenario simulation and temporal twin replay/diff/velocity — twin-derived cross-domain projection.' },
  { file: 'scenarios.ts', method: 'GET', path: '/temporal/:twinId/at', category: 'AI_READ_POLICY', reason: 'Scenario simulation and temporal twin replay/diff/velocity — twin-derived cross-domain projection.' },
  { file: 'scenarios.ts', method: 'GET', path: '/temporal/:twinId/diff', category: 'AI_READ_POLICY', reason: 'Scenario simulation and temporal twin replay/diff/velocity — twin-derived cross-domain projection.' },
  { file: 'scenarios.ts', method: 'GET', path: '/temporal/:twinId/replay', category: 'AI_READ_POLICY', reason: 'Scenario simulation and temporal twin replay/diff/velocity — twin-derived cross-domain projection.' },
  { file: 'scenarios.ts', method: 'GET', path: '/temporal/:twinId/trend/:field', category: 'AI_READ_POLICY', reason: 'Scenario simulation and temporal twin replay/diff/velocity — twin-derived cross-domain projection.' },
  { file: 'scenarios.ts', method: 'GET', path: '/temporal/:twinId/velocity', category: 'AI_READ_POLICY', reason: 'Scenario simulation and temporal twin replay/diff/velocity — twin-derived cross-domain projection.' },
  { file: 'simulation.ts', method: 'GET', path: '/', category: 'AI_READ_POLICY', reason: 'Ava simulation and replay engine — cross-domain computation, not a delivery record read.' },
  { file: 'simulation.ts', method: 'GET', path: '/:id/results', category: 'AI_READ_POLICY', reason: 'Ava simulation and replay engine — cross-domain computation, not a delivery record read.' },
  { file: 'twin.ts', method: 'GET', path: '/', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'GET', path: '/:twinId', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'GET', path: '/:twinId/impact', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'GET', path: '/:twinId/relationships', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'GET', path: '/:twinId/risk-propagation', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'GET', path: '/:twinId/snapshots', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'GET', path: '/:twinId/snapshots/:snapshotId', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'GET', path: '/:twinId/snapshots/latest', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'GET', path: '/:twinId/state', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'PATCH', path: '/:twinId/status', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'GET', path: '/:twinId/traverse', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'GET', path: '/entity/:entityType/:entityId', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },
  { file: 'twin.ts', method: 'GET', path: '/graph/overview', category: 'AI_READ_POLICY', reason: 'Digital-twin registry, snapshots, graph traversal, impact and risk propagation — synthesises across every delivery domain.' },

  // ── DEAD_ROUTE ──
  { file: 'denverMcp.ts', method: 'GET', path: '/tools', category: 'DEAD_ROUTE', reason: 'denverMcpRouter is never mounted in server.ts, so no request can reach it. Carried unchanged from Phase 2B-1.' },

  // ── MIXED_PAYLOAD_PHASE3 ──
  { file: 'projects.ts', method: 'GET', path: '/:id', category: 'MIXED_PAYLOAD_PHASE3', reason: 'Returns projects.* — the row carries budget, committed_cost, actual_cost, forecast_cost and contingency_pct, which are cost.view data, alongside the project context every delivery role needs. project.view would disclose the commercial columns; cost.view would stop every non-owner opening a project. The repository has no bounded project DTO, and building one is field-level authorization — Phase 3. Explicitly outside the Phase 2B-2 PASS claim.' },
  { file: 'related.ts', method: 'GET', path: '/related/:source/:id', category: 'MIXED_PAYLOAD_PHASE3', reason: 'Cross-module related-records aggregator. RELATED_SOURCES spans rfi, submittal, drawing, inspection, punch, ncr, capa and changeorder, so a single response mixes construction, engineering, quality and change-order (cost.view) records — identifiers, titles and statuses, no amounts. The domain set is parameterised by :source AND by what each source links to, so no single capability is both safe and useful. Response-shaping is Phase 3. Explicitly outside the Phase 2B-2 PASS claim.' },

  // ── MUTATION ──
  { file: 'enterprise.ts', method: 'POST', path: '/deployment/health/check', category: 'MUTATION', reason: 'Read-shaped by path but persists: ticket status update, export-job creation, health-check record. Carried unchanged from Phase 2B-1 — Phase 2C.' },
  { file: 'enterprise.ts', method: 'POST', path: '/exports', category: 'MUTATION', reason: 'Read-shaped by path but persists: ticket status update, export-job creation, health-check record. Carried unchanged from Phase 2B-1 — Phase 2C.' },
  { file: 'enterprise.ts', method: 'PATCH', path: '/tickets/:id/status', category: 'MUTATION', reason: 'Read-shaped by path but persists: ticket status update, export-job creation, health-check record. Carried unchanged from Phase 2B-1 — Phase 2C.' },
  { file: 'subcontracts.ts', method: 'PATCH', path: '/subcontracts/:id/status', category: 'MUTATION', reason: 'Matches the read-shaped path sweep on /status but transitions a subcontract. An ordinary mutation — Phase 2C.' },

  // ── PERSONAL_INBOX ──
  { file: 'actions.ts', method: 'GET', path: '/', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/:id', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/:id/dependencies', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/:id/relationships', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/:id/timeline', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/analytics/overview', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/analytics/trends', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/analytics/workload', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/delegations', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/inbox', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/my', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/overdue', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/sla-rules', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'actions.ts', method: 'GET', path: '/summary', category: 'PERSONAL_INBOX', reason: 'Global Action Center: personal queues, delegations, SLA rules and workload analytics. Phase 1 governs these with personal.view, not a delivery capability.' },
  { file: 'personalAgent.ts', method: 'GET', path: '/me/agent/briefing', category: 'PERSONAL_INBOX', reason: 'Per-user agent briefing and memory — the signed-in user’s own surface.' },
  { file: 'personalAgent.ts', method: 'GET', path: '/me/agent/memory', category: 'PERSONAL_INBOX', reason: 'Per-user agent briefing and memory — the signed-in user’s own surface.' },
  { file: 'myWork.ts', method: 'GET', path: '/my-work', category: 'PERSONAL_INBOX', reason: 'The signed-in user’s universal personal queue — personal.view in Phase 1.' },
  { file: 'notifications.ts', method: 'GET', path: '/notifications', category: 'PERSONAL_INBOX', reason: 'Personal notification inbox and unread count — personal.view in Phase 1.' },
  { file: 'notifications.ts', method: 'GET', path: '/notifications/count', category: 'PERSONAL_INBOX', reason: 'Personal notification inbox and unread count — personal.view in Phase 1.' },

  // ── PROTOCOL_AUTH ──
  { file: 'scim.ts', method: 'GET', path: '/Schemas', category: 'PROTOCOL_AUTH', reason: 'SCIM 2.0 protocol endpoints on scimRouter, authenticated by a provisioning bearer token with no user session. Carried unchanged from Phase 2B-1.' },
  { file: 'scim.ts', method: 'GET', path: '/ServiceProviderConfig', category: 'PROTOCOL_AUTH', reason: 'SCIM 2.0 protocol endpoints on scimRouter, authenticated by a provisioning bearer token with no user session. Carried unchanged from Phase 2B-1.' },
  { file: 'scim.ts', method: 'GET', path: '/Users', category: 'PROTOCOL_AUTH', reason: 'SCIM 2.0 protocol endpoints on scimRouter, authenticated by a provisioning bearer token with no user session. Carried unchanged from Phase 2B-1.' },
  { file: 'scim.ts', method: 'GET', path: '/Users/:id', category: 'PROTOCOL_AUTH', reason: 'SCIM 2.0 protocol endpoints on scimRouter, authenticated by a provisioning bearer token with no user session. Carried unchanged from Phase 2B-1.' },]
