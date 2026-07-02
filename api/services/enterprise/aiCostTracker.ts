// Denver Engineering — AI Cost Tracker + Budget Engine (v8.0.0)
// Records AI token usage, enforces monthly budgets, attributes cost by agent/operation.

import { tenantQuery } from '../../db/pool'
import {
  AiUsageRecord, RecordAiUsageInput, AiBudgetStatus,
} from './enterpriseTypes'

// Cost per million tokens by model (USD)
const MODEL_COSTS: Record<string, { prompt: number; completion: number }> = {
  'claude-opus-4-5':    { prompt: 15.00, completion: 75.00 },
  'claude-sonnet-4-5':  { prompt: 3.00,  completion: 15.00 },
  'claude-haiku-3-5':   { prompt: 0.80,  completion: 4.00  },
  'claude-opus-4':      { prompt: 15.00, completion: 75.00 },
  'claude-sonnet-4':    { prompt: 3.00,  completion: 15.00 },
  default:              { prompt: 3.00,  completion: 15.00 },
}

/** Thrown by metered LLM paths when a tenant's monthly AI budget is exceeded. */
export class AiBudgetExceededError extends Error {
  constructor(public readonly status: AiBudgetStatus) {
    super('ai_budget_exceeded')
    this.name = 'AiBudgetExceededError'
  }
}

// ─── Record AI usage ──────────────────────────────────────────────────────────

export async function recordAiUsage(
  tenantId: string,
  input: RecordAiUsageInput,
): Promise<AiUsageRecord> {
  const {
    agentType, model, provider = 'anthropic', operation,
    promptTokens, completionTokens, latencyMs, idempotencyKey, metadata = {},
  } = input

  const costs = MODEL_COSTS[model] ?? MODEL_COSTS.default!
  const costUsd = input.costUsd ?? (
    (promptTokens * costs.prompt + completionTokens * costs.completion) / 1_000_000
  )
  const totalTokens = promptTokens + completionTokens

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO ai_usage_records
      (tenant_id, agent_type, model, provider, operation,
       prompt_tokens, completion_tokens, total_tokens, cost_usd,
       latency_ms, idempotency_key, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      tenantId, agentType ?? null, model, provider, operation,
      promptTokens, completionTokens, totalTokens, costUsd,
      latencyMs ?? null, idempotencyKey ?? null, JSON.stringify(metadata),
    ],
  )

  // Update running spend total on subscription
  await tenantQuery(
    tenantId,
    `UPDATE tenant_subscriptions
     SET ai_spend_current = ai_spend_current + $2, updated_at = now()
     WHERE tenant_id = $1`,
    [tenantId, costUsd],
  )

  return _mapAiUsageRecord(res.rows[0])
}

// ─── Get AI usage records ─────────────────────────────────────────────────────

export async function getAiUsageRecords(
  tenantId: string,
  opts: {
    agentType?: string
    model?: string
    operation?: string
    since?: Date
    limit?: number
  } = {},
): Promise<AiUsageRecord[]> {
  const { agentType, model, operation, since, limit = 500 } = opts
  const params: unknown[] = [tenantId]
  const clauses: string[] = []

  if (agentType != null) { params.push(agentType); clauses.push(`agent_type = $${params.length}`) }
  if (model != null)     { params.push(model);      clauses.push(`model = $${params.length}`) }
  if (operation != null) { params.push(operation);  clauses.push(`operation = $${params.length}`) }
  if (since != null)     { params.push(since);       clauses.push(`created_at >= $${params.length}`) }

  const where = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : ''
  params.push(limit)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM ai_usage_records WHERE tenant_id = $1 ${where}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return res.rows.map(_mapAiUsageRecord)
}

// ─── Get AI budget status ─────────────────────────────────────────────────────

export async function getAiBudgetStatus(tenantId: string): Promise<AiBudgetStatus> {
  const subRes = await tenantQuery(
    tenantId,
    `SELECT ai_budget_monthly, ai_spend_current FROM tenant_subscriptions WHERE tenant_id = $1`,
    [tenantId],
  )

  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  const sub = subRes.rows[0]
  const budgetMonthly = sub?.ai_budget_monthly != null ? Number(sub.ai_budget_monthly) : undefined
  const spendCurrent = Number(sub?.ai_spend_current ?? 0)

  const remainingBudget = budgetMonthly != null ? Math.max(0, budgetMonthly - spendCurrent) : undefined
  const utilizationPct = budgetMonthly != null && budgetMonthly > 0
    ? Math.round((spendCurrent / budgetMonthly) * 100 * 10) / 10
    : undefined

  return {
    tenantId,
    budgetMonthly,
    spendCurrent,
    remainingBudget,
    utilizationPct,
    isOverBudget: budgetMonthly != null ? spendCurrent > budgetMonthly : false,
    isNearLimit: budgetMonthly != null ? spendCurrent >= budgetMonthly * 0.8 : false,
    periodStart,
    periodEnd,
  }
}

// ─── Get cost by agent type ───────────────────────────────────────────────────

export async function getAiCostByAgent(
  tenantId: string,
  since?: Date,
): Promise<Array<{ agentType: string | null; totalCost: number; totalTokens: number; callCount: number }>> {
  const params: unknown[] = [tenantId]
  let dateCond = ''
  if (since != null) { params.push(since); dateCond = `AND created_at >= $${params.length}` }

  const res = await tenantQuery(
    tenantId,
    `SELECT agent_type,
            SUM(cost_usd)::float       AS total_cost,
            SUM(total_tokens)::int     AS total_tokens,
            COUNT(*)::int              AS call_count
     FROM ai_usage_records
     WHERE tenant_id = $1 ${dateCond}
     GROUP BY agent_type
     ORDER BY total_cost DESC`,
    params,
  )

  return res.rows.map(r => ({
    agentType: r.agent_type != null ? String(r.agent_type) : null,
    totalCost: Number(r.total_cost ?? 0),
    totalTokens: Number(r.total_tokens ?? 0),
    callCount: Number(r.call_count ?? 0),
  }))
}

// ─── Reset monthly spend (called by billing cycle) ────────────────────────────

export async function resetMonthlySpend(tenantId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE tenant_subscriptions SET ai_spend_current = 0, updated_at = now() WHERE tenant_id = $1`,
    [tenantId],
  )
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

export function _mapAiUsageRecord(row: Record<string, unknown>): AiUsageRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    agentType: row.agent_type != null ? String(row.agent_type) : undefined,
    model: String(row.model),
    provider: String(row.provider),
    operation: String(row.operation),
    promptTokens: Number(row.prompt_tokens),
    completionTokens: Number(row.completion_tokens),
    totalTokens: Number(row.total_tokens),
    costUsd: Number(row.cost_usd),
    latencyMs: row.latency_ms != null ? Number(row.latency_ms) : undefined,
    idempotencyKey: row.idempotency_key != null ? String(row.idempotency_key) : undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
  }
}

export const __testHooks = { _mapAiUsageRecord, MODEL_COSTS }
