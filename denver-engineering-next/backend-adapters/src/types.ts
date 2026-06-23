/**
 * Domain types for the adapter layer.
 *
 * These mirror the shapes the existing Denver Engineering `/api/v1` endpoints
 * return (projects, commissioning, procurement, EVM, …). The UI consumes ONLY
 * these types, so swapping mock implementations for live HTTP calls never touches
 * a screen.
 */

export type Health = 'healthy' | 'at-risk' | 'critical'

export interface PortfolioKpis {
  totalContractValue: string
  actualCost: string
  actualCostPct: string
  revenueYtd: string
  costVariance: string
  costVariancePct: string
  onTrack: number
  atRisk: number
  openRisks: number
  openNcrs: number
}

export interface Project {
  id: string
  code: string
  name: string
  client: string
  region: string
  phase: string
  health: Health
  budgetStatus: string
  scheduleStatus: string
  safetyStatus: string
  qualityPct: number
  progressPct: number
  contractValue: string
  lat: number
  lng: number
}

export interface NewProjectInput {
  code: string
  name: string
  client?: string
  region?: string
  phase?: string
  budget?: number
}

export interface Milestone {
  id: string
  name: string
  date: string
  status: string
  owner: string
}

export interface Deliverable {
  id: string
  name: string
  discipline: string
  rev: string
  status: string
  due: string
}

export interface Risk {
  id: string
  title: string
  category: string
  probability: number
  impact: number
  severity: string
  owner: string
  status: string
}

export interface TeamMember {
  id: string
  name: string
  role: string
  email: string
  allocationPct: number
}

export interface ActivityItem {
  id: string
  actor: string
  action: string
  target: string
  at: string
  icon: string
}

export interface AiInsight {
  id: string
  title: string
  body: string
  severity: Health
  recommendation: string
}

// ── Commissioning ──────────────────────────────────────────────────────────
export interface MatrixCell {
  status: 'complete' | 'in-progress' | 'delayed' | 'critical' | 'not-started'
}
export interface MatrixSystem {
  id: string
  tag: string
  name: string
  category: string
  cells: Record<string, MatrixCell['status']> // stage → status
}
export interface CommissioningKpis {
  overallCompletion: number
  systemsComplete: number
  systemsTotal: number
  systemsAtRisk: number
  criticalDeficiencies: number
  readinessForecast: number
}
export interface Equipment {
  id: string
  tag: string
  name: string
  system: string
  vendor: string
  model: string
  status: string
  completionPct: number
  openPunch: number
}
export interface Deficiency {
  id: string
  /** Raw DB UUID, used for mutations (PATCH). Display uses `id` (the code). */
  uuid?: string
  description: string
  category: 'A' | 'B' | 'C'
  severity: string
  system: string
  contractor: string
  status: string
  loggedAt: string
}
export interface NewDeficiencyInput {
  projectId: string
  code: string
  title: string
  description?: string
  severity: string
  status?: string
}
export interface TestPack {
  id: string
  discipline: string
  testType: string
  preparedBy: string
  date: string
  qaSignature: string
  progressPct: number
}

// ── Commissioning Phase 3 — PFC / FPT / IST / Turnover ───────────────────────
export interface PfcItem {
  id: string
  system: string
  equipmentTag: string
  description: string
  checksComplete: number
  checksTotal: number
  status: string // Not Started | In Progress | Complete | Signed Off
  signedBy: string
}

export interface FptStep {
  id: string
  no: number
  description: string
  expected: string
  result: 'pass' | 'fail' | 'pending'
}
export interface FptScript {
  id: string
  name: string
  system: string
  status: string // Not Started | In Progress | Passed | Failed
  witnessedBy: string
  steps: FptStep[]
}

export type IstStepStatus = 'complete' | 'active' | 'pending' | 'blocked'
export interface IstStep {
  id: string
  seq: number
  system: string
  action: string
  status: IstStepStatus
}
export interface IstSequence {
  id: string
  name: string
  systems: string[]
  window: string
  status: string // Scheduled | Running | Complete | Blocked
  steps: IstStep[]
}

export interface TurnoverItem {
  label: string
  collected: boolean
}
export interface TurnoverPackage {
  id: string
  system: string
  recipient: string
  status: string // Draft | In Review | Accepted
  items: TurnoverItem[]
}

