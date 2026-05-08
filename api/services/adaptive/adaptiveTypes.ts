// Denver Engineering — Adaptive Intelligence Types (v7.0.0)
// Shared type definitions for Phase 7 Adaptive Operational Intelligence.

// ─── Enums ───────────────────────────────────────────────────────────────────

export type FeedbackOutcome =
  | 'accepted' | 'rejected' | 'partially_accepted'
  | 'deferred' | 'superseded' | 'unknown'

export type LearningSignal = 'positive' | 'negative' | 'neutral' | 'mixed'

export type OptimizationStatus =
  | 'proposed' | 'approved' | 'applied' | 'rejected' | 'expired'

export type DriftSeverity = 'none' | 'minor' | 'moderate' | 'significant' | 'critical'

export type ForecastType = 'readiness' | 'risk' | 'workload' | 'sla' | 'maintenance'

export type OptimizationType =
  | 'resource' | 'workload' | 'scheduling' | 'risk' | 'capacity'

export type FeedbackType = 'recommendation' | 'forecast' | 'anomaly' | 'scenario'

// ─── Learning Feedback ────────────────────────────────────────────────────────

export interface LearningFeedback {
  id: string
  tenantId: string
  feedbackType: FeedbackType
  sourceId: string
  sourceType: string
  agentType?: string
  signal: LearningSignal
  outcome: FeedbackOutcome
  context: Record<string, unknown>
  metadata: Record<string, unknown>
  recordedBy?: string
  createdAt: Date
}

export interface RecordFeedbackInput {
  feedbackType: FeedbackType
  sourceId: string
  sourceType: string
  agentType?: string
  signal: LearningSignal
  outcome: FeedbackOutcome
  context?: Record<string, unknown>
  metadata?: Record<string, unknown>
  recordedBy?: string
}

// ─── Recommendation Outcomes ──────────────────────────────────────────────────

export interface RecommendationOutcome {
  id: string
  tenantId: string
  recommendationId: string
  recommendationType: string
  agentType: string
  entityId?: string
  entityType?: string
  outcome: FeedbackOutcome
  effectivenessScore?: number
  beforeState?: Record<string, unknown>
  afterState?: Record<string, unknown>
  measuredAt?: Date
  feedbackLagMs?: number
  notes?: string
  createdAt: Date
  updatedAt: Date
}

export interface RecordOutcomeInput {
  recommendationId: string
  recommendationType: string
  agentType: string
  entityId?: string
  entityType?: string
  outcome: FeedbackOutcome
  effectivenessScore?: number
  beforeState?: Record<string, unknown>
  afterState?: Record<string, unknown>
  notes?: string
}

// ─── Forecast Accuracy ────────────────────────────────────────────────────────

