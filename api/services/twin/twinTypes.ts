// Denver Engineering — Twin Types (v6.0.0)
// Shared type definitions for the Operational Digital Twin system.

// ─── Entity types ─────────────────────────────────────────────────────────────

export type TwinEntityType =
  | 'project' | 'system' | 'subsystem' | 'equipment' | 'tag'
  | 'workflow' | 'action' | 'inspection' | 'deficiency'
  | 'permit' | 'vendor' | 'workforce' | 'site' | 'region'

export type TwinStatus =
  | 'active' | 'inactive' | 'degraded' | 'failed' | 'maintenance' | 'decommissioned'

export type TwinRelType =
  | 'depends_on' | 'blocks' | 'contains' | 'feeds_into' | 'peer'
  | 'owns' | 'inspects' | 'permits' | 'maintains'

export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical'

export type ScenarioStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

// ─── Twin models ──────────────────────────────────────────────────────────────

export interface OperationalTwin {
  id: string
  tenantId: string
  entityType: TwinEntityType
  entityId: string
  name: string
  description?: string
  status: TwinStatus
  metadata: Record<string, unknown>
  readinessScore?: number
  riskScore?: number
  healthScore?: number
  lastSyncedAt?: Date
  syncLagMs?: number
  createdAt: Date
  updatedAt: Date
}

export interface RegisterTwinInput {
  tenantId: string
  entityType: TwinEntityType
  entityId: string
  name: string
  description?: string
  metadata?: Record<string, unknown>
  readinessScore?: number
  riskScore?: number
  healthScore?: number
}

// ─── Snapshot models ──────────────────────────────────────────────────────────

export interface TwinStateSnapshot {
  id: string
  tenantId: string
  twinId: string
  snapshotAt: Date
  sequenceNum: number
  state: Record<string, unknown>
  diff?: Record<string, unknown>
  checksum: string
  triggeringEventId?: string
}

// ─── Relationship models ──────────────────────────────────────────────────────

export interface TwinRelationship {
  id: string
  tenantId: string
  fromTwinId: string
  toTwinId: string
  relType: TwinRelType
  weight: number
  metadata: Record<string, unknown>
  validFrom: Date
  validTo?: Date
  createdAt: Date
}

export interface AddRelationshipInput {
  tenantId: string
  fromTwinId: string
  toTwinId: string
  relType: TwinRelType
  weight?: number
  metadata?: Record<string, unknown>
}

// ─── Graph models ─────────────────────────────────────────────────────────────

export interface GraphNode {
  twinId: string
  entityType: TwinEntityType
  entityId: string
  name: string
  status: TwinStatus
  readinessScore?: number
  riskScore?: number
  depth: number
  metadata: Record<string, unknown>
}

export interface GraphEdge {
  fromTwinId: string
  toTwinId: string
  relType: TwinRelType
  weight: number
}

export interface GraphTraversalResult {
  nodes: GraphNode[]
  edges: GraphEdge[]
  criticalityScore: number
  dependencyDepth: number
  impactedEntities: string[]
  operationalRiskPath: string[]
  hasCycles: boolean
}

export interface RiskPropagationResult {
  rootTwinId: string
  propagatedRisk: Map<string, number>
  propagationPath: string[]
  totalImpactScore: number
  criticalNodes: string[]
}

// ─── Temporal models ──────────────────────────────────────────────────────────

export interface TemporalProjection {
  twinId: string
  horizonDays: number
  projectedReadiness: TimeSeriesPoint[]
  projectedSlaBreachProbability: number
  projectedWorkload: TimeSeriesPoint[]
  projectedResourceConflicts: TimeSeriesPoint[]
  confidence: number
  explanation: string
  computedAt: Date
}

export interface TimeSeriesPoint {
  ts: Date
  value: number
  lowerBound?: number
  upperBound?: number
}

// ─── Forecast models ──────────────────────────────────────────────────────────

export interface OperationalForecast {
  id: string
  tenantId: string
  forecastType: string
  scopeType: string
  scopeId: string
  horizonDays: number
  projections: Record<string, unknown>
  confidence?: number
  computedAt: Date
  validUntil: Date
}

export interface ForecastInput {
  tenantId: string
  forecastType: string
  scopeType: string
  scopeId: string
  horizonDays?: number
}

// ─── Anomaly models ───────────────────────────────────────────────────────────

export interface OperationalAnomaly {
  id: string
  tenantId: string
  twinId?: string
  anomalyType: string
  severity: AnomalySeverity
  anomalyScore: number
  impactedEntities: string[]
  explanation: string
  suggestedActions: string[]
  baselineValue?: number
  observedValue?: number
  detectedAt: Date
  resolvedAt?: Date
  falsePositive: boolean
  metadata: Record<string, unknown>
}

export interface AnomalyDetectionInput {
  tenantId: string
  twinId?: string
  windowDays?: number
}

// ─── Scenario models ──────────────────────────────────────────────────────────

export interface ScenarioSimulation {
  id: string
  tenantId: string
  name: string
  scenarioType: string
  status: ScenarioStatus
  config: Record<string, unknown>
  baseSnapshotId?: string
  injectedEvents: ScenarioEvent[]
  results?: ScenarioResult
  projectedReadinessImpact?: number
  projectedSlaImpact?: number
  confidenceScore?: number
  isolationToken: string
  createdBy: string
  createdAt: Date
  completedAt?: Date
}

export interface ScenarioEvent {
  eventType: string
  targetEntityId: string
  payload: Record<string, unknown>
  offsetDays: number
}

export interface ScenarioResult {
  readinessDelta: number
  slaBreachCount: number
  estimatedDelayDays: number
  resourceConflicts: number
  mitigationRecommendations: string[]
  simulatedTimeline: TimeSeriesPoint[]
  bottlenecks: string[]
}

export interface RunScenarioInput {
  tenantId: string
  name: string
  scenarioType: string
  config: Record<string, unknown>
  injectedEvents: ScenarioEvent[]
  baseSnapshotId?: string
  createdBy: string
}

// ─── Maintenance models ───────────────────────────────────────────────────────

export interface MaintenanceRecommendation {
  twinId: string
  entityType: TwinEntityType
  entityId: string
  priority: 'immediate' | 'high' | 'medium' | 'low'
  predictedFailureRisk: number
  recommendedWindowStart?: Date
  recommendedWindowEnd?: Date
  maintenanceType: string
  rationale: string
  estimatedDuration: string
}

export interface AssetHealthScore {
  twinId: string
  overallScore: number
  components: {
    inspectionScore: number
    deficiencyScore: number
    incidentScore: number
    ageScore: number
    utilizationScore: number
  }
  trend: 'improving' | 'stable' | 'degrading'
  lastAssessedAt: Date
}

// ─── Portfolio models ─────────────────────────────────────────────────────────

export interface PortfolioReadiness {
  tenantId: string
  projectCount: number
  averageReadiness: number
  readinessByProject: Record<string, number>
  atRiskProjects: string[]
  topRisks: string[]
  computedAt: Date
}

export interface PortfolioConflict {
  conflictType: string
  severity: AnomalySeverity
  involvedProjectIds: string[]
  description: string
  suggestedResolution: string
}
