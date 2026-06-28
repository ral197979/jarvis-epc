/**
 * Adapter layer — the single seam between the new UI and Denver business logic.
 *
 * Each function maps to a real `/api/v1` endpoint (noted in comments). With
 * `USE_MOCKS` true it resolves fixture data; to go live, replace the mock branch
 * with the `api<T>(...)` call already shown. Screens never import mock data
 * directly — they only call these adapters (via the React Query hooks).
 */
import { mock, USE_MOCKS } from './http'
import * as db from './mock/data'
import { fetchProjectsLive, fetchProjectLive, createProjectLive, fetchPortfolioKpisLive } from './live/projectsLive'
import {
  fetchDeficienciesLive,
  fetchEquipmentLive,
  createDeficiencyLive,
  updateDeficiencyStatusLive,
  fetchTestPacksLive,
  severityToCategory,
} from './live/commissioningLive'
import { fetchPurchaseOrdersLive, fetchVendorsLive } from './live/procurementLive'
import { fetchEvmSummaryLive, fetchEvmTrendLive } from './live/financeLive'
import { fetchLeadsLive, fetchFunnelLive } from './live/crmLive'
import { fetchDrawingsLive, fetchDocumentsLive, fetchActionsLive } from './live/registriesLive'
import { fetchContractsLive, fetchChangeOrdersLive } from './live/contractsLive'
import { fetchTwinAssetsLive } from './live/twinLive'
import { fetchAdminUsersLive, fetchFeatureGatesLive } from './live/adminLive'
import type {
  PortfolioKpis,
  Project,
  NewProjectInput,
  Milestone,
  Deliverable,
  Risk,
  TeamMember,
  ActivityItem,
  AiInsight,
  MatrixSystem,
  CommissioningKpis,
  Equipment,
  Deficiency,
  NewDeficiencyInput,
  TestPack,
  PfcItem,
  FptScript,
  IstSequence,
  TurnoverPackage,
  Lead,
  PurchaseOrder,
  LongLeadItem,
  Vendor,
  EvmSummary,
  WbsLine,
  EvmTrendPoint,
  DrawingRecord,
  DocumentRecord,
  ActionItem,
  TwinAsset,
  Contract,
  ChangeOrder,
  AdminUser,
  FeatureGate,
  MaterialItem,
  Requisition,
  ReceivingRecord,
  GanttTask,
  Activity,
  WbsNode,
  BaselineRow,
  ResourceLoad,
  RiskEntry,
  ContingencyItem,
  MaintenanceTask,
  AssetRecord,
  LifecycleRow,
  VendorScore,
  Scenario,
  ComplianceItem,
  SafetyIncident,
  TrainingRecord,
  CloseoutItem,
  CashFlowPoint,
  DrawdownRequest,
  SafetyAudit,
  SiteAccessBadge,
  ReportTemplate,
  GeneratedReport,
  MitigationPlan,
  ResourceShift,
  FieldAssignment,
  SyncItem,
} from './types'

// ── Portfolio / Dashboard ────────────────────────────────────────────────────
export const portfolioAdapter = {
  // Client-side aggregate over GET /api/v1/projects  ·  LIVE-WIRED
  kpis: (): Promise<PortfolioKpis> => (USE_MOCKS ? mock(db.portfolioKpis) : fetchPortfolioKpisLive()),
  // GET /api/v1/projects  ·  LIVE-WIRED (see live/projectsLive.ts)
  // Fresh copy so createProject surfaces on refetch in mock mode.
  projects: (): Promise<Project[]> => (USE_MOCKS ? mock(db.projects.slice()) : fetchProjectsLive()),
  // GET /api/v1/ask/insights  (grounded RAG)
  insights: (): Promise<AiInsight[]> => (USE_MOCKS ? mock(db.aiInsights) : Promise.reject('live not wired')),
  risks: (): Promise<Risk[]> => (USE_MOCKS ? mock(db.risks) : Promise.reject('live not wired')),
  // POST /api/v1/projects  ·  LIVE-WIRED (write)
  createProject: (input: NewProjectInput): Promise<Project> => {
    if (!USE_MOCKS) return createProjectLive(input)
    const fmt = (n?: number) =>
      n
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1, trailingZeroDisplay: 'stripIfInteger' }).format(n)
        : '—'
    const created: Project = {
      id: input.code,
      code: input.code,
      name: input.name,
      client: input.client ?? '—',
      region: input.region ?? '—',
      phase: input.phase ?? 'Planning',
      health: 'healthy',
      budgetStatus: 'Healthy',
      scheduleStatus: 'On Track',
      safetyStatus: 'No Incidents',
      qualityPct: 100,
      progressPct: 0,
      contractValue: fmt(input.budget),
      lat: 0,
      lng: 0,
    }
    db.projects.unshift(created) // session-local; refetch surfaces it
    return mock(created, 150)
  },
}

