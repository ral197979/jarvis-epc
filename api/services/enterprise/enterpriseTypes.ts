// Denver Engineering — Enterprise Platform Types (v8.0.0)
// Shared type definitions for Phase 8 Enterprise Deployment Platform.

// ─── Enums ────────────────────────────────────────────────────────────────────

export type TenantLifecycleStatus =
  | 'trial' | 'onboarding' | 'active' | 'suspended' | 'cancelled' | 'archived'

export type SubscriptionTier = 'starter' | 'professional' | 'enterprise' | 'custom'

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused'

export type BillingEventType =
  | 'usage' | 'seat' | 'storage' | 'ai_tokens' | 'api_calls' | 'simulation' | 'adjustment' | 'credit'

export type OnboardingStage =
  | 'organization_setup' | 'project_import' | 'role_assignment'
  | 'integrations' | 'feature_activation' | 'training_completion' | 'completed'

export type OnboardingTaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'

export type SupportTicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed'

export type SupportTicketPriority = 'low' | 'medium' | 'high' | 'critical'

export type ExportFormat = 'csv' | 'json' | 'pdf' | 'parquet'

export type ExportStatus = 'pending' | 'running' | 'completed' | 'failed' | 'expired'

export type ApiKeyStatus = 'active' | 'revoked' | 'expired' | 'suspended'

// ─── Tenant Subscription ──────────────────────────────────────────────────────

