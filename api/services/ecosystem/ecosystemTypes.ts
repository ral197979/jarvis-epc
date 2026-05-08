// Denver Engineering — Ecosystem Platform Types (v9.0.0)
// Shared type definitions for Phase 9 Federated Intelligence + Ecosystem Platform.

// ─── Federated Intelligence ───────────────────────────────────────────────────

export type FederatedContributionStatus =
  | 'pending' | 'privacy_checked' | 'published' | 'rejected' | 'withdrawn'

export type FederatedContributionType =
  | 'recommendation_outcome' | 'anomaly_signature' | 'forecast_accuracy'
  | 'mitigation_effectiveness' | 'industry_benchmark' | 'resource_optimization'
  | 'safety_compliance_trend'

export interface FederatedContribution {
  id: string
  tenantId: string
  contributionType: FederatedContributionType
  anonymizedData: Record<string, unknown>
  privacyHash: string
  kCount: number
  status: FederatedContributionStatus
  optInVerified: boolean
  rejectedReason: string | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface FederatedPattern {
  id: string
  patternType: string
  industrySegment: string | null
  region: string | null
  projectType: string | null
  patternData: Record<string, unknown>
  confidenceScore: number
  contributorCount: number
  kAnonymityMet: boolean
  version: number
  isActive: boolean
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface FederatedModelVersion {
  id: string
  patternType: string
  version: number
  modelChecksum: string
  contributorCount: number
  trainingWindow: { start: Date; end: Date } | null
  releaseNotes: string | null
  isActive: boolean
  activatedAt: Date | null
  createdAt: Date
}

export interface FederatedPrivacyAudit {
  id: string
  contributionId: string | null
  auditType: string
  passed: boolean
  details: Record<string, unknown>
  auditedBy: string
  createdAt: Date
}

// ─── Benchmarking ─────────────────────────────────────────────────────────────

export type BenchmarkMetric =
  | 'sla_compliance' | 'readiness_improvement_rate' | 'forecast_accuracy'
  | 'anomaly_false_positive_rate' | 'incident_closure_time' | 'inspection_throughput'
  | 'commissioning_readiness_velocity' | 'support_adoption_efficiency' | 'ai_usage_efficiency'

export interface BenchmarkCohort {
  id: string
  metricName: BenchmarkMetric
  industrySegment: string | null
  region: string | null
  projectType: string | null
  cohortSize: number
  p25: number | null
  p50: number | null
  p75: number | null
  p90: number | null
  suppressed: boolean
  computedAt: Date
  periodStart: Date | null
  periodEnd: Date | null
}

export interface TenantBenchmarkResult {
  tenantId: string
  metricName: BenchmarkMetric
  tenantValue: number
  cohortP50: number | null
  cohortP75: number | null
  percentileEstimate: 'top_quartile' | 'above_median' | 'below_median' | 'bottom_quartile' | 'insufficient_data'
  computedAt: Date
}

// ─── Playbook Marketplace ─────────────────────────────────────────────────────

export type PlaybookStatus =
  | 'draft' | 'review' | 'approved' | 'published' | 'deprecated' | 'archived'

export interface MarketplacePlaybook {
  id: string
  slug: string
  name: string
  description: string | null
  playbookType: string
  industryTags: string[]
  authorTenantId: string | null
  publisher: string
  status: PlaybookStatus
  currentVersion: string
  sandboxValidated: boolean
  policyCompatible: boolean
  installCount: number
  avgRating: number | null
  metadata: Record<string, unknown>
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface PlaybookVersion {
  id: string
  playbookId: string
  version: string
  definition: Record<string, unknown>
  changelog: string | null
  checksum: string
  isImmutable: boolean
  createdBy: string
  createdAt: Date
}

export interface TenantPlaybookInstall {
  id: string
  tenantId: string
  playbookId: string
  version: string
  installedBy: string
  isActive: boolean
  sandboxRunId: string | null
  installedAt: Date
  uninstalledAt: Date | null
}

// ─── Plugin Framework ─────────────────────────────────────────────────────────

export type PluginStatus =
  | 'draft' | 'review' | 'approved' | 'published' | 'suspended' | 'revoked'

export type PluginType =
  | 'data_connector' | 'dashboard_widget' | 'runbook_step' | 'agent_capability'
  | 'notification_channel' | 'export_format' | 'validation_rule' | 'policy_rule'

export interface Plugin {
  id: string
  slug: string
  name: string
  description: string | null
  pluginType: PluginType
  author: string
  status: PluginStatus
  currentVersion: string
  manifest: Record<string, unknown>
  requiredScopes: string[]
  killSwitch: boolean
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface PluginVersion {
  id: string
  pluginId: string
  version: string
  bundleChecksum: string
  manifest: Record<string, unknown>
  changelog: string | null
  isActive: boolean
  releasedAt: Date | null
  createdAt: Date
}

export interface TenantPluginInstall {
  id: string
  tenantId: string
  pluginId: string
  version: string
  grantedScopes: string[]
  isActive: boolean
  installedBy: string
  installedAt: Date
  disabledAt: Date | null
  rollbackVersion: string | null
}

export interface PluginPermission {
  id: string
  tenantId: string
  pluginId: string
  scope: string
  granted: boolean
  grantedBy: string | null
  grantedAt: Date | null
  revokedAt: Date | null
}

export interface PluginAuditEvent {
  id: string
  tenantId: string | null
  pluginId: string
  eventType: string
  actor: string
  details: Record<string, unknown>
  createdAt: Date
}

// ─── External Agent SDK ───────────────────────────────────────────────────────

export type ExternalAgentStatus = 'registered' | 'active' | 'suspended' | 'revoked'

export interface ExternalAgent {
  id: string
  name: string
  description: string | null
  ownerTenantId: string | null
  status: ExternalAgentStatus
  capabilities: string[]
  allowedScopes: string[]
  publicKey: string | null
  endpointUrl: string | null
  apiKeyHash: string | null
  lastExecutedAt: Date | null
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface ExternalAgentExecution {
  id: string
  agentId: string
  tenantId: string
  requestPayload: Record<string, unknown>
  responsePayload: Record<string, unknown> | null
  validationPassed: boolean
  approvalRequired: boolean
  approvalId: string | null
  executionMs: number | null
  error: string | null
  createdAt: Date
}

// ─── Automation Adapters ──────────────────────────────────────────────────────

export type AutomationAdapterType =
  | 'zapier' | 'make' | 'n8n' | 'power_automate'
  | 'slack_workflow' | 'teams_workflow' | 'custom_webhook'

export interface AutomationAdapter {
  id: string
  tenantId: string
  adapterType: AutomationAdapterType
  name: string
  endpointUrl: string | null
  isActive: boolean
  rateLimitRpm: number
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface AutomationEvent {
  id: string
  adapterId: string
  tenantId: string
  direction: 'inbound' | 'outbound'
  eventType: string
  payload: Record<string, unknown>
  idempotencyKey: string | null
  signatureValid: boolean | null
  processed: boolean
  error: string | null
  retryCount: number
  createdAt: Date
  processedAt: Date | null
}

// ─── Knowledge Graph ──────────────────────────────────────────────────────────

export type KgEntityType =
  | 'project' | 'system' | 'asset' | 'action' | 'incident' | 'deficiency'
  | 'inspection' | 'vendor' | 'playbook' | 'runbook' | 'agent' | 'policy'
  | 'benchmark' | 'evidence' | 'risk' | 'recommendation'

export interface KgEntity {
  id: string
  tenantId: string
  entityType: KgEntityType
  entityRef: string
  label: string
  properties: Record<string, unknown>
  embeddingId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface KgRelationship {
  id: string
  tenantId: string
  fromEntityId: string
  toEntityId: string
  relationshipType: string
  weight: number
  confidence: number
  source: string | null
  properties: Record<string, unknown>
  createdAt: Date
}

// ─── Edge Nodes ───────────────────────────────────────────────────────────────

export type EdgeNodeStatus =
  | 'provisioning' | 'active' | 'degraded' | 'offline' | 'decommissioned'

export type EdgeSyncStatus = 'pending' | 'syncing' | 'completed' | 'conflict' | 'failed'

export interface EdgeNode {
  id: string
  tenantId: string
  nodeName: string
  siteRef: string | null
  status: EdgeNodeStatus
  publicKey: string
  lastSeenAt: Date | null
  version: string
  capabilities: string[]
  metadata: Record<string, unknown>
  revokedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface EdgeSyncSession {
  id: string
  edgeNodeId: string
  tenantId: string
  status: EdgeSyncStatus
  eventsSent: number
  eventsReceived: number
  conflictsDetected: number
  conflictsResolved: number
  startedAt: Date
  completedAt: Date | null
}

// ─── Workflows ────────────────────────────────────────────────────────────────

export type WorkflowStatus = 'draft' | 'testing' | 'published' | 'paused' | 'archived'

export type WorkflowTriggerType =
  | 'event' | 'schedule' | 'webhook' | 'manual' | 'ai_recommended'

export interface Workflow {
  id: string
  tenantId: string
  name: string
  description: string | null
  status: WorkflowStatus
  triggerType: WorkflowTriggerType
  triggerConfig: Record<string, unknown>
  definition: Record<string, unknown>
  policyValidated: boolean
  dryRunPassed: boolean
  currentVersion: number
  publishedBy: string | null
  publishedAt: Date | null
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface WorkflowVersion {
  id: string
  workflowId: string
  version: number
  definition: Record<string, unknown>
  triggerType: WorkflowTriggerType
  triggerConfig: Record<string, unknown>
  changeSummary: string | null
  createdBy: string
  createdAt: Date
}

export interface WorkflowRun {
  id: string
  workflowId: string
  tenantId: string
  version: number
  triggerContext: Record<string, unknown>
  isDryRun: boolean
  status: string
  stepsCompleted: number
  stepsTotal: number
  error: string | null
  startedAt: Date
  completedAt: Date | null
}

// ─── Air-Gap ──────────────────────────────────────────────────────────────────

export interface AirGapLicense {
  id: string
  tenantId: string
  licenseKeyHash: string
  tier: string
  seatLimit: number
  featureSet: string[]
  validFrom: Date
  validUntil: Date
  issuedBy: string
  signature: string
  isActive: boolean
  createdAt: Date
}

// ─── K-Anonymity threshold ────────────────────────────────────────────────────

export const K_ANONYMITY_MIN = 5        // minimum tenants before publishing pattern
export const MIN_BENCHMARK_COHORT = 10  // minimum for benchmark publication