// ── Project Workspace ────────────────────────────────────────────────────────
export const projectAdapter = {
  // GET /api/v1/projects/:id  ·  LIVE-WIRED (see live/projectsLive.ts)
  get: (id: string): Promise<Project | undefined> =>
    USE_MOCKS ? mock(db.projects.find((p) => p.id === id)) : fetchProjectLive(id),
  milestones: (_id: string): Promise<Milestone[]> => (USE_MOCKS ? mock(db.milestones) : Promise.reject('x')),
  deliverables: (_id: string): Promise<Deliverable[]> => (USE_MOCKS ? mock(db.deliverables) : Promise.reject('x')),
  risks: (_id: string): Promise<Risk[]> => (USE_MOCKS ? mock(db.risks) : Promise.reject('x')),
  team: (_id: string): Promise<TeamMember[]> => (USE_MOCKS ? mock(db.team) : Promise.reject('x')),
  activity: (_id: string): Promise<ActivityItem[]> => (USE_MOCKS ? mock(db.activity) : Promise.reject('x')),
}

// ── Commissioning ────────────────────────────────────────────────────────────
export const commissioningAdapter = {
  // GET /api/v1/commissioning/kpis
  kpis: (): Promise<CommissioningKpis> => (USE_MOCKS ? mock(db.commissioningKpis) : Promise.reject('x')),
  // GET /api/v1/systems  (completion matrix)
  matrix: (): Promise<MatrixSystem[]> => (USE_MOCKS ? mock(db.matrixSystems) : Promise.reject('x')),
  // GET /api/v1/projects/:projectId/tags  ·  LIVE-WIRED
  equipment: (projectId?: string): Promise<Equipment[]> =>
    USE_MOCKS ? mock(db.equipment) : fetchEquipmentLive(projectId ?? ''),
  // GET /api/v1/projects/:projectId/deficiencies  ·  LIVE-WIRED
  // Mock returns a fresh copy each call so React Query / TanStack Table see a new
  // reference after createDeficiency mutates the fixture (live returns fresh data anyway).
  deficiencies: (projectId?: string): Promise<Deficiency[]> =>
    USE_MOCKS ? mock(db.deficiencies.slice()) : fetchDeficienciesLive(projectId ?? ''),
  // POST /api/v1/deficiencies  ·  LIVE-WIRED (write)
  createDeficiency: (input: NewDeficiencyInput): Promise<Deficiency> => {
    if (!USE_MOCKS) return createDeficiencyLive(input)
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
    const created: Deficiency = {
      id: input.code,
      uuid: input.code,
      description: input.title,
      category: severityToCategory(input.severity),
      severity: cap(input.severity),
      system: '—',
      contractor: '—',
      status: cap(input.status ?? 'open'),
      loggedAt: new Date().toISOString().slice(0, 10),
    }
    db.deficiencies.unshift(created) // session-local; refetch surfaces it
    return mock(created, 150)
  },
  // PATCH /api/v1/deficiencies/:id  ·  LIVE-WIRED (write — status update)
  updateDeficiencyStatus: (deficiency: Deficiency, status: string): Promise<Deficiency> => {
    if (!USE_MOCKS) return updateDeficiencyStatusLive(deficiency.uuid ?? deficiency.id, status)
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
    const idx = db.deficiencies.findIndex((d) => d.id === deficiency.id)
    // Immutable replace (not in-place mutation) so React Query / TanStack detect the change.
    const updated = { ...(idx >= 0 ? db.deficiencies[idx] : deficiency), status: cap(status) }
    if (idx >= 0) db.deficiencies[idx] = updated
    return mock(updated, 150)
  },
  // GET /api/v1/projects/:projectId/test-packs  ·  LIVE-WIRED
  testPacks: (projectId?: string): Promise<TestPack[]> =>
    USE_MOCKS ? mock(db.testPacks.slice()) : fetchTestPacksLive(projectId ?? ''),
  // ── Phase 3 (mock only — no live endpoints yet; see docs/MIGRATION_ROADMAP.md) ──
  pfc: (): Promise<PfcItem[]> => (USE_MOCKS ? mock(db.pfcItems.slice()) : Promise.reject('pfc endpoint not available')),
  fptScripts: (): Promise<FptScript[]> => (USE_MOCKS ? mock(db.fptScripts.slice()) : Promise.reject('fpt endpoint not available')),
  istSequences: (): Promise<IstSequence[]> => (USE_MOCKS ? mock(db.istSequences.slice()) : Promise.reject('ist endpoint not available')),
  turnoverPackages: (): Promise<TurnoverPackage[]> => (USE_MOCKS ? mock(db.turnoverPackages.slice()) : Promise.reject('turnover endpoint not available')),
}