export interface TenantSubscription {
  id: string
  tenantId: string
  tier: SubscriptionTier
  status: SubscriptionStatus
  lifecycleStatus: TenantLifecycleStatus
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  trialEndsAt?: Date
  currentPeriodStart?: Date
  currentPeriodEnd?: Date
  seatCount: number
  seatLimit: number
  aiBudgetMonthly?: number
  aiSpendCurrent: number
  storageLimitGb: number
  apiQuotaMonthly: number
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface CreateSubscriptionInput {
  tenantId: string
  tier?: SubscriptionTier
  seatLimit?: number
  aiBudgetMonthly?: number
  storageLimitGb?: number
  apiQuotaMonthly?: number
  trialDays?: number
}

// ─── Tenant Usage ─────────────────────────────────────────────────────────────

export interface TenantUsageRecord {
  id: string
  tenantId: string
  periodStart: Date
  periodEnd: Date
  eventType: BillingEventType
  quantity: number
  unit: string
  unitCost?: number
  totalCost?: number
  idempotencyKey?: string
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface RecordUsageInput {
  eventType: BillingEventType
  quantity: number
  unit: string
  unitCost?: number
  periodStart?: Date
  periodEnd?: Date
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

export interface UsageSummary {
  tenantId: string
  periodStart: Date
  periodEnd: Date
  totalCostUsd: number
  byType: Partial<Record<BillingEventType, { quantity: number; cost: number; unit: string }>>
}

// ─── Feature Flags ────────────────────────────────────────────────────────────

export interface TenantFeatureFlag {
  id: string
  tenantId: string
  featureKey: string
  enabled: boolean
  config: Record<string, unknown>
  grantedBy?: string
  expiresAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface SetFeatureFlagInput {
  featureKey: string
  enabled: boolean
  config?: Record<string, unknown>
  grantedBy?: string
  expiresAt?: Date
}

// Known feature keys
export const FEATURE_KEYS = {
  DIGITAL_TWIN: 'digital_twin',
  ADAPTIVE_INTELLIGENCE: 'adaptive_intelligence',
  SCENARIO_SIMULATION: 'scenario_simulation',
  MULTI_AGENT: 'multi_agent',
  COMPLIANCE_EXPORT: 'compliance_export',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  API_ACCESS: 'api_access',
  WEBHOOK_DELIVERY: 'webhook_delivery',
  AI_AGENTS: 'ai_agents',
  PREDICTIVE_MAINTENANCE: 'predictive_maintenance',
} as const

// ─── Lifecycle Events ─────────────────────────────────────────────────────────

export interface TenantLifecycleEvent {
  id: string
  tenantId: string
  eventType: string
  fromStatus?: TenantLifecycleStatus
  toStatus: TenantLifecycleStatus
  actor?: string
  reason?: string
  metadata: Record<string, unknown>
  createdAt: Date
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

export interface OnboardingTask {
  id: string
  tenantId: string
  stage: OnboardingStage
  taskKey: string
  title: string
  description?: string
  status: OnboardingTaskStatus
  sequence: number
  required: boolean
  completedAt?: Date
  skippedAt?: Date
  error?: string
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface OnboardingProgress {
  tenantId: string
  currentStage: OnboardingStage
  totalTasks: number
  completedTasks: number
  skippedTasks: number
  failedTasks: number
  progressPct: number
  isComplete: boolean
  tasks: OnboardingTask[]
}

// ─── Support Tickets ──────────────────────────────────────────────────────────

export interface SupportTicket {
  id: string
  tenantId: string
  ticketNumber: string
  title: string
  description?: string
  status: SupportTicketStatus
  priority: SupportTicketPriority
  reporter?: string
  assignee?: string
  tags: string[]
  escalatedAt?: Date
  resolvedAt?: Date
  closedAt?: Date
  slaDeadline?: Date
  metadata: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface CreateTicketInput {
  title: string
  description?: string
  priority?: SupportTicketPriority
  reporter?: string
  tags?: string[]
}

// ─── Customer Health ──────────────────────────────────────────────────────────

export interface CustomerHealthScore {
  tenantId: string
  tenantHealthScore: number       // 0–100
  adoptionScore: number           // 0–100
  riskOfChurn: number             // 0–100
  supportLoad: number             // 0–100 (higher = more support needed)
  aiUsageEfficiency: number       // 0–100
  activeUsers7Days: number
  featuresEnabled: number
  openTicketCount: number
  generatedAt: Date
}

// ─── AI Usage ─────────────────────────────────────────────────────────────────

export interface AiUsageRecord {
  id: string
  tenantId: string
  agentType?: string
  model: string
  provider: string
  operation: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  costUsd: number
  latencyMs?: number
  idempotencyKey?: string
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface RecordAiUsageInput {
  agentType?: string
  model: string
  provider?: string
  operation: string
  promptTokens: number
  completionTokens: number
  costUsd?: number
  latencyMs?: number
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

export interface AiBudgetStatus {
  tenantId: string
  budgetMonthly?: number
  spendCurrent: number
  remainingBudget?: number
  utilizationPct?: number
  isOverBudget: boolean
  isNearLimit: boolean          // within 20% of limit
  periodStart: Date
  periodEnd: Date
}

// ─── Compliance Export ────────────────────────────────────────────────────────

export interface ComplianceExport {
  id: string
  tenantId: string
  exportType: string
  format: ExportFormat
  status: ExportStatus
  requestedBy?: string
  filterFrom?: Date
  filterTo?: Date
  recordCount?: number
  fileSizeBytes?: number
  storagePath?: string
  checksum?: string
  manifest: Record<string, unknown>
  expiresAt?: Date
  completedAt?: Date
  error?: string
  createdAt: Date
}

export interface RequestExportInput {
  exportType: string
  format: ExportFormat
  requestedBy?: string
  filterFrom?: Date
  filterTo?: Date
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string
  tenantId: string
  keyHash: string
  keyPrefix: string
  name: string
  status: ApiKeyStatus
  scopes: string[]
  quotaMonthly?: number
  usageThisMonth: number
  lastUsedAt?: Date
  expiresAt?: Date
  revokedAt?: Date
  revokedBy?: string
  createdBy?: string
  metadata: Record<string, unknown>
  createdAt: Date
}

export interface CreateApiKeyInput {
  name: string
  scopes?: string[]
  quotaMonthly?: number
  expiresAt?: Date
  createdBy?: string
}

export interface ApiKeyWithSecret {
  key: ApiKey
  secret: string   // returned only on creation; never stored in plaintext
}

// ─── Deployment Health ────────────────────────────────────────────────────────

export interface DeploymentHealthCheck {
  id: string
  checkName: string
  status: 'passing' | 'warning' | 'failing'
  message?: string
  value?: number
  threshold?: number
  metadata: Record<string, unknown>
  checkedAt: Date
}

export interface DeploymentHealthReport {
  overall: 'healthy' | 'degraded' | 'unhealthy'
  checks: DeploymentHealthCheck[]
  failingCount: number
  warningCount: number
  passingCount: number
  generatedAt: Date
}

// ─── Demo Tenants ─────────────────────────────────────────────────────────────

export interface DemoTenant {
  id: string
  tenantId: string
  industry: string
  templateKey: string
  label: string
  status: string
  seededAt?: Date
  expiresAt?: Date
  lastResetAt?: Date
  createdBy?: string
  metadata: Record<string, unknown>
  createdAt: Date
}
