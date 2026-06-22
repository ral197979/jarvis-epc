/* eslint-disable @typescript-eslint/no-unused-vars */
// Denver Engineering — Agent Router (v5.0.0)
// Routes task requests to the appropriate agent based on capability matching.

import { AgentType, AgentCapability, ExecutionPlan, PlannedTask } from './agentTypes'
import { getAgentForTaskType, getCapabilityForTaskType, getAllCapabilities, requiresApprovalForTaskType, getGovernanceLevel } from './agentRegistry'

// ─── Routing ──────────────────────────────────────────────────────────────────

export interface RoutingDecision {
  agentType: AgentType
  capability: AgentCapability
  requiresApproval: boolean
  governanceLevel: 'low' | 'medium' | 'high'
  estimatedDurationMs: number
}

export function routeTask(taskType: string): RoutingDecision {
  const agentType = getAgentForTaskType(taskType)
  if (!agentType) {
    throw new Error(`No agent registered for task type: ${taskType}`)
  }
  const capability = getCapabilityForTaskType(taskType)!
  return {
    agentType,
    capability,
    requiresApproval: requiresApprovalForTaskType(taskType),
    governanceLevel: getGovernanceLevel(agentType),
    estimatedDurationMs: capability.averageDurationMs,
  }
}

export function canRoute(taskType: string): boolean {
  return getAgentForTaskType(taskType) !== undefined
}

// ─── Multi-task planning ──────────────────────────────────────────────────────

export interface RoutingHint {
  taskType: string
  priority?: number
  payload?: Record<string, unknown>
  dependsOnIndex?: number[]
}

export function planExecution(hints: RoutingHint[]): ExecutionPlan {
  const tasks: PlannedTask[] = []
  let requiresApproval = false
  let estimatedTotal = 0

  for (const hint of hints) {
    const decision = routeTask(hint.taskType)
    if (decision.requiresApproval) requiresApproval = true
    estimatedTotal += decision.estimatedDurationMs

    tasks.push({
      agentType: decision.agentType,
      taskType: hint.taskType,
      priority: hint.priority ?? 5,
      payload: hint.payload ?? {},
      dependsOn: hint.dependsOnIndex ?? [],
      estimatedDurationMs: decision.estimatedDurationMs,
    })
  }

  const highestGovernance = _highestGovernanceLevel(tasks.map(t => t.agentType))

  return {
    tasks,
    estimatedDurationMs: estimatedTotal,
    requiresApproval,
    governanceLevel: highestGovernance,
  }
}

// ─── Capability discovery ─────────────────────────────────────────────────────

export function getCapabilitiesMatchingScope(scope: string): AgentCapability[] {
  return getAllCapabilities().filter(cap => cap.supportedScopes.includes(scope))
}

export function getCapabilitiesForAgentTypes(types: AgentType[]): AgentCapability[] {
  const typeSet = new Set<AgentType>(types)
  return getAllCapabilities().filter(cap => typeSet.has(cap.agentType))
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _highestGovernanceLevel(
  agentTypes: AgentType[]
): 'low' | 'medium' | 'high' {
  const order = { low: 0, medium: 1, high: 2 }
  let highest: 'low' | 'medium' | 'high' = 'low'
  for (const t of agentTypes) {
    const level = getGovernanceLevel(t)
    if (order[level] > order[highest]) highest = level
  }
  return highest
}

export const __testHooks = {
  _highestGovernanceLevel,
}
