/**
 * Denver Engineering — Enterprise Policy Engine (v4.40.0)
 * ────────────────────────────────────────────────────────
 * Ava Phase 4 — Evaluates tenant-configurable governance policies
 * against operational contexts. Supports inheritance, override
 * precedence, audit logging, and deterministic evaluation.
 *
 * Evaluation order (highest to lowest precedence):
 *   severity → role → workflow → module → project → tenant
 */

import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PolicyScope = 'tenant' | 'project' | 'module' | 'role' | 'workflow' | 'severity'

export interface PolicyRule {
  field:    string         // e.g. 'escalation_level', 'priority', 'action_type'
  operator: 'eq' | 'gte' | 'lte' | 'in' | 'not_in' | 'exists'
  value:    unknown
}

export interface Policy {
  id:          string
  tenantId:    string
  name:        string
  scope:       PolicyScope
  scopeId?:    string
  policyType:  string
  rules:       PolicyRule[]
  priority:    number
  status:      string
}

export interface EvaluationContext {
  tenantId:    string
  projectId?:  string
  module?:     string
  role?:       string
  workflow?:   string
  severity?:   string
  actorId?:    string
  resource?:   string
  resourceId?: string
  payload:     Record<string, unknown>
}

export interface PolicyEvalResult {
  outcome:        'allowed' | 'blocked' | 'warned'
  matchedPolicy?: Policy
  blockedBy?:     string
  warnings:       string[]
}

// ─── Policy Scope Precedence ──────────────────────────────────────────────────

const SCOPE_ORDER: PolicyScope[] = ['severity', 'role', 'workflow', 'module', 'project', 'tenant']

// ─── Rule Evaluator ───────────────────────────────────────────────────────────

export function _evaluateRule(
  rule: PolicyRule,
  payload: Record<string, unknown>
): boolean {
  const val = payload[rule.field]
  switch (rule.operator) {
    case 'eq':      return val === rule.value
    case 'gte':     return typeof val === 'number' && typeof rule.value === 'number' && val >= rule.value
    case 'lte':     return typeof val === 'number' && typeof rule.value === 'number' && val <= rule.value
    case 'in':      return Array.isArray(rule.value) && rule.value.includes(val)
    case 'not_in':  return Array.isArray(rule.value) && !rule.value.includes(val)
    case 'exists':  return val !== undefined && val !== null
    default:        return false
  }
}

export function _evaluateRules(
  rules: PolicyRule[],
  payload: Record<string, unknown>
): boolean {
  // All rules must match (AND logic)
  return rules.every(r => _evaluateRule(r, payload))
}

// ─── Get Policies for Context ─────────────────────────────────────────────────

export async function getPoliciesForContext(
  tenantId: string,
  policyType: string,
  ctx: Partial<EvaluationContext>
): Promise<Policy[]> {
  const { rows } = await tenantQuery(tenantId, `
    SELECT id, tenant_id, name, scope, scope_id, policy_type, rules, priority, status
    FROM governance_policies
    WHERE tenant_id = $1
      AND policy_type = $2
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
      AND effective_at <= now()
    ORDER BY priority ASC, scope ASC
  `, [tenantId, policyType])

  // Filter by scope relevance
  return (rows as Policy[]).filter(p => {
    if (p.scope === 'tenant')   return true
    if (p.scope === 'project')  return !p.scopeId || p.scopeId === ctx.projectId
    if (p.scope === 'module')   return !p.scopeId || p.scopeId === ctx.module
    if (p.scope === 'role')     return !p.scopeId || p.scopeId === ctx.role
    if (p.scope === 'workflow') return !p.scopeId || p.scopeId === ctx.workflow
    if (p.scope === 'severity') return !p.scopeId || p.scopeId === ctx.severity
    return false
  }).sort((a, b) => {
    const oa = SCOPE_ORDER.indexOf(a.scope)
    const ob = SCOPE_ORDER.indexOf(b.scope)
    if (oa !== ob) return oa - ob   // higher scope first
    return a.priority - b.priority  // then by priority
  })
}

// ─── _inheritPolicies ─────────────────────────────────────────────────────────
// Merges policies from all scopes, with more specific scopes overriding broader ones.

export function _inheritPolicies(
  policies: Policy[]
): Policy[] {
  const seen = new Map<string, Policy>()
  for (const p of policies) {
    const key = `${p.policyType}:${p.scope}:${p.scopeId ?? ''}`
    if (!seen.has(key)) seen.set(key, p)  // first match wins (highest precedence)
  }
  return Array.from(seen.values())
}

