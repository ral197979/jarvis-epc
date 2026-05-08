// Denver Engineering — Phase 10 Types (v10.0.0)
// Production Launch + Security Certification + Enterprise Sales Readiness

// ─── Regression Audit ─────────────────────────────────────────────────────────

export type FailureClassification =
  | 'pre_existing' | 'new_regression' | 'environment_flaky' | 'dependency_drift'
  | 'determinism_failure' | 'timeout' | 'setup_error' | 'resolved'

export interface RegressionAuditRun {
  id: string
  runLabel: string
  totalTests: number
  passed: number
  failed: number
  skipped: number
  newFailures: number
  preExistingFailures: number
  flakyCount: number
  startedAt: Date
  completedAt: Date | null
  environment: string
  commitSha: string | null
  createdAt: Date
}

export interface RegressionFailure {
  id: string
  auditRunId: string
  testFile: string
  testName: string
  classification: FailureClassification
  errorMessage: string
  stackTrace: string | null
  isNew: boolean
  firstSeenAt: Date
  occurrenceCount: number
  resolvedAt: Date | null
  createdAt: Date
}

export interface RegressionReport {
  runId: string
  run: RegressionAuditRun
  failures: RegressionFailure[]
  newFailureCount: number
  resolvedSinceLastRun: number
  flakyTestCount: number
  topRegressionFiles: string[]
}

// ─── Flaky Test Detection ─────────────────────────────────────────────────────

export type TestOutcome = 'pass' | 'fail' | 'skip' | 'timeout'

export interface TestRunOutcome {
  id: string
  testFile: string
  testName: string
  outcome: TestOutcome
  durationMs: number
  runId: string
  environment: string
  createdAt: Date
}

export interface FlakyTestReport {
  testFile: string
  testName: string
  flipCount: number
  totalRuns: number
  passRate: number
  lastSeen: Date
  isFlaky: boolean
}

// ─── Replay Verification ──────────────────────────────────────────────────────

export type ReplayVerificationStatus = 'pending' | 'running' | 'passed' | 'failed' | 'error'

export interface ReplayVerificationRun {
  id: string
  workflowId: string | null
  eventStreamId: string | null
  replayCount: number
  deterministicPasses: number
  deterministicFailures: number
  status: ReplayVerificationStatus
  divergenceDetails: Record<string, unknown> | null
  verifiedAt: Date | null
  createdAt: Date
}

// ─── Production Gate ──────────────────────────────────────────────────────────

export type GateCategory =
  | 'queue_health' | 'worker_recovery' | 'websocket_resilience' | 'replay_integrity'
  | 'billing_correctness' | 'migration_safety' | 'rollback_safety' | 'tenant_isolation'
  | 'export_integrity' | 'edge_sync_recovery'

export type GateStatus = 'pass' | 'fail' | 'warn' | 'skip'