// ── Mobile field flows ───────────────────────────────────────────────────────
export interface FieldAssignment {
  id: string
  title: string
  system: string
  location: string
  due: string
  status: string // Assigned | In Progress | Done
  priority: string // High | Medium | Low
}
export interface SyncItem {
  id: string
  action: string
  entity: string
  status: string // Pending | Conflict | Synced
  at: string
}

// ── AI Mitigation / Resource Reallocation ───────────────────────────────────
export interface MitigationPlan {
  id: string
  trigger: string
  project: string
  severity: string // Medium | High | Critical
  recommendation: string
  scheduleImpactDays: number // negative = recovery
  costImpact: string
  confidence: number // 0..100
  status: string // Proposed | Executed | Dismissed
}
export interface ResourceShift {
  id: string
  resource: string
  from: string
  to: string
  count: number
  status: string // Proposed | Dispatched | Confirmed
  eta: string
}

// ── Reports Center ───────────────────────────────────────────────────────────
export interface ReportTemplate {
  id: string
  name: string
  category: string // Executive | Commercial | Technical | Safety | Commissioning
  description: string
  icon: string
}
export interface GeneratedReport {
  id: string
  name: string
  template: string
  generatedBy: string
  date: string
  status: string // Ready | Generating | Scheduled
  format: string // PDF | XLSX | PPTX
}

// ── Finance deep-dive (cash flow + drawdowns) ────────────────────────────────
export interface CashFlowPoint {
  month: string
  inflow: number
  outflow: number
  net: number // cumulative net position
}
export interface DrawdownRequest {
  id: string
  description: string
  area: string
  amount: string
  status: string // Review | Approved | Rejected
  date: string
}

// ── Safety ───────────────────────────────────────────────────────────────────
export interface SafetyAudit {
  id: string
  title: string
  area: string
  auditor: string
  date: string
  score: number
  openFindings: number
  status: string // Closed | Open | Action Required
}
export interface SiteAccessBadge {
  id: string
  person: string
  company: string
  role: string
  inducted: string
  zones: string
  status: string // Active | Expiring | Suspended
}

export interface SafetyIncident {
  id: string
  title: string
  type: string // Near Miss | First Aid | Recordable | LTI
  severity: string // Low | Medium | High | Critical
  project: string
  date: string
  status: string // Open | Investigating | Closed
  reportedBy: string
}
export interface TrainingRecord {
  id: string
  person: string
  role: string
  course: string
  status: string // Valid | Expiring | Expired
  expires: string
}

// ── Project Closeout ─────────────────────────────────────────────────────────
export interface CloseoutItem {
  id: string
  category: string // Documentation | Commercial | Technical | Handover
  description: string
  status: string // Complete | In Progress | Outstanding
  owner: string
  due: string
}

// ── Inventory / Materials ────────────────────────────────────────────────────
export interface MaterialItem {
  id: string
  description: string
  category: string
  uom: string
  onHand: number
  reserved: number
  available: number
  location: string
  status: string // In Stock | Low | Out
}
export interface Requisition {
  id: string
  item: string
  qty: number
  requestedBy: string
  project: string
  status: string // Draft | Submitted | Approved | Issued
  date: string
}
export interface ReceivingRecord {
  id: string
  po: string
  item: string
  qtyExpected: number
  qtyReceived: number
  status: string // Pending | Partial | Received | Discrepancy
  date: string
}

// ── Schedule / Gantt ─────────────────────────────────────────────────────────
export interface GanttTask {
  id: string
  name: string
  track: string // discipline / phase / project
  start: string // ISO date
  end: string // ISO date
  progressPct: number
  status: string // Complete | On Track | At Risk | Delayed
  milestone?: boolean
}

// ── Schedule / Primavera P6 bridge ───────────────────────────────────────────
export interface Activity {
  id: string
  name: string
  wbs: string
  start: string
  finish: string
  durationDays: number
  floatDays: number
  pctComplete: number
  status: string // Not Started | In Progress | Complete
  critical: boolean
}
export interface WbsNode {
  id: string
  code: string
  name: string
  level: number
  budget: string
  pctComplete: number
}
export interface BaselineRow {
  id: string
  activity: string
  baselineFinish: string
  currentFinish: string
  varianceDays: number
  status: string // On Track | Slipping | Recovered
}
export interface ResourceLoad {
  month: string
  planned: number
  actual: number
  capacity: number
}

