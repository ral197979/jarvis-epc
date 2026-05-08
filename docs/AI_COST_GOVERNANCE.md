# AI Cost Governance

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Overview

Every AI inference call is tracked at the token level, attributed to a specific agent and operation, and applied against a monthly budget ceiling. Cost governance is non-blocking by default — over-budget tenants receive warnings, not hard stops — but budget enforcement can be applied at the route layer using `getAiBudgetStatus()`.

## Cost Attribution

Each `ai_usage_records` row captures:
- `tenant_id` — multi-tenant isolation via RLS
- `agent_type` — which Ava agent made the call (nullable for platform calls)
- `model` — exact model used (e.g., `claude-sonnet-4-5`)
- `provider` — `'anthropic'` by default
- `operation` — `'inference' | 'embedding' | 'simulation' | 'recommendation'`
- `prompt_tokens`, `completion_tokens`, `total_tokens`
- `cost_usd` — auto-calculated or provided explicitly

## Cost Calculation

If `costUsd` is not provided in `RecordAiUsageInput`, it is computed from MODEL_COSTS:

```typescript
const costs = MODEL_COSTS[model] ?? MODEL_COSTS.default
const costUsd = (promptTokens * costs.prompt + completionTokens * costs.completion) / 1_000_000
```

Current rates (USD per million tokens):

| Model | Prompt | Completion |
|-------|--------|-----------|
| claude-opus-4-5 | $15.00 | $75.00 |
| claude-sonnet-4-5 | $3.00 | $15.00 |
| claude-haiku-3-5 | $0.80 | $4.00 |
| claude-opus-4 | $15.00 | $75.00 |
| claude-sonnet-4 | $3.00 | $15.00 |
| default | $3.00 | $15.00 |

## Running Spend

After each `recordAiUsage()` call, the subscription's `ai_spend_current` column is incremented atomically:

```sql
UPDATE tenant_subscriptions
SET ai_spend_current = ai_spend_current + $cost
WHERE tenant_id = $1
```

This provides an O(1) budget status read without aggregating `ai_usage_records`.

## Budget Status

`getAiBudgetStatus()` returns `AiBudgetStatus`:

```typescript
{
  budgetMonthly?: number      // undefined = unlimited (custom tier)
  spendCurrent: number        // from tenant_subscriptions
  remainingBudget?: number    // undefined when unlimited
  utilizationPct?: number     // 0–100+, undefined when unlimited
  isOverBudget: boolean       // spendCurrent > budgetMonthly
  isNearLimit: boolean        // spendCurrent >= budgetMonthly * 0.8 (within 20%)
}
```

## Cost by Agent

`getAiCostByAgent()` aggregates cost/token/call counts by `agent_type` in a single GROUP BY query. Used for internal cost attribution and CSM reporting.

## Monthly Reset

`resetMonthlySpend()` sets `ai_spend_current = 0` on the subscription. This should be called by the billing cycle job at the start of each billing period. It does not affect the audit records in `ai_usage_records`.

## Idempotency

`ai_usage_records` supports idempotency keys with a conditional unique index:

```sql
CREATE UNIQUE INDEX ON ai_usage_records (tenant_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;
```

Duplicate submissions with the same `idempotency_key` silently no-op (the UPDATE SET does nothing meaningful), preventing double-counting on retries.
