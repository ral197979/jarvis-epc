// Denver Engineering — Phase 12 Types
// Real-World Production Operations + Continuous Evolution

// ─── Constants ───────────────────────────────────────────────────────────────

export const PLUGIN_TRUST_SCORE_THRESHOLD = 70
export const COMPLEXITY_BUDGET_LIMIT = 1000
export const RESILIENCE_SCORE_THRESHOLD = 75
export const DEPLOYMENT_CONFIDENCE_THRESHOLD = 80
export const MATURITY_SCORE_THRESHOLD = 65
export const CHURN_RISK_SCORE_THRESHOLD = 0.35
export const TELEMETRY_DRIFT_ALERT_THRESHOLD = 0.20

// ─── Live Production Telemetry ────────────────────────────────────────────────

export type BehaviorEventType =
  | 'workflow_abandoned'
  | 'recommendation_overridden'
  | 'replay_triggered'
  | 'onboarding_friction'
  | 'support_escalated'
  | 'plugin_adopted'
  | 'plugin_ignored'
  | 'ai_suggestion_accepted'
  | 'ai_suggestion_rejected'
  | 'deployment_rolled_back'
  | 'edge_sync_failure'

export interface BehaviorEvent {
  id: string
  tenantId: string
  eventType: BehaviorEventType
  context: Record<string, unknown>
  sessionId: string | null
  recordedAt: Date
  createdAt: Date
}

export interface UsageProfile {
  id: string
  tenantId: string
  periodStart: Date
  periodEnd: Date
  workflowCompletionRate: number
  abandonmentRate: number
  recommendationOverrideRate: number
  aiAcceptanceRate: number
  pluginAdoptionCount: number
  replayFrequency: number
  supportEscalationRate: number
  onboardingFrictionScore: number
  edgeSyncReliability: number
  computedAt: Date
}

export interface TelemetryDrift {
  id: string
  metricName: string
  baselineValue: number
  currentValue: number
  driftPct: number
  direction: 'increasing' | 'decreasing'
  isAlert: boolean
  detectedAt: Date
  resolvedAt: Date | null
}

// ─── Continuous Governance Auditing ──────────────────────────────────────────

export type GovernanceCheckType =
  | 'policy_enforcement'
  | 'approval_gate_integrity'
  | 'replay_integrity'
  | 'plugin_isolation'
  | 'billing_correctness'
  | 'export_integrity'
  | 'ai_explainability'
  | 'tenant_isolation'
  | 'workflow_rollback_safety'
  | 'external_agent_constraints'

export interface GovernanceAuditCycle {
  id: string
  environment: string
  checksRun: GovernanceCheckType[]
  passed: number
  failed: number
  warnings: number
  overallStatus: 'compliant' | 'warning' | 'non_compliant'
  auditHash: string
  ranAt: Date
  createdAt: Date
}

export interface GovernanceRegressionAlert {
  id: string
  checkType: GovernanceCheckType
  previousStatus: 'pass' | 'warn' | 'fail'
  currentStatus: 'pass' | 'warn' | 'fail'
  severity: 'critical' | 'warning'
  detail: string
  detectedAt: Date
  resolvedAt: Date | null
}

export interface ReplayConsistencyRecord {
  id: string
  tenantId: string
  streamId: string
  eventsChecked: number
  eventsPassed: number
  divergentHashes: string[]
  consistencyRate: number
  checkedAt: Date
}

// ─── Ecosystem Moderation + Trust ────────────────────────────────────────────

export type ModerationTarget = 'plugin' | 'playbook' | 'workflow_template' | 'partner' | 'agent' | 'adapter'

export type ModerationStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'suspended' | 'revoked'

export interface ModerationRecord {
  id: string
  targetId: string
  targetType: ModerationTarget
  status: ModerationStatus
  trustScore: number
  reviewerId: string | null
  reviewNotes: string | null
  sandboxValidated: boolean
  immutableAt: Date
  createdAt: Date
}

export interface PluginTrustScore {
  id: string
  pluginId: string
  score: number
  apiScopeRisk: number
  dataAccessRisk: number
  sandboxPassRate: number
  abuseFlags: number
  authorReputation: number
  computedAt: Date
}

export interface WorkflowSafetyCheck {
  id: string
  workflowId: string
  checksPassed: number
  checksFailed: number
  replaySafe: boolean
  tenantIsolationSafe: boolean
  governanceSafe: boolean
  safetyScore: number
  checkedAt: Date
}