export interface ProductionGateCheck {
  id: string
  gateRunId: string
  category: GateCategory
  checkName: string
  status: GateStatus
  message: string
  durationMs: number
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface ProductionGateRun {
  id: string
  environment: string
  totalChecks: number
  passed: number
  failed: number
  warned: number
  skipped: number
  overallStatus: GateStatus
  startedAt: Date
  completedAt: Date | null
  createdAt: Date
}

// ─── Operational Readiness ────────────────────────────────────────────────────

export type ReadinessDimension =
  | 'queue' | 'workers' | 'websockets' | 'replay' | 'billing'
  | 'migrations' | 'rollback' | 'isolation' | 'exports' | 'edge'
  | 'ai_providers' | 'support' | 'governance'

export type ReadinessLevel = 'ready' | 'degraded' | 'not_ready' | 'unknown'

export interface ReadinessScanResult {
  id: string
  scanId: string
  dimension: ReadinessDimension
  level: ReadinessLevel
  score: number         // 0–100
  details: string
  blockers: string[]
  warnings: string[]
  checkedAt: Date
  createdAt: Date
}

export interface OperationalReadinessScan {
  id: string
  environment: string
  overallScore: number    // 0–100
  overallLevel: ReadinessLevel
  dimensionCount: number
  readyCount: number
  degradedCount: number
  notReadyCount: number
  completedAt: Date | null
  createdAt: Date
}

// ─── Deployment Audit ─────────────────────────────────────────────────────────

export type DeploymentAuditStatus = 'pending' | 'running' | 'passed' | 'failed' | 'rolled_back'

export interface DeploymentAudit {
  id: string
  deploymentId: string
  environment: string
  version: string
  previousVersion: string | null
  status: DeploymentAuditStatus
  migrationsApplied: number
  migrationsRolledBack: number
  servicesHealthy: number
  servicesDegraded: number
  rollbackAvailable: boolean
  auditedAt: Date
  completedAt: Date | null
  createdAt: Date
}

// ─── Uptime Monitoring ────────────────────────────────────────────────────────

export type UptimeMetricType =
  | 'api_latency' | 'websocket_uptime' | 'queue_latency' | 'replay_failure_rate'
  | 'sync_lag' | 'worker_churn' | 'deployment_recovery' | 'ai_provider_latency'
  | 'billing_reconciliation_lag'

export interface UptimeRecord {
  id: string
  metricType: UptimeMetricType
  valueMs: number
  healthy: boolean
  environment: string
  metadata: Record<string, unknown>
  checkedAt: Date
  createdAt: Date
}

export interface UptimeSummary {
  metricType: UptimeMetricType
  totalChecks: number
  healthyChecks: number
  uptimePercent: number
  avgValueMs: number
  maxValueMs: number
  minValueMs: number
}

// ─── Reliability Scoring ──────────────────────────────────────────────────────

export type SLOPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly'

export interface ReliabilityScore {
  id: string
  environment: string
  period: SLOPeriod
  uptimePercent: number
  errorRate: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  compositeScore: number    // 0–100
  sloMet: boolean
  scoredAt: Date
  createdAt: Date
}

export interface SLOViolation {
  id: string
  environment: string
  violationType: string
  description: string
  durationMs: number
  impactedTenants: number
  rootCause: string | null
  occurredAt: Date
  resolvedAt: Date | null
  createdAt: Date
}

// ─── Support Diagnostics ──────────────────────────────────────────────────────

export type DiagnosticSeverity = 'info' | 'warning' | 'critical'

export interface SupportDiagnosticReport {
  id: string
  tenantId: string
  reportedBy: string
  issueDescription: string
  status: 'pending' | 'healthy' | 'degraded' | 'critical'
  checkCount: number
  criticalCount: number
  warningCount: number
  completedAt: Date | null
  createdAt: Date
}

export interface DiagnosticCheck {
  id: string
  reportId: string
  checkName: string
  severity: DiagnosticSeverity
  passed: boolean
  detail: string
  remediation: string | null
  checkedAt: Date
  createdAt: Date
}

// ─── Tenant Support History ───────────────────────────────────────────────────

export type TicketStatus = 'open' | 'in_progress' | 'escalated' | 'resolved'
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical'

export interface SupportTicket {
  id: string
  tenantId: string
  subject: string
  description: string
  priority: TicketPriority
  reportedBy: string
  category: string
  status: TicketStatus
  resolvedBy: string | null
  resolutionNote: string | null
  resolvedAt: Date | null
  createdAt: Date
}

export interface TicketEscalation {
  id: string
  ticketId: string
  escalatedTo: string
  reason: string
  escalatedAt: Date
  createdAt: Date
}

// ─── Replay Support Analysis ──────────────────────────────────────────────────

export type ReplayIncidentStatus = 'open' | 'investigating' | 'resolved'

export type ReplayRootCause =
  | 'nondeterministic_code' | 'missing_event' | 'schema_mismatch'
  | 'clock_skew' | 'external_dependency' | 'unknown'

export interface ReplayIncident {
  id: string
  tenantId: string
  eventStreamId: string
  divergenceHash: string
  replayPassCount: number
  replayFailCount: number
  status: ReplayIncidentStatus
  rootCause: ReplayRootCause | null
  resolution: string | null
  resolvedAt: Date | null
  createdAt: Date
}

// ─── Governance Validation ────────────────────────────────────────────────────

export type GovernanceDimension =
  | 'audit_completeness' | 'policy_coverage' | 'tenant_isolation' | 'replay_integrity'
  | 'ai_explainability' | 'billing_integrity' | 'export_integrity' | 'approval_gates'
  | 'immutable_ledgers' | 'human_oversight'

export type GovernanceOutcome = 'pass' | 'fail' | 'warn' | 'pending'

export interface GovernanceValidationRun {
  id: string
  environment: string
  triggeredBy: string
  overallOutcome: GovernanceOutcome
  dimensionCount: number
  passedCount: number
  failedCount: number
  warnedCount: number
  completedAt: Date | null
  createdAt: Date
}

export interface GovernanceValidationResult {
  id: string
  runId: string
  dimension: GovernanceDimension
  outcome: GovernanceOutcome
  score: number
  detail: string
  evidence: string[]
  gaps: string[]
  validatedAt: Date
  createdAt: Date
}

// ─── Replay Integrity Audit ───────────────────────────────────────────────────

export type IntegrityAuditStatus = 'running' | 'clean' | 'violations_found' | 'error'

export interface ReplayIntegrityAudit {
  id: string
  environment: string
  auditedBy: string
  eventStreamIds: string[]
  status: IntegrityAuditStatus
  streamsAudited: number
  violationsFound: number
  auditHash: string | null
  completedAt: Date | null
  createdAt: Date
}

export interface IntegrityViolation {
  id: string
  auditId: string
  eventStreamId: string
  violationType: string
  description: string
  severity: 'critical' | 'warning'
  evidence: Record<string, unknown>
  detectedAt: Date
  createdAt: Date
}

// ─── AI Explainability ────────────────────────────────────────────────────────

export type ExplainabilityStatus = 'pending' | 'compliant' | 'non_compliant' | 'partial'

export interface ExplainabilityReport {
  id: string
  tenantId: string
  modelId: string
  decisionContext: string
  status: ExplainabilityStatus
  checksRequired: number
  checksPassed: number
  checksFailed: number
  completedAt: Date | null
  createdAt: Date
}

export interface ExplainabilityCheck {
  id: string
  reportId: string
  checkName: string
  passed: boolean
  rationale: string
  evidence: string | null
  checkedAt: Date
  createdAt: Date
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const PRODUCTION_GATE_PASS_THRESHOLD = 0.9   // 90% of gates must pass
export const READINESS_SCORE_THRESHOLD = 80          // score >= 80 = ready
export const RELIABILITY_SLO_DEFAULT = 0.999         // 99.9% default SLO
export const FLAKY_FLIP_THRESHOLD = 2                // flips >= 2 = flaky
export const MAX_REPLAY_DIVERGENCE_TOLERANCE = 0     // zero divergence allowed
export const AI_EXPLAINABILITY_REQUIRED_CHECKS = 4  // min checks per AI decision