// ── CRM (Proposals & Bid Pipeline) ───────────────────────────────────────────
export const crmAdapter = {
  // GET /api/v1/proposals  ·  LIVE-WIRED
  leads: (): Promise<Lead[]> => (USE_MOCKS ? mock(db.leads) : fetchLeadsLive()),
  // GET /api/v1/proposals/summary  ·  LIVE-WIRED
  funnel: (): Promise<typeof db.crmFunnel> => (USE_MOCKS ? mock(db.crmFunnel) : fetchFunnelLive()),
}

// ── Procurement ──────────────────────────────────────────────────────────────
export const procurementAdapter = {
  // GET /api/v1/purchase-orders  ·  LIVE-WIRED
  pos: (): Promise<PurchaseOrder[]> =>
    USE_MOCKS ? mock(db.purchaseOrders) : fetchPurchaseOrdersLive(),
  // No dedicated long-lead endpoint yet — mock only (see docs/ADAPTER_STRATEGY.md).
  longLead: (): Promise<LongLeadItem[]> => (USE_MOCKS ? mock(db.longLead) : Promise.reject('long-lead endpoint not available')),
  // GET /api/v1/vendors  ·  LIVE-WIRED
  vendors: (): Promise<Vendor[]> => (USE_MOCKS ? mock(db.vendors) : fetchVendorsLive()),
  // Vendor performance scorecard / strategic matrix — mock (would extend /vendors with KPIs).
  vendorScores: (): Promise<VendorScore[]> => (USE_MOCKS ? mock(db.vendorScores.slice()) : Promise.reject('vendor scores live not wired')),
}

// ── Inventory / Materials ────────────────────────────────────────────────────
export const inventoryAdapter = {
  materials: (): Promise<MaterialItem[]> => (USE_MOCKS ? mock(db.materials.slice()) : Promise.reject('materials endpoint not available')),
  requisitions: (): Promise<Requisition[]> => (USE_MOCKS ? mock(db.requisitions.slice()) : Promise.reject('requisitions endpoint not available')),
  receiving: (): Promise<ReceivingRecord[]> => (USE_MOCKS ? mock(db.receiving.slice()) : Promise.reject('receiving endpoint not available')),
}

// ── Schedule / Primavera P6 bridge ───────────────────────────────────────────
export const scheduleAdapter = {
  // Existing API: /api/v1/schedule (CPM + tasks) + /scheduleImport (P6 XER/XML).
  gantt: (): Promise<GanttTask[]> => (USE_MOCKS ? mock(db.ganttTasks.slice()) : Promise.reject('schedule live not wired')),
  activities: (): Promise<Activity[]> => (USE_MOCKS ? mock(db.activities.slice()) : Promise.reject('activities endpoint: /api/v1/schedule')),
  wbs: (): Promise<WbsNode[]> => (USE_MOCKS ? mock(db.wbsNodes.slice()) : Promise.reject('wbs endpoint: /api/v1/schedule')),
  baselines: (): Promise<BaselineRow[]> => (USE_MOCKS ? mock(db.baselineRows.slice()) : Promise.reject('baselines endpoint not available')),
  resourceLoad: (): Promise<ResourceLoad[]> => (USE_MOCKS ? mock(db.resourceLoad.slice()) : Promise.reject('resource-load endpoint not available')),
}