// ─── Evaluate ─────────────────────────────────────────────────────────────────

export async function evaluatePolicy(
  policyType: string,
  ctx: EvaluationContext
): Promise<PolicyEvalResult> {
  const policies = await getPoliciesForContext(ctx.tenantId, policyType, ctx)
  const inherited = _inheritPolicies(policies)
  const warnings: string[] = []

  for (const policy of inherited) {
    const matches = _evaluateRules(policy.rules, ctx.payload)
    if (!matches) continue

    // Determine enforcement action from policy config
    const action = (ctx.payload['enforcement_action'] as string) ?? 'block'

    if (action === 'warn') {
      warnings.push(`Policy "${policy.name}" matched — warning only`)
      continue
    }

    // Block: log and return
    await _logPolicyAudit(ctx, policy, 'enforced', 'blocked')
    return { outcome: 'blocked', matchedPolicy: policy,
      blockedBy: policy.name, warnings }
  }

  if (warnings.length > 0) {
    await _logPolicyAudit(ctx, inherited[0] ?? null, 'evaluated', 'warned')
    return { outcome: 'warned', warnings }
  }

  return { outcome: 'allowed', warnings }
}

// ─── Enforce (throws on block) ────────────────────────────────────────────────

export async function enforcePolicy(
  policyType: string,
  ctx: EvaluationContext
): Promise<void> {
  const result = await evaluatePolicy(policyType, ctx)
  if (result.outcome === 'blocked') {
    throw new PolicyBlockedError(result.blockedBy ?? 'policy', result.matchedPolicy)
  }
}

export class PolicyBlockedError extends Error {
  constructor(public policyName: string, public policy?: Policy) {
    super(`Policy blocked: ${policyName}`)
    this.name = 'PolicyBlockedError'
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createPolicy(
  tenantId: string,
  input: Omit<Policy, 'id' | 'tenantId' | 'status'> & { createdBy: string }
): Promise<string> {
  const { rows } = await tenantQuery(tenantId, `
    INSERT INTO governance_policies
      (tenant_id, name, scope, scope_id, policy_type, rules, priority, created_by)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
    RETURNING id
  `, [tenantId, input.name, input.scope, input.scopeId ?? null,
      input.policyType, JSON.stringify(input.rules), input.priority, input.createdBy])
  return rows[0]!.id as string
}

export async function updatePolicy(
  tenantId: string,
  policyId: string,
  updates: Partial<Pick<Policy, 'rules' | 'priority' | 'status'>>
): Promise<boolean> {
  const setClauses: string[] = []
  const vals: unknown[] = [tenantId, policyId]
  if (updates.rules !== undefined) {
    vals.push(JSON.stringify(updates.rules))
    setClauses.push(`rules = $${vals.length}::jsonb`)
  }
  if (updates.priority !== undefined) {
    vals.push(updates.priority)
    setClauses.push(`priority = $${vals.length}`)
  }
  if (updates.status !== undefined) {
    vals.push(updates.status)
    setClauses.push(`status = $${vals.length}`)
  }
  if (!setClauses.length) return false
  setClauses.push(`updated_at = now(), version = version + 1`)
  const { rowCount } = await tenantQuery(tenantId, `
    UPDATE governance_policies SET ${setClauses.join(', ')}
    WHERE tenant_id = $1 AND id = $2
  `, vals)
  return (rowCount ?? 0) > 0
}

// ─── Audit Helper ─────────────────────────────────────────────────────────────

async function _logPolicyAudit(
  ctx: EvaluationContext,
  policy: Policy | null,
  eventType: string,
  outcome: string
): Promise<void> {
  if (!policy) return
  try {
    await tenantQuery(ctx.tenantId, `
      INSERT INTO policy_audit_log
        (tenant_id, policy_id, event_type, context, actor_id, resource, resource_id, outcome)
      VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)
    `, [ctx.tenantId, policy.id, eventType, JSON.stringify(ctx.payload),
        ctx.actorId ?? null, ctx.resource ?? null, ctx.resourceId ?? null, outcome])
  } catch { /* never block on audit failure */ }
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _evaluateRule,
  _evaluateRules,
  _inheritPolicies,
  evaluatePolicy,
  enforcePolicy,
  getPoliciesForContext,
  PolicyBlockedError,
}
