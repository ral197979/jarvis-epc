// Denver Engineering — Agent Policy Adapter (v5.0.0)
// Bridges the Phase 4 Policy Engine for agent-specific governance checks.

import { evaluatePolicy } from '../policy/policyEngine'
import { AgentType, PolicyCheckResult } from './agentTypes'

// ─── Policy types agent system checks ────────────────────────────────────────

const AGENT_POLICY_TYPES = [
  'approval_requirement',
  'freeze_condition',
  'after_hours_restriction',
  'assignment_restriction',
  'ai_confidence_minimum',
] as const

// ─── Evaluate all relevant policies for an agent action ───────────────────────

export interface AgentPolicyPayload {
  agentType: AgentType
  taskType: string
  riskLevel?: string
  confidenceScore?: number
  actionType?: string
  userId?: string
  role?: string
  [key: string]: unknown
}

export async function evaluateAgentPolicies(
  tenantId: string,
  payload: AgentPolicyPayload
): Promise<PolicyCheckResult[]> {
  const results: PolicyCheckResult[] = []

  for (const policyType of AGENT_POLICY_TYPES) {
    const result = await _checkPolicy(tenantId, policyType, payload)
    results.push(result)
  }

  return results
}

async function _checkPolicy(
  tenantId: string,
  policyType: string,
  payload: AgentPolicyPayload
): Promise<PolicyCheckResult> {
  try {
    const evalResult = await evaluatePolicy(policyType, {
      tenantId,
      payload: { ...payload },
    })

    return {
      policyType,
      passed: !evalResult.blocked,
      action: evalResult.blocked ? 'block' : evalResult.warnings.length > 0 ? 'warn' : 'allow',
      warnings: evalResult.warnings,
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'PolicyBlockedError') {
      const policyErr = err as Error & { policyName?: string }
      return {
        policyType,
        policyName: policyErr.policyName,
        passed: false,
        action: 'block',
        warnings: [],
      }
    }
    // If policy evaluation itself fails, allow through with a warning
    return {
      policyType,
      passed: true,
      action: 'warn',
      warnings: [`Policy evaluation error: ${(err as Error).message}`],
    }
  }
}

// ─── Check if execution is blocked ───────────────────────────────────────────

export function isBlocked(checks: PolicyCheckResult[]): boolean {
  return checks.some(c => !c.passed && c.action === 'block')
}

export function getBlockingPolicy(checks: PolicyCheckResult[]): PolicyCheckResult | undefined {
  return checks.find(c => !c.passed && c.action === 'block')
}

export function collectWarnings(checks: PolicyCheckResult[]): string[] {
  return checks.flatMap(c => c.warnings)
}

export const __testHooks = { _checkPolicy, AGENT_POLICY_TYPES }
