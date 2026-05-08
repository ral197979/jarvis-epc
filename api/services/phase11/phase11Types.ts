// Denver Engineering — Phase 11 Types (v11.0.0)
// General Availability + Real-World Operationalization

// ─── Production Telemetry ─────────────────────────────────────────────────────

export type TelemetryMetricType =
  | 'feature_adoption' | 'workflow_completion' | 'replay_latency'
  | 'ai_acceptance' | 'anomaly_frequency' | 'onboarding_completion'
  | 'support_incident_frequency' | 'deployment_recovery' | 'sync_lag'
  | 'tenant_maturity'

export interface TelemetryEvent {
  id: string
  tenantId: string
  metricType: TelemetryMetricType
  value: number
  dimensions: Record<string, string>
  environment: string
  recordedAt: Date
  createdAt: Date
}

export interface TelemetryAggregate {
  id: string
  metricType: TelemetryMetricType
  environment: string
  periodStart: Date
  periodEnd: Date
  p50: number
  p95: number
  p99: number
  avg: number
  min: number
  max: number
  sampleCount: number
  createdAt: Date
}

export interface TelemetryTrend {
  metricType: TelemetryMetricType
  direction: 'improving' | 'degrading' | 'stable'
  changePercent: number
  currentAvg: number
  previousAvg: number
  confidence: number
  analyzedAt: Date
}

// ─── Scale Validation ─────────────────────────────────────────────────────────

export type ScaleTestType =
  | 'tenant_count' | 'event_stream_size' | 'graph_nodes' | 'websocket_fanout'
  | 'edge_sync_load' | 'replay_reconstruction' | 'queue_saturation'
  | 'billing_load' | 'export_concurrency'

export type ScaleTestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'degraded'

export interface ScaleValidationRun {
  id: string
  testType: ScaleTestType
  targetLoad: number
  actualLoad: number
  status: ScaleTestStatus
  p50Ms: number
  p95Ms: number
  p99Ms: number
  errorRate: number
  throughput: number
  environment: string
  startedAt: Date
  completedAt: Date | null
  createdAt: Date
}

export interface PerformanceBaseline {
  id: string
  testType: ScaleTestType
  baselineLoad: number
  baselineP50Ms: number
  baselineP95Ms: number
  baselineP99Ms: number
  baselineErrorRate: number
  baselineThroughput: number
  establishedAt: Date
  createdAt: Date
}

export interface PerformanceRegression {
  id: string
  testType: ScaleTestType
  baselineId: string
  regressionPercent: number
  affectedMetric: 'p50' | 'p95' | 'p99' | 'error_rate' | 'throughput'
  severity: 'minor' | 'moderate' | 'critical'
  detectedAt: Date
  resolvedAt: Date | null
  createdAt: Date
}

// ─── Operational Tuning ───────────────────────────────────────────────────────

export type TuningParameter =
  | 'queue_concurrency' | 'websocket_buffer_size' | 'replay_cache_ttl'
  | 'graph_cache_size' | 'anomaly_threshold' | 'forecast_horizon'
  | 'ai_routing_batch_size' | 'sync_batch_interval'

export interface TuningConfig {
  id: string
  parameter: TuningParameter
  currentValue: number
  recommendedValue: number
  rationale: string
  appliedAt: Date | null
  environment: string
  createdAt: Date
}

export interface PerformanceTuneEvent {
  id: string
  parameter: TuningParameter
  oldValue: number
  newValue: number
  triggeredBy: string
  deltaP95Ms: number | null
  environment: string
  tunedAt: Date
  createdAt: Date
}

// ─── Pilot Operations ─────────────────────────────────────────────────────────

export type PilotStatus =
  | 'invited' | 'provisioned' | 'onboarding' | 'active'
  | 'at_risk' | 'churned' | 'converted'

export interface PilotTenant {
  id: string
  tenantId: string
  tenantName: string
  status: PilotStatus
  healthScore: number
  onboardingCompletePct: number
  trainingCompletePct: number
  adoptionScore: number
  openIncidents: number
  activatedAt: Date | null
  convertedAt: Date | null
  churnRisk: 'low' | 'medium' | 'high'
  csm: string | null
  createdAt: Date
}

export interface GoLiveChecklistItem {
  id: string
  tenantId: string
  checkKey: string
  title: string
  required: boolean
  completed: boolean
  completedAt: Date | null
  completedBy: string | null
  createdAt: Date
}

// ─── Migration + Import ───────────────────────────────────────────────────────

export type ImportSource =
  | 'csv' | 'spreadsheet' | 'cmms' | 'construction_mgmt'
  | 'asset_register' | 'inspection_db' | 'commissioning_system'

export type ImportStatus =
  | 'pending' | 'validating' | 'validated' | 'executing'
  | 'complete' | 'failed' | 'rolled_back'

export interface ImportJob {
  id: string
  tenantId: string
  source: ImportSource
  fileName: string
  rowCount: number
  validatedRows: number
  importedRows: number
  failedRows: number
  status: ImportStatus
  dryRun: boolean
  errors: string[]
  startedAt: Date
  completedAt: Date | null
  createdAt: Date
}

export interface SchemaMappingRule {
  id: string
  tenantId: string
  sourceField: string
  targetField: string
  transformation: string | null
  required: boolean
  defaultValue: string | null
  createdAt: Date
}

// ─── Deployment Automation ────────────────────────────────────────────────────

export type DeploymentStrategy = 'immediate' | 'blue_green' | 'canary' | 'wave'
export type RolloutStatus = 'pending' | 'running' | 'paused' | 'complete' | 'rolled_back'