// ── Risk ─────────────────────────────────────────────────────────────────────
export interface RiskEntry {
  id: string
  title: string
  category: string
  probability: number // 1..5
  impact: number // 1..5
  severity: string // Low | Medium | High | Critical
  owner: string
  status: string // Open | Mitigating | Closed
  response: string // Mitigate | Accept | Transfer | Avoid
}
export interface ContingencyItem {
  id: string
  name: string
  allocated: string
  drawn: string
  remaining: string
  status: string // Healthy | Watch | Depleted
}

// ── Maintenance / Asset lifecycle ────────────────────────────────────────────
export interface MaintenanceTask {
  id: string
  asset: string
  type: string // Preventive | Corrective | Predictive
  due: string
  status: string // Scheduled | In Progress | Overdue | Done
  assignedTo: string
  priority: string
}
export interface AssetRecord {
  id: string
  tag: string
  name: string
  category: string
  installed: string
  condition: string // Good | Fair | Poor
  nextService: string
  criticality: string // High | Medium | Low
}
export interface LifecycleRow {
  id: string
  component: string
  ageYears: number
  expectedLifeYears: number
  remainingPct: number
  replaceYear: number
  risk: string // Low | Medium | High
}

// ── Vendor performance ───────────────────────────────────────────────────────
export interface VendorScore {
  id: string
  name: string
  tier: string // Strategic | Preferred | Approved | Watchlist
  onTimePct: number
  qualityPct: number
  leadTimeDays: number
  spend: string
  status: string // Optimized | Attention | Blocking
}

// ── Scenario modeler ─────────────────────────────────────────────────────────
export interface Scenario {
  id: string
  name: string
  description: string
  costImpact: string
  scheduleImpactDays: number
  riskLevel: string // Low | Medium | High | Critical
  recommendation: string
  status: string // Modeled | Recommended | Rejected
}

// ── Contract compliance ──────────────────────────────────────────────────────
export interface ComplianceItem {
  id: string
  contractId: string
  clause: string
  requirement: string
  status: string // Compliant | At Risk | Breach
  owner: string
  due: string
}

// ── Contracts ────────────────────────────────────────────────────────────────
export interface Contract {
  id: string
  title: string
  counterparty: string
  type: string
  value: string
  status: string
  executed: string
}
export interface ChangeOrder {
  id: string
  contractId: string
  description: string
  value: string
  status: string
}

// ── Administration ───────────────────────────────────────────────────────────
export interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  status: string
  lastActive: string
}
export interface FeatureGate {
  key: string
  label: string
  enabled: boolean
  rollout: string
}

// ── Digital Twin ─────────────────────────────────────────────────────────────
export interface TwinTelemetry {
  label: string
  value: number
  unit: string
  min: number
  max: number
}
export interface TwinAsset {
  id: string
  tag: string
  name: string
  system: string
  status: string // Operational | Testing | Mechanical Cmpl. | Offline
  completionPct: number
  openPunch: number
  telemetry: TwinTelemetry[]
}

// ── CRM ───────────────────────────────────────────────────────────────────
export interface Lead {
  id: string
  name: string
  client: string
  estValue: string
  probability: number
  owner: string
  stage: string
}

// ── Procurement ─────────────────────────────────────────────────────────────
export interface PurchaseOrder {
  id: string
  vendor: string
  description: string
  value: string
  status: string
  expediting: string
}
export interface LongLeadItem {
  id: string
  name: string
  ordered: string
  eta: string
  progressPct: number
  status: string
}
export interface Vendor {
  id: string
  name: string
  avgLeadTimeDays: number
  onTimePct: number
}

// ── Finance / EVM ────────────────────────────────────────────────────────────
export interface EvmSummary {
  pv: string
  ev: string
  ac: string
  cpi: number
  spi: number
  eac: string
  etc: string
  vac: string
}
export interface WbsLine {
  id: string
  discipline: string
  bac: string
  ev: string
  ac: string
  cpi: number
  spi: number
  status: string
}
export interface EvmTrendPoint {
  month: string
  pv: number
  ev: number
  ac: number
}

// ── Engineering / Documents / Actions ────────────────────────────────────────
export interface DrawingRecord {
  id: string
  title: string
  discipline: string
  rev: string
  status: string
  reviewer: string
  due: string
}
export interface DocumentRecord {
  id: string
  title: string
  type: string
  rev: string
  status: string
  owner: string
  updated: string
}
export interface ActionItem {
  id: string
  title: string
  priority: string
  assignee: string
  due: string
  status: string
  source: string
}
