// Denver Engineering — Agent Registry (v5.0.0)
// Central registry of all agents and their capability catalog.

import { AgentType, AgentRegistration, AgentCapability } from './agentTypes'

// ─── Registry ────────────────────────────────────────────────────────────────

const AGENT_REGISTRY: AgentRegistration[] = [
  {
    type: 'TaskAgent',
    version: '1.0.0',
    capabilities: [
      {
        id: 'task.create',
        agentType: 'TaskAgent',
        taskTypes: ['create_action', 'assign_action', 'bulk_assign'],
        description: 'Creates and assigns corrective/safety actions',
        requiresApproval: false,
        maxConcurrency: 10,
        averageDurationMs: 800,
        supportedScopes: ['project', 'workflow', 'action'],
      },
      {
        id: 'task.escalate',
        agentType: 'TaskAgent',
        taskTypes: ['escalate_action', 'prioritize_actions'],
        description: 'Escalates and reprioritizes overdue or critical actions',
        requiresApproval: true,
        maxConcurrency: 5,
        averageDurationMs: 1200,
        supportedScopes: ['project', 'workflow'],
      },
    ],
    requiredContext: ['tenant', 'scope', 'policyConstraints'],
    outputSchema: { actionId: 'string', status: 'string' },
    governanceLevel: 'medium',
  },
  {
    type: 'ValidationAgent',
    version: '1.0.0',
    capabilities: [
      {
        id: 'validation.evidence',
        agentType: 'ValidationAgent',
        taskTypes: ['validate_evidence', 'check_completeness'],
        description: 'Validates evidence packages and completion criteria',
        requiresApproval: false,
        maxConcurrency: 20,
        averageDurationMs: 500,
        supportedScopes: ['action', 'workflow'],
      },
      {
        id: 'validation.compliance',
        agentType: 'ValidationAgent',
        taskTypes: ['compliance_check', 'regulatory_review'],
        description: 'Checks compliance with regulatory requirements',
        requiresApproval: true,
        maxConcurrency: 5,
        averageDurationMs: 2000,
        supportedScopes: ['project', 'workflow'],
      },
    ],
    requiredContext: ['tenant', 'scope', 'policyConstraints'],
    outputSchema: { valid: 'boolean', issues: 'array', score: 'number' },
    governanceLevel: 'medium',
  },
  {
    type: 'DocumentationAgent',
    version: '1.0.0',
    capabilities: [
      {
        id: 'doc.generate',
        agentType: 'DocumentationAgent',
        taskTypes: ['generate_report', 'generate_summary', 'draft_runbook'],
        description: 'Generates operational reports and documentation',
        requiresApproval: false,
        maxConcurrency: 5,
        averageDurationMs: 3000,
        supportedScopes: ['project', 'workflow', 'global'],
      },
    ],
    requiredContext: ['tenant', 'scope', 'recentEvents'],
    outputSchema: { documentId: 'string', url: 'string', wordCount: 'number' },
    governanceLevel: 'low',
  },
  {
    type: 'RiskAgent',
    version: '1.0.0',
    capabilities: [
      {
        id: 'risk.analyze',
        agentType: 'RiskAgent',
        taskTypes: ['analyze_risk', 'score_risk', 'flag_risk'],
        description: 'Analyzes and scores operational risks',
        requiresApproval: false,
        maxConcurrency: 10,
        averageDurationMs: 1500,
        supportedScopes: ['project', 'workflow', 'action'],
      },
      {
        id: 'risk.mitigate',
        agentType: 'RiskAgent',
        taskTypes: ['recommend_mitigation', 'auto_mitigate'],
        description: 'Recommends or applies risk mitigations',
        requiresApproval: true,
        maxConcurrency: 3,
        averageDurationMs: 2500,
        supportedScopes: ['project', 'workflow'],
      },
    ],
    requiredContext: ['tenant', 'scope', 'policyConstraints', 'memoryEntries'],
    outputSchema: { riskScore: 'number', level: 'string', mitigations: 'array' },
    governanceLevel: 'high',
  },
  {
    type: 'SchedulingAgent',
    version: '1.0.0',
    capabilities: [
      {
        id: 'schedule.optimize',
        agentType: 'SchedulingAgent',
        taskTypes: ['optimize_schedule', 'resolve_conflicts', 'auto_schedule'],
        description: 'Optimizes task and inspection scheduling',
        requiresApproval: true,
        maxConcurrency: 3,
        averageDurationMs: 2000,
        supportedScopes: ['project', 'workflow'],
      },
    ],
    requiredContext: ['tenant', 'scope', 'policyConstraints'],
    outputSchema: { scheduleUpdates: 'array', conflicts: 'array' },
    governanceLevel: 'medium',
  },
  {
    type: 'ResourceOptimizationAgent',
    version: '1.0.0',
    capabilities: [
      {
        id: 'resource.balance',
        agentType: 'ResourceOptimizationAgent',
        taskTypes: ['balance_workload', 'suggest_assignments', 'rebalance_team'],
        description: 'Balances workloads and optimizes team assignments',
        requiresApproval: true,
        maxConcurrency: 3,
        averageDurationMs: 1800,
        supportedScopes: ['project', 'workflow'],
      },
    ],
    requiredContext: ['tenant', 'scope', 'policyConstraints', 'memoryEntries'],
    outputSchema: { assignments: 'array', utilizationDelta: 'number' },
    governanceLevel: 'high',
  },
  {
    type: 'IncidentResponseAgent',
    version: '1.0.0',
    capabilities: [
      {
        id: 'incident.triage',
        agentType: 'IncidentResponseAgent',
        taskTypes: ['triage_incident', 'auto_escalate', 'notify_stakeholders'],
        description: 'Triages incidents and coordinates response',
        requiresApproval: false,
        maxConcurrency: 5,
        averageDurationMs: 1000,
        supportedScopes: ['project', 'workflow', 'action'],
      },
      {
        id: 'incident.coordinate',
        agentType: 'IncidentResponseAgent',
        taskTypes: ['coordinate_response', 'generate_incident_report'],
        description: 'Coordinates multi-team incident response',
        requiresApproval: true,
        maxConcurrency: 2,
        averageDurationMs: 3000,
        supportedScopes: ['project'],
      },
    ],
    requiredContext: ['tenant', 'scope', 'activeAlerts', 'policyConstraints'],
    outputSchema: { incidentId: 'string', severity: 'string', responders: 'array' },
    governanceLevel: 'high',
  },
  {
    type: 'ReadinessCoordinatorAgent',
    version: '1.0.0',
    capabilities: [
      {
        id: 'readiness.assess',
        agentType: 'ReadinessCoordinatorAgent',
        taskTypes: ['assess_readiness', 'generate_readiness_plan'],
        description: 'Assesses operational readiness and generates improvement plans',
        requiresApproval: false,
        maxConcurrency: 5,
        averageDurationMs: 2500,
        supportedScopes: ['project', 'workflow'],
      },
      {
        id: 'readiness.coordinate',
        agentType: 'ReadinessCoordinatorAgent',
        taskTypes: ['coordinate_readiness', 'trigger_remediation'],
        description: 'Coordinates readiness improvement across systems',
        requiresApproval: true,
        maxConcurrency: 2,
        averageDurationMs: 4000,
        supportedScopes: ['project'],
      },
    ],
    requiredContext: ['tenant', 'scope', 'policyConstraints', 'memoryEntries'],
    outputSchema: { readinessScore: 'number', gaps: 'array', plan: 'object' },
    governanceLevel: 'medium',
  },
]