// ── Risk ─────────────────────────────────────────────────────────────────────
export const riskAdapter = {
  // Existing API: /api/v1/riskRegister + /risks.
  entries: (): Promise<RiskEntry[]> => (USE_MOCKS ? mock(db.riskEntries.slice()) : Promise.reject('risk endpoint: /api/v1/riskRegister')),
  contingency: (): Promise<ContingencyItem[]> => (USE_MOCKS ? mock(db.contingencyItems.slice()) : Promise.reject('contingency endpoint not available')),
}

// ── Maintenance / Asset lifecycle ────────────────────────────────────────────
export const maintenanceAdapter = {
  tasks: (): Promise<MaintenanceTask[]> => (USE_MOCKS ? mock(db.maintenanceTasks.slice()) : Promise.reject('maintenance endpoint not available')),
  assets: (): Promise<AssetRecord[]> => (USE_MOCKS ? mock(db.assetRecords.slice()) : Promise.reject('asset-register endpoint not available')),
  lifecycle: (): Promise<LifecycleRow[]> => (USE_MOCKS ? mock(db.lifecycleRows.slice()) : Promise.reject('lifecycle endpoint not available')),
}

// ── Scenario modeler ─────────────────────────────────────────────────────────
export const scenarioAdapter = {
  list: (): Promise<Scenario[]> => (USE_MOCKS ? mock(db.scenarios.slice()) : Promise.reject('scenarios endpoint not available')),
}

// ── Safety ───────────────────────────────────────────────────────────────────
export const safetyAdapter = {
  incidents: (): Promise<SafetyIncident[]> => (USE_MOCKS ? mock(db.safetyIncidents.slice()) : Promise.reject('safety endpoint not available')),
  training: (): Promise<TrainingRecord[]> => (USE_MOCKS ? mock(db.trainingRecords.slice()) : Promise.reject('training endpoint not available')),
  audits: (): Promise<SafetyAudit[]> => (USE_MOCKS ? mock(db.safetyAudits.slice()) : Promise.reject('audits endpoint not available')),
  siteAccess: (): Promise<SiteAccessBadge[]> => (USE_MOCKS ? mock(db.siteAccessBadges.slice()) : Promise.reject('site-access endpoint not available')),
}

// ── Project Closeout ─────────────────────────────────────────────────────────
export const closeoutAdapter = {
  ledger: (): Promise<CloseoutItem[]> => (USE_MOCKS ? mock(db.closeoutItems.slice()) : Promise.reject('closeout endpoint not available')),
}

// ── AI Mitigation / Resource Reallocation ───────────────────────────────────
export const mitigationAdapter = {
  plans: (): Promise<MitigationPlan[]> => (USE_MOCKS ? mock(db.mitigationPlans.slice()) : Promise.reject('mitigation endpoint not available')),
  shifts: (): Promise<ResourceShift[]> => (USE_MOCKS ? mock(db.resourceShifts.slice()) : Promise.reject('resource-shift endpoint not available')),
}

// ── Mobile field flows ───────────────────────────────────────────────────────
export const mobileAdapter = {
  assignments: (): Promise<FieldAssignment[]> => (USE_MOCKS ? mock(db.fieldAssignments.slice()) : Promise.reject('field assignments endpoint not available')),
  syncQueue: (): Promise<SyncItem[]> => (USE_MOCKS ? mock(db.syncQueue.slice()) : Promise.reject('field-sync endpoint: /api/v1/field-sync')),
}

// ── Reports Center ───────────────────────────────────────────────────────────
export const reportsAdapter = {
  // Existing API has /api/v1/exports + /reports; map there when wiring live.
  templates: (): Promise<ReportTemplate[]> => (USE_MOCKS ? mock(db.reportTemplates.slice()) : Promise.reject('reports endpoint not available')),
  recent: (): Promise<GeneratedReport[]> => (USE_MOCKS ? mock(db.generatedReports.slice()) : Promise.reject('reports endpoint not available')),
}