export interface RolloutPlan {
  id: string
  environment: string
  version: string
  strategy: DeploymentStrategy
  status: RolloutStatus
  totalTenants: number
  deployedTenants: number
  failedTenants: number
  canaryPercent: number | null
  waveSize: number | null
  currentWave: number
  startedAt: Date
  completedAt: Date | null
  createdAt: Date
}

export interface TenantRollout {
  id: string
  rolloutPlanId: string
  tenantId: string
  wave: number
  status: 'pending' | 'deploying' | 'complete' | 'failed' | 'skipped'
  deployedAt: Date | null
  verifiedAt: Date | null
  createdAt: Date
}

// ─── Support Triage ───────────────────────────────────────────────────────────

export type TriagePriority = 'critical' | 'high' | 'medium' | 'low'
export type IncidentClusterType =
  | 'replay_divergence' | 'queue_saturation' | 'billing_lag' | 'auth_failure'
  | 'edge_disconnect' | 'ai_provider_error' | 'export_failure' | 'unknown'

export interface SupportTriageRecord {
  id: string
  ticketId: string
  tenantId: string
  suggestedPriority: TriagePriority
  clusterType: IncidentClusterType
  confidence: number
  diagnosticSummary: string
  suggestedActions: string[]
  escalateToEngineering: boolean
  triagedAt: Date
  createdAt: Date
}

export interface IncidentCluster {
  id: string
  clusterType: IncidentClusterType
  incidentCount: number
  affectedTenants: number
  firstSeenAt: Date
  lastSeenAt: Date
  status: 'active' | 'resolved' | 'monitoring'
  rootCause: string | null
  createdAt: Date
}

// ─── Cost Analysis ────────────────────────────────────────────────────────────

export type CostCategory =
  | 'ai_provider' | 'replay_compute' | 'graph_traversal' | 'websocket_fanout'
  | 'export' | 'simulation' | 'edge_sync' | 'storage' | 'network'

export interface CostRecord {
  id: string
  tenantId: string | null
  category: CostCategory
  featureId: string | null
  costUsd: number
  unitCount: number
  unitType: string
  billingPeriod: string
  recordedAt: Date
  createdAt: Date
}

export interface CostForecast {
  id: string
  tenantId: string | null
  category: CostCategory
  forecastPeriod: string
  projectedCostUsd: number
  currentRunRateUsd: number
  growthRatePct: number
  confidence: number
  forecastedAt: Date
  createdAt: Date
}

// ─── Governance Audit ─────────────────────────────────────────────────────────

export type GovernanceDriftType =
  | 'rls_policy_removed' | 'audit_gap' | 'replay_divergence_spike'
  | 'approval_gate_bypassed' | 'ai_explainability_regression'
  | 'cross_tenant_leak' | 'immutable_record_modified'

export interface GovernanceDriftEvent {
  id: string
  driftType: GovernanceDriftType
  severity: 'critical' | 'warning' | 'info'
  tenantId: string | null
  description: string
  detectedAt: Date
  resolvedAt: Date | null
  createdAt: Date
}

export interface ProductionGovernanceAudit {
  id: string
  environment: string
  overallStatus: 'compliant' | 'drifted' | 'critical'
  driftCount: number
  controlsVerified: number
  controlsFailed: number
  auditHash: string
  auditedAt: Date
  createdAt: Date
}

// ─── Partner Ecosystem ────────────────────────────────────────────────────────

export type PartnerType = 'implementation' | 'reseller' | 'integration' | 'plugin_publisher' | 'agent_provider'
export type PartnerStatus = 'applied' | 'reviewing' | 'certified' | 'suspended' | 'rejected'

export interface Partner {
  id: string
  name: string
  partnerType: PartnerType
  status: PartnerStatus
  contactEmail: string
  certificationLevel: 'standard' | 'advanced' | 'premium' | null
  certifiedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
}

export interface EcosystemCertification {
  id: string
  partnerId: string
  certType: string
  status: 'pending' | 'passed' | 'failed' | 'expired'
  score: number
  completedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
}

// ─── GA Readiness ─────────────────────────────────────────────────────────────

export type GAReadinessDimension =
  | 'regression' | 'telemetry' | 'deployment' | 'onboarding'
  | 'support' | 'sre' | 'billing' | 'governance' | 'compliance'
  | 'scale' | 'partner' | 'documentation'

export interface GAReadinessScore {
  id: string
  environment: string
  dimension: GAReadinessDimension
  score: number
  status: 'ready' | 'at_risk' | 'blocking'
  notes: string | null
  scoredAt: Date
  createdAt: Date
}

export interface DeploymentWave {
  id: string
  waveName: string
  waveNumber: number
  targetCustomers: string[]
  status: 'planned' | 'active' | 'complete' | 'paused'
  startDate: Date | null
  endDate: Date | null
  successCriteria: string[]
  createdAt: Date
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PILOT_HEALTH_SCORE_THRESHOLD = 70      // score < 70 = at_risk
export const SCALE_REGRESSION_THRESHOLD = 0.15      // 15% degradation = regression
export const IMPORT_MAX_BATCH_SIZE = 5000           // rows per import batch
export const GA_READINESS_PASS_SCORE = 80           // score >= 80 = ready
export const INCIDENT_CLUSTER_MIN_COUNT = 3         // min incidents to form cluster
export const TELEMETRY_RETENTION_DAYS = 90          // default telemetry retention
export const CHURN_RISK_THRESHOLD = 0.4             // adoption < 40% = churn risk