// Build lookup maps at startup
const _byType = new Map<AgentType, AgentRegistration>(
  AGENT_REGISTRY.map(r => [r.type, r])
)
const _byCapabilityId = new Map<string, AgentCapability>()
const _byTaskType = new Map<string, AgentCapability>()

for (const reg of AGENT_REGISTRY) {
  for (const cap of reg.capabilities) {
    _byCapabilityId.set(cap.id, cap)
    for (const tt of cap.taskTypes) {
      _byTaskType.set(tt, cap)
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getAgentRegistration(type: AgentType): AgentRegistration | undefined {
  return _byType.get(type)
}

export function getAllAgents(): AgentRegistration[] {
  return [...AGENT_REGISTRY]
}

export function getCapabilitiesForAgent(type: AgentType): AgentCapability[] {
  return _byType.get(type)?.capabilities ?? []
}

export function getCapabilityById(id: string): AgentCapability | undefined {
  return _byCapabilityId.get(id)
}

export function getCapabilityForTaskType(taskType: string): AgentCapability | undefined {
  return _byTaskType.get(taskType)
}

export function getAgentForTaskType(taskType: string): AgentType | undefined {
  return _byTaskType.get(taskType)?.agentType
}

export function isAgentRegistered(type: AgentType): boolean {
  return _byType.has(type)
}

export function getGovernanceLevel(type: AgentType): 'low' | 'medium' | 'high' {
  return _byType.get(type)?.governanceLevel ?? 'high'
}

export function requiresApprovalForTaskType(taskType: string): boolean {
  const cap = _byTaskType.get(taskType)
  return cap?.requiresApproval ?? true
}

export function getAllCapabilities(): AgentCapability[] {
  return Array.from(_byCapabilityId.values())
}

export const __testHooks = {
  AGENT_REGISTRY,
  _byType,
  _byTaskType,
  _byCapabilityId,
}