export interface PartnerReputation {
  id: string
  partnerId: string
  trustLevel: 'untrusted' | 'provisional' | 'trusted' | 'verified'
  errorRate: number
  securityIncidents: number
  uptimePct: number
  reputationScore: number
  lastUpdated: Date
}

// ─── Customer Success Optimization ───────────────────────────────────────────

export type MaturityLevel = 'starter' | 'developing' | 'proficient' | 'advanced' | 'optimized'

export interface CustomerSuccessScore {
  id: string
  tenantId: string
  onboardingScore: number
  adoptionScore: number
  maturityScore: number
  supportHealthScore: number
  aiUsageScore: number
  overallScore: number
  churnRiskScore: number
  maturityLevel: MaturityLevel
  computedAt: Date
}

export interface AdoptionAccelerationPlan {
  id: string
  tenantId: string
  currentAdoptionPct: number
  targetAdoptionPct: number
  recommendations: AdoptionRecommendation[]
  estimatedDaysToTarget: number
  createdAt: Date
}

export interface AdoptionRecommendation {
  action: string
  impact: 'high' | 'medium' | 'low'
  effort: 'high' | 'medium' | 'low'
  rationale: string
}

export interface OperationalMaturityScore {
  id: string
  tenantId: string
  workflowMaturity: number
  governanceMaturity: number
  integrationMaturity: number
  aiMaturity: number
  supportMaturity: number
  overallMaturity: number
  level: MaturityLevel
  scoredAt: Date
}

// ─── Operational Resilience ───────────────────────────────────────────────────

export interface ResilienceScore {
  id: string
  environment: string
  workerRecoveryScore: number
  replayRecoveryScore: number
  websocketResilienceScore: number
  queueBalanceScore: number
  cacheRecoveryScore: number
  failoverSuccessRate: number
  overallScore: number
  scoredAt: Date
}

export interface FailoverRecord {
  id: string
  component: string
  trigger: string
  failoverDurationMs: number
  successful: boolean
  replaySafe: boolean
  tenantsAffected: number
  recoveredAt: Date | null
  createdAt: Date
}

export interface QueueBalance {
  id: string
  queueName: string
  depth: number
  consumerCount: number
  targetConsumerCount: number
  rebalanceNeeded: boolean
  rebalancedAt: Date | null
  measuredAt: Date
}

// ─── Cost + Performance Efficiency ───────────────────────────────────────────

export interface EfficiencyMetric {
  id: string
  category: 'ai_routing' | 'replay_compute' | 'websocket_fanout' | 'graph_traversal' | 'telemetry_storage' | 'export_generation' | 'edge_sync'
  baselineCost: number
  currentCost: number
  efficiencyGainPct: number
  measuredAt: Date
}

export interface InfrastructureEfficiencyReport {
  id: string
  environment: string
  computeEfficiencyScore: number
  storageEfficiencyScore: number
  networkEfficiencyScore: number
  overallEfficiencyScore: number
  topOptimizations: string[]
  reportedAt: Date
}

export interface AiCostBalance {
  id: string
  modelId: string
  costPer1kTokens: number
  acceptanceRate: number
  qualityScore: number
  efficiencyScore: number
  recommendedAction: 'keep' | 'downgrade' | 'upgrade' | 'route_split' | null
  computedAt: Date
}

// ─── Deployment Reliability ───────────────────────────────────────────────────

export interface DeploymentConfidenceScore {
  id: string
  deploymentId: string
  canaryHealthScore: number
  migrationSafetyScore: number
  rollbackReadinessScore: number
  replayVerificationScore: number
  overallConfidence: number
  recommendation: 'proceed' | 'pause' | 'abort'
  computedAt: Date
}

export interface RolloutVerification {
  id: string
  rolloutId: string
  checksRun: number
  checksPassed: number
  tenantSampleSize: number
  errorRateInWindow: number
  p95InWindow: number
  verified: boolean
  verifiedAt: Date | null
  createdAt: Date
}

export interface MigrationReplayCheck {
  id: string
  migrationId: string
  preMigrationHash: string
  postMigrationHash: string
  hashMatch: boolean
  rowsValidated: number
  rowsMismatched: number
  checkedAt: Date
}

// ─── Production Support Excellence ───────────────────────────────────────────

