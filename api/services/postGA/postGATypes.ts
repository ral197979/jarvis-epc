// Denver Engineering — Post-GA Operationalization Types
// Real-World Operational Excellence Program

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEPLOYMENT_READINESS_THRESHOLD = 80
export const LAUNCH_VALIDATION_PASS_RATE = 0.95
export const TELEMETRY_HEALTH_MIN_SCORE = 70
export const GOVERNANCE_DURABILITY_MIN_PASS_RATE = 0.98
export const ADOPTION_TARGET_MATURITY = 65
export const ECOSYSTEM_TRUST_MIN_SIGNAL = 0.75
export const COMPLEXITY_GROWTH_LIMIT_PCT = 0.10
export const REPLAY_DRIFT_ALERT_THRESHOLD = 0.01   // 1% drift in replay determinism
export const SUPPORT_RESOLUTION_TARGET_MS = 14400000 // 4h for critical

// ─── Customer Deployment Program ─────────────────────────────────────────────

export type DeploymentReadinessStatus = 'not_ready' | 'ready' | 'deployed' | 'failed'
export type WaveStatus = 'pending' | 'active' | 'completed' | 'paused' | 'aborted'
export type LaunchGateStatus = 'pass' | 'fail' | 'warn'

export interface TenantLaunchRecord {
  id: string
  tenantId: string
  waveId: string | null
  readinessScore: number
  onboardingComplete: boolean
  replayValidated: boolean
  governanceVerified: boolean
  status: DeploymentReadinessStatus
  launchedAt: Date | null
  createdAt: Date
}

export interface LaunchGate {
  gateName: string
  category: 'replay' | 'governance' | 'onboarding' | 'infra' | 'data'
  status: LaunchGateStatus
  currentValue: number
  requiredValue: number
  detail: string
}

export interface RolloutWave {
  id: string
  waveName: string
  tenantIds: string[]
  status: WaveStatus
  targetCount: number
  deployedCount: number
  failedCount: number
  replayValidated: boolean
  scheduledAt: Date | null
  completedAt: Date | null
  createdAt: Date
}

// ─── Production Telemetry Operations ─────────────────────────────────────────

export type TelemetryMetric =
  | 'recommendation_acceptance'
  | 'workflow_abandonment'
  | 'replay_latency'
  | 'support_escalation'
  | 'onboarding_friction'
  | 'plugin_adoption'
  | 'deployment_rollback'
  | 'operational_bottleneck'

export type DriftSeverity = 'none' | 'minor' | 'moderate' | 'severe'

export interface TelemetryOperationsRecord {
  id: string
  metric: TelemetryMetric
  tenantId: string | null
  value: number
  baselineValue: number
  driftPct: number
  driftSeverity: DriftSeverity
  recordedAt: Date
}

export interface OperationalDriftSummary {
  id: string
  environment: string
  alertCount: number
  severeMetrics: TelemetryMetric[]
  overallDriftScore: number
  isHealthy: boolean
  computedAt: Date
}

// ─── Governance Durability Program ───────────────────────────────────────────

export type GovernanceDimension =
  | 'replay_integrity'
  | 'approval_enforcement'
  | 'plugin_isolation'
  | 'tenant_isolation'
  | 'explainability'
  | 'policy_drift'

export interface GovernanceDurabilityRecord {
  id: string
  dimension: GovernanceDimension
  passRate: number
  failCount: number
  warnCount: number
  isDurable: boolean
  trend: 'improving' | 'stable' | 'degrading'
  measuredAt: Date
}

export interface ReplayDriftRecord {
  id: string
  streamId: string
  tenantId: string
  baselineDeterminismRate: number
  currentDeterminismRate: number
  driftPct: number
  isAlert: boolean
  detectedAt: Date
  resolvedAt: Date | null
}

// ─── Customer Success + Adoption ─────────────────────────────────────────────