// ── Finance / EVM ────────────────────────────────────────────────────────────
export const financeAdapter = {
  // GET /api/v1/projects/:projectId/evm/metrics  ·  LIVE-WIRED
  summary: (projectId?: string): Promise<EvmSummary> =>
    USE_MOCKS ? mock(db.evmSummary) : fetchEvmSummaryLive(projectId ?? ''),
  // GET /api/v1/projects/:projectId/evm/scurve  ·  LIVE-WIRED
  trend: (projectId?: string): Promise<EvmTrendPoint[]> =>
    USE_MOCKS ? mock(db.evmTrend) : fetchEvmTrendLive(projectId ?? ''),
  // Per-line WBS needs baseline resolution — mock only (see docs/ADAPTER_STRATEGY.md).
  wbs: (): Promise<WbsLine[]> => (USE_MOCKS ? mock(db.wbsLines) : Promise.reject('wbs requires baseline resolution')),
  // Cash flow + drawdown requests (Stitch-C deep dive) — mock.
  cashFlow: (): Promise<CashFlowPoint[]> => (USE_MOCKS ? mock(db.cashFlow.slice()) : Promise.reject('cash-flow endpoint not available')),
  drawdowns: (): Promise<DrawdownRequest[]> => (USE_MOCKS ? mock(db.drawdownRequests.slice()) : Promise.reject('drawdown endpoint not available')),
}

// ── Engineering / Documents / Actions ────────────────────────────────────────
export const engineeringAdapter = {
  // GET /api/v1/projects/:projectId/drawings  ·  LIVE-WIRED (RFIs/submittals are separate endpoints)
  drawings: (projectId?: string): Promise<DrawingRecord[]> =>
    USE_MOCKS ? mock(db.drawings) : fetchDrawingsLive(projectId ?? ''),
}
export const documentsAdapter = {
  // GET /api/v1/files/documents  ·  LIVE-WIRED
  list: (): Promise<DocumentRecord[]> => (USE_MOCKS ? mock(db.documents) : fetchDocumentsLive()),
}
export const actionsAdapter = {
  // GET /api/v1/actions  ·  LIVE-WIRED
  list: (): Promise<ActionItem[]> => (USE_MOCKS ? mock(db.actions) : fetchActionsLive()),
}

// ── Contracts ────────────────────────────────────────────────────────────────
export const contractsAdapter = {
  // GET /api/v1/projects/:projectId/subcontracts  ·  LIVE-WIRED
  list: (projectId?: string): Promise<Contract[]> =>
    USE_MOCKS ? mock(db.contracts.slice()) : fetchContractsLive(projectId ?? ''),
  // GET /api/v1/projects/:projectId/change-orders  ·  LIVE-WIRED
  changeOrders: (projectId?: string): Promise<ChangeOrder[]> =>
    USE_MOCKS ? mock(db.changeOrders.slice()) : fetchChangeOrdersLive(projectId ?? ''),
  // Contract compliance audit — mock (would map to a compliance/clause endpoint).
  compliance: (): Promise<ComplianceItem[]> => (USE_MOCKS ? mock(db.complianceItems.slice()) : Promise.reject('compliance endpoint not available')),
}

// ── Administration ───────────────────────────────────────────────────────────
export const adminAdapter = {
  // GET /api/v1/team/members  ·  LIVE-WIRED
  users: (): Promise<AdminUser[]> => (USE_MOCKS ? mock(db.adminUsers.slice()) : fetchAdminUsersLive()),
  // GET /api/v1/enterprise/features  ·  LIVE-WIRED
  featureGates: (): Promise<FeatureGate[]> => (USE_MOCKS ? mock(db.featureGates.slice()) : fetchFeatureGatesLive()),
}

// ── Digital Twin ─────────────────────────────────────────────────────────────
export const twinAdapter = {
  // GET /api/v1/twins  ·  LIVE-WIRED (asset list only; telemetry stream still mock — see live/twinLive.ts)
  assets: (): Promise<TwinAsset[]> => (USE_MOCKS ? mock(db.twinAssets.slice()) : fetchTwinAssetsLive()),
}
