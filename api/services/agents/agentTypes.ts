// Denver Engineering — Agent Types (v5.0.0)
// Shared type definitions for the Multi-Agent Operational Intelligence system.

// ─── Agent identifiers ────────────────────────────────────────────────────────

export type AgentType =
  | 'TaskAgent'
  | 'ValidationAgent'
  | 'DocumentationAgent'
  | 'RiskAgent'
  | 'SchedulingAgent'
  | 'ResourceOptimizationAgent'
  | 'IncidentResponseAgent'
  | 'ReadinessCoordinatorAgent'

export type TaskStatus =
  | 'queued'
  | 'assigned'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'pending_approval'
  | 'blocked'

export type ExecutionStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused'

export type HandoffStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'completed'
  | 'timed_out'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type MemoryType = 'fact' | 'pattern' | 'preference' | 'outcome'

export type MemoryScopeType = 'project' | 'workflow' | 'action' | 'global' | 'user'

export type LinkType = 'related' | 'caused_by' | 'contradicts' | 'supports'

// ─── Agent capability catalog ─────────────────────────────────────────────────

export interface AgentCapability {
  id: string
  agentType: AgentType
  taskTypes: string[]
  description: string
  requiresApproval: boolean
  maxConcurrency: number
  averageDurationMs: number
  supportedScopes: string[]
}

export interface AgentRegistration {
  type: AgentType
  version: string
  capabilities: AgentCapability[]
  requiredContext: string[]
  outputSchema: Record<string, unknown>
  governanceLevel: 'low' | 'medium' | 'high'
}

// ─── Task definitions ─────────────────────────────────────────────────────────

export interface AgentTask {
  id: string
  tenantId: string
  agentType: AgentType
  taskType: string
  priority: number
  status: TaskStatus
  payload: Record<string, unknown>
  context: Record<string, unknown>
  result?: Record<string, unknown>
  error?: string
  parentTaskId?: string
  executionId?: string
  claimedBy?: string
  claimedAt?: Date
  startedAt?: Date
  completedAt?: Date
  maxRetries: number
  retryCount: number
  scheduledAt: Date
  expiresAt?: Date
  idempotencyKey?: string
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export interface CreateTaskInput {
  tenantId: string
  agentType: AgentType
  taskType: string
  priority?: number
  payload: Record<string, unknown>
  context?: Record<string, unknown>
  parentTaskId?: string
  maxRetries?: number
  scheduledAt?: Date
  expiresAt?: Date
  idempotencyKey?: string
  createdBy: string
}

// ─── Execution definitions ────────────────────────────────────────────────────

export interface AgentExecution {
  id: string
  tenantId: string
  taskId: string
  agentType: AgentType
  agentVersion: string
  status: ExecutionStatus
  inputSnapshot: Record<string, unknown>
  output?: Record<string, unknown>
  policyChecks: PolicyCheckResult[]
  durationMs?: number
  tokensUsed?: number
  startedAt: Date
  completedAt?: Date
  workerId: string
  createdAt: Date
}

export interface PolicyCheckResult {
  policyType: string
  policyName?: string
  passed: boolean
  action: 'allow' | 'block' | 'warn'
  warnings: string[]
}

// ─── Decision trace ───────────────────────────────────────────────────────────

export interface AgentDecisionTrace {
  id: string
  tenantId: string
  executionId: string
  decisionType: string
  rationale: string
  confidence: number
  alternatives: DecisionAlternative[]
  policyContext: Record<string, unknown>
  chosenAction: string
  decidedAt: Date
}

export interface DecisionAlternative {
  action: string
  reason: string
  confidence: number
  rejected: boolean
  rejectionReason?: string
}

// ─── Handoff protocol ─────────────────────────────────────────────────────────

export interface AgentHandoff {
  id: string
  tenantId: string
  fromAgent: AgentType
  toAgent: AgentType
  taskId: string
  executionId?: string
  status: HandoffStatus
  contextPackage: Record<string, unknown>
  reason: string
  acceptedAt?: Date
  completedAt?: Date
  expiresAt?: Date
  createdAt: Date
}

export interface HandoffRequest {
  tenantId: string
  fromAgent: AgentType
  toAgent: AgentType
  taskId: string
  executionId?: string
  contextPackage: Record<string, unknown>
  reason: string
  ttlSeconds?: number
}

// ─── Approval workflow ────────────────────────────────────────────────────────

export interface AgentApproval {
  id: string
  tenantId: string
  taskId: string
  executionId?: string
  agentType: AgentType
  actionType: string
  description: string
  payload: Record<string, unknown>
  riskLevel: RiskLevel
  status: ApprovalStatus
  requestedBy: string
  reviewedBy?: string
  reviewNotes?: string
  reviewedAt?: Date
  expiresAt: Date
  createdAt: Date
}

export interface RequestApprovalInput {
  tenantId: string
  taskId: string
  executionId?: string
  agentType: AgentType
  actionType: string
  description: string
  payload: Record<string, unknown>
  riskLevel?: RiskLevel
  requestedBy: string
  ttlHours?: number
}

// ─── Agent memory ─────────────────────────────────────────────────────────────

export interface AgentMemoryEntry {
  id: string
  tenantId: string
  agentType?: AgentType
  scopeType: MemoryScopeType
  scopeId?: string
  memoryType: MemoryType
  key: string
  value: Record<string, unknown>
  confidence?: number
  sourceExecutionId?: string
  timesAccessed: number
  lastAccessed?: Date
  expiresAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface StoreMemoryInput {
  tenantId: string
  agentType?: AgentType
  scopeType: MemoryScopeType
  scopeId?: string
  memoryType: MemoryType
  key: string
  value: Record<string, unknown>
  confidence?: number
  sourceExecutionId?: string
  expiresAt?: Date
}

// ─── Orchestrator types ───────────────────────────────────────────────────────

export interface ExecutionPlan {
  tasks: PlannedTask[]
  estimatedDurationMs: number
  requiresApproval: boolean
  governanceLevel: 'low' | 'medium' | 'high'
}

export interface PlannedTask {
  agentType: AgentType
  taskType: string
  priority: number
  payload: Record<string, unknown>
  dependsOn: number[]   // indices into tasks array
  estimatedDurationMs: number
}

export interface OrchestratorInput {
  tenantId: string
  objective: string
  scope: string
  scopeId: string
  context: Record<string, unknown>
  requestedBy: string
  options?: {
    dryRun?: boolean
    maxDepth?: number
    timeoutMs?: number
  }
}

export interface OrchestratorResult {
  planId: string
  tasksCreated: number
  executionIds: string[]
  status: 'planned' | 'executing' | 'completed' | 'requires_approval'
  summary: string
}

// ─── Context assembly ─────────────────────────────────────────────────────────

export interface AgentContext {
  tenant: { id: string; name: string }
  scope: { type: string; id: string; metadata: Record<string, unknown> }
  recentEvents: unknown[]
  activeAlerts: unknown[]
  policyConstraints: PolicyCheckResult[]
  memoryEntries: AgentMemoryEntry[]
  assembledAt: Date
}

// ─── Worker types ─────────────────────────────────────────────────────────────

export interface WorkerConfig {
  workerId: string
  agentTypes: AgentType[]
  pollIntervalMs: number
  maxConcurrentTasks: number
  claimBatchSize: number
  staleTaskAgeMinutes: number
}