export type AdoptionTier = 'new' | 'activating' | 'active' | 'power' | 'champion'
export type InterventionType =
  | 'onboarding_assist'
  | 'adoption_coaching'
  | 'churn_recovery'
  | 'feature_enablement'
  | 'support_escalation'

export interface CustomerAdoptionRecord {
  id: string
  tenantId: string
  adoptionScore: number
  adoptionTier: AdoptionTier
  churnRisk: number
  dailyActiveRate: number
  workflowCompletionRate: number
  aiAcceptanceRate: number
  recommendedInterventions: InterventionType[]
  maturityLevel: string
  assessedAt: Date
}

// ─── Ecosystem Trust Operations ───────────────────────────────────────────────

export type ModerationAction = 'approve' | 'reject' | 'revoke' | 'flag' | 'escalate'
export type EcosystemEntityType = 'plugin' | 'workflow' | 'playbook' | 'partner' | 'agent'

export interface EcosystemTrustOperationsRecord {
  id: string
  entityId: string
  entityType: EcosystemEntityType
  trustScore: number
  moderationAction: ModerationAction | null
  actionReason: string | null
  reviewerId: string | null
  isImmutable: boolean
  actionedAt: Date | null
  createdAt: Date
}

export interface ModerationQueueItem {
  id: string
  entityId: string
  entityType: EcosystemEntityType
  trustScore: number
  flagCount: number
  priority: 'critical' | 'high' | 'medium' | 'low'
  queuedAt: Date
}

// ─── Support Operations ───────────────────────────────────────────────────────

export type IncidentClusterType =
  | 'replay_failure'
  | 'onboarding_blocker'
  | 'performance_degradation'
  | 'governance_violation'
  | 'integration_failure'

export interface SupportOperationsRecord {
  id: string
  tenantId: string
  incidentId: string | null
  clusterType: IncidentClusterType | null
  replayAssisted: boolean
  resolutionTimeMs: number | null
  rootCauseIdentified: boolean
  escalationTier: 'l1' | 'l2' | 'l3' | 'engineering'
  satisfactionScore: number | null
  resolvedAt: Date | null
  createdAt: Date
}

export interface IncidentCluster {
  clusterType: IncidentClusterType
  count: number
  avgResolutionMs: number
  rootCauseRate: number
  replayAssistedRate: number
}

// ─── Platform Evolution Governance ───────────────────────────────────────────

export type EvolutionProposalStatus = 'draft' | 'under_review' | 'approved' | 'rejected' | 'implemented'
export type ComplexityTrend = 'decreasing' | 'stable' | 'growing' | 'accelerating'

export interface EvolutionProposal {
  id: string
  title: string
  description: string
  complexityImpact: number
  replaySurfaceImpact: number
  governanceRisk: 'none' | 'low' | 'medium' | 'high'
  status: EvolutionProposalStatus
  approvedBy: string | null
  proposedAt: Date
  reviewedAt: Date | null
}

export interface ComplexityTrendRecord {
  id: string
  environment: string
  currentScore: number
  previousScore: number
  growthPct: number
  trend: ComplexityTrend
  isOverLimit: boolean
  measuredAt: Date
}

// ─── Industry Expansion ───────────────────────────────────────────────────────

export type Industry =
  | 'water_wastewater'
  | 'manufacturing'
  | 'facilities'
  | 'utilities'
  | 'energy'
  | 'industrial_operations'
  | 'infrastructure'

export interface IndustryPlaybook {
  id: string
  industry: Industry
  version: string
  templateCount: number
  workflowCount: number
  complianceFrameworks: string[]
  certificationStatus: 'draft' | 'review' | 'certified' | 'deprecated'
  deploymentCount: number
  createdAt: Date
  updatedAt: Date
}

export interface VerticalTemplate {
  id: string
  industry: Industry
  templateName: string
  templateType: 'workflow' | 'playbook' | 'compliance' | 'onboarding'
  replayCompatible: boolean
  governanceValidated: boolean
  usageCount: number
  createdAt: Date
}