export interface ForecastAccuracyRecord {
  id: string
  tenantId: string
  forecastType: ForecastType
  entityId?: string
  entityType?: string
  forecastHorizon: number
  predictedValue: number
  actualValue?: number
  predictedAt: Date
  measuredAt?: Date
  absoluteError?: number
  squaredError?: number
  confidence?: number
  driftSeverity: DriftSeverity
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface RecordForecastInput {
  forecastType: ForecastType
  entityId?: string
  entityType?: string
  forecastHorizon: number
  predictedValue: number
  predictedAt?: Date
  confidence?: number
  metadata?: Record<string, unknown>
}

export interface ForecastAccuracyStats {
  forecastType: ForecastType
  horizon: number
  sampleCount: number
  meanAbsoluteError: number
  rootMeanSquaredError: number
  meanBias: number           // positive = systematically over-predicting
  driftSeverity: DriftSeverity
  calibrationFactor: number  // multiply predicted by this to correct bias
  lastUpdated: Date
}

// ─── Optimization Feedback ────────────────────────────────────────────────────

export interface OptimizationProposal {
  id: string
  tenantId: string
  optimizationType: OptimizationType
  proposedBy: string
  entityIds: string[]
  entityType?: string
  status: OptimizationStatus
  proposal: Record<string, unknown>
  rationale?: string
  expectedGain?: number
  actualGain?: number
  approvedBy?: string
  appliedAt?: Date
  expiresAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface ProposeOptimizationInput {
  optimizationType: OptimizationType
  proposedBy: string
  entityIds?: string[]
  entityType?: string
  proposal: Record<string, unknown>
  rationale?: string
  expectedGain?: number
  expiresAt?: Date
}

// ─── Recommendation Ranking ───────────────────────────────────────────────────

export interface RankedRecommendation {
  recommendationId: string
  recommendationType: string
  agentType: string
  score: number              // composite rank score 0–100
  urgency: number
  confidence: number
  historicalEffectiveness: number
  entityId?: string
  entityType?: string
  rationale: string
}

// ─── Resource Optimization ────────────────────────────────────────────────────

export interface ResourceAllocation {
  entityId: string
  entityType: string
  currentLoad: number        // 0–100
  predictedPeak: number
  suggestedAction: 'scale_up' | 'scale_down' | 'rebalance' | 'defer' | 'ok'
  actionRationale: string
  confidenceScore: number
}

export interface WorkloadBalancePlan {
  tenantId: string
  generatedAt: Date
  overloadedEntities: ResourceAllocation[]
  underutilizedEntities: ResourceAllocation[]
  transferRecommendations: Array<{
    fromEntityId: string
    toEntityId: string
    workloadPct: number
    rationale: string
  }>
  estimatedGain: number
}

// ─── Root Cause Synthesis ─────────────────────────────────────────────────────

export interface RootCauseCandidate {
  causeType: string
  description: string
  confidence: number         // 0–1
  supportingEvidence: string[]
  affectedEntities: string[]
  contributionScore: number  // 0–100
}

export interface RootCauseReport {
  incidentId: string
  tenantId: string
  primaryCause: RootCauseCandidate
  contributingFactors: RootCauseCandidate[]
  mitigationSuggestions: string[]
  synthesizedAt: Date
}

// ─── Adaptive Anomaly ─────────────────────────────────────────────────────────

export interface AnomalyPattern {
  patternId: string
  tenantId: string
  anomalyType: string
  entityType?: string
  learnedThreshold: number
  falsePositiveRate: number
  truePositiveRate: number
  sampleCount: number
  lastAdjusted: Date
}

// ─── Operational Memory ───────────────────────────────────────────────────────

export interface MemoryInsight {
  key: string
  value: unknown
  confidence: number
  decayRate: number          // per day; 0 = no decay
  learnedAt: Date
  lastReinforced: Date
  expiresAt?: Date
}

// ─── Forecast Calibration ─────────────────────────────────────────────────────

export interface CalibrationResult {
  forecastType: ForecastType
  entityId?: string
  horizon: number
  originalPrediction: number
  calibratedPrediction: number
  calibrationFactor: number
  adjustmentExplained: string
}

// ─── Strategy Plan ────────────────────────────────────────────────────────────

export interface StrategyPlan {
  planId: string
  tenantId: string
  horizon: number             // days
  objectives: string[]
  actions: StrategyAction[]
  riskMitigations: string[]
  contingencies: string[]
  estimatedReadinessGain: number
  generatedAt: Date
}

export interface StrategyAction {
  priority: number
  action: string
  entityId?: string
  entityType?: string
  targetScore?: number
  deadline?: Date
  rationale: string
  requiresApproval: boolean
}

// ─── Consensus Decision ───────────────────────────────────────────────────────

export interface AgentConsensusResult {
  topic: string
  tenantId: string
  agentVotes: Array<{
    agentType: string
    vote: string
    confidence: number
    rationale: string
  }>
  consensus: string | null
  consensusConfidence: number
  conflictingAgents: string[]
  resolvedAt: Date
}

// ─── Simulation Learning ──────────────────────────────────────────────────────

export interface SimulationOutcome {
  scenarioId: string
  tenantId: string
  predictedDelta: number
  actualDelta?: number
  predictionError?: number
  mitigationsApplied: string[]
  effectivenessScore?: number
  recordedAt: Date
}