export interface SupportRecord {
  id: string
  tenantId: string
  incidentId: string | null
  category: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  replayAssisted: boolean
  resolutionTimeMs: number | null
  aiSummaryGenerated: boolean
  resolvedAt: Date | null
  createdAt: Date
}

export interface IncidentReplaySession {
  id: string
  incidentId: string
  tenantId: string
  eventsReplayed: number
  timelineReconstructed: boolean
  rootCauseIdentified: boolean
  rootCauseSummary: string | null
  replayHash: string
  sessionAt: Date
}

export interface EscalationRoute {
  id: string
  supportRecordId: string
  fromTier: 'l1' | 'l2' | 'l3' | 'engineering'
  toTier: 'l1' | 'l2' | 'l3' | 'engineering'
  reason: string
  autoRouted: boolean
  escalatedAt: Date
}

// ─── Controlled Evolution Framework ──────────────────────────────────────────

export interface EvolutionGuardCheck {
  id: string
  checkName: string
  category: 'complexity' | 'governance_risk' | 'replay_surface' | 'dependency_coupling' | 'ecosystem_risk'
  passed: boolean
  currentValue: number
  threshold: number
  detail: string
  checkedAt: Date
}

export interface ComplexityBudget {
  id: string
  environment: string
  serviceCount: number
  averageDependencies: number
  replaySurface: number
  pluginCount: number
  totalComplexityScore: number
  budgetLimit: number
  isOverBudget: boolean
  measuredAt: Date
}

export interface SubsystemDependency {
  id: string
  fromSubsystem: string
  toSubsystem: string
  couplingScore: number
  replayDependent: boolean
  governanceDependent: boolean
  recordedAt: Date
}

export interface GovernanceImpactEstimate {
  id: string
  changeDescription: string
  replayImpact: 'none' | 'low' | 'medium' | 'high'
  governanceRisk: 'none' | 'low' | 'medium' | 'high'
  tenantImpact: 'none' | 'low' | 'medium' | 'high'
  overallRisk: 'none' | 'low' | 'medium' | 'high'
  approved: boolean
  estimatedAt: Date
}

// ─── Long-Term Maintainability ────────────────────────────────────────────────

export type DebtCategory = 'deprecated_api' | 'stale_plugin' | 'unsupported_workflow' | 'schema_drift' | 'replay_incompatibility' | 'test_coverage_gap'

export interface TechnicalDebtItem {
  id: string
  category: DebtCategory
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  estimatedEffortDays: number
  replayImpact: boolean
  identifiedAt: Date
  resolvedAt: Date | null
}

export interface ServiceLifecycleRecord {
  id: string
  serviceName: string
  version: string
  status: 'active' | 'deprecated' | 'sunset' | 'removed'
  deprecatedAt: Date | null
  sunsetAt: Date | null
  replacedBy: string | null
  createdAt: Date
}

export interface DeprecationRecord {
  id: string
  entityType: 'api' | 'service' | 'plugin' | 'workflow' | 'schema'
  entityId: string
  entityName: string
  deprecatedAt: Date
  sunsetAt: Date
  migrationPath: string | null
  affectedTenantsCount: number
}

export interface CompatibilityMatrix {
  id: string
  fromVersion: string
  toVersion: string
  compatible: boolean
  replayCompatible: boolean
  schemaCompatible: boolean
  breakingChanges: string[]
  generatedAt: Date
}

// ─── Real-World Feedback Loop ─────────────────────────────────────────────────

export type FeedbackSource = 'operator' | 'support' | 'pilot' | 'partner' | 'deployment' | 'workflow'

export type FeedbackSentiment = 'positive' | 'neutral' | 'negative'

export interface FeedbackRecord {
  id: string
  tenantId: string | null
  source: FeedbackSource
  category: string
  sentiment: FeedbackSentiment
  detail: string
  actionable: boolean
  processedAt: Date | null
  createdAt: Date
}

export interface UsabilitySignal {
  id: string
  tenantId: string
  feature: string
  frictionScore: number
  completionRate: number
  averageTimeMs: number
  abandonCount: number
  measuredAt: Date
}

export interface EcosystemFeedbackSummary {
  id: string
  periodStart: Date
  periodEnd: Date
  totalFeedback: number
  positiveCount: number
  neutralCount: number
  negativeCount: number
  topFrictionAreas: string[]
  topImprovementOpportunities: string[]
  trustSignalScore: number
  generatedAt: Date
}
