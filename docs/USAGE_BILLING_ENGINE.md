# Usage and Billing Engine

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Overview

The Usage Billing Engine records discrete usage events with idempotency, aggregates them into period summaries, and provides the data layer for billing calculations.

## Usage Event Model

```typescript
interface TenantUsageRecord {
  eventType: BillingEventType  // 'usage' | 'seat' | 'storage' | 'ai_tokens' |
                               // 'api_calls' | 'simulation' | 'adjustment' | 'credit'
  quantity: number             // amount of the unit consumed
  unit: string                 // 'calls', 'tokens', 'gb', 'seats', etc.
  unitCost?: number            // cost per unit in USD
  totalCost?: number           // quantity * unitCost (computed on insert if unitCost provided)
  periodStart: Date            // billing period start (defaults: first of current month)
  periodEnd: Date              // billing period end (defaults: last second of current month)
  idempotencyKey?: string      // prevents double-counting on retry
}
```

## Idempotency

```sql
ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
DO UPDATE SET updated_at = now()
```

Providing the same `idempotencyKey` twice returns the original record unchanged. The `WHERE idempotency_key IS NOT NULL` clause means events without idempotency keys never conflict with each other.

## Period Defaults

When `periodStart`/`periodEnd` are not provided, they default to the current calendar month:
- `periodStart` = first day of current month at 00:00:00
- `periodEnd` = last day of current month at 23:59:59.999

## Usage Summary

`getUsageSummary()` executes a single `GROUP BY event_type` query:

```sql
SELECT event_type,
       SUM(quantity)::float AS total_quantity,
       SUM(total_cost)::float AS total_cost,
       MAX(unit) AS unit
FROM tenant_usage
WHERE tenant_id = $1
  AND period_start >= $2 AND period_end <= $3
GROUP BY event_type
```

Returns `UsageSummary`:
```typescript
{
  tenantId: string
  periodStart: Date
  periodEnd: Date
  totalCostUsd: number
  byType: Partial<Record<BillingEventType, { quantity: number; cost: number; unit: string }>>
}
```

## API Call Tracking

`trackApiCall(tenantId, count, idempotencyKey?)` is a convenience wrapper that records an `api_calls` event. Used by middleware to count billable API requests.

## Relationship to AI Cost

AI token costs are tracked separately in `ai_usage_records` (for attribution by model/agent) and also in `tenant_usage` (for period aggregation into billing summaries). The `ai_tokens` event type in `tenant_usage` provides rollup-level billing data; `ai_usage_records` provides granular attribution.

## Audit Non-Deletion

Usage records are **never deleted**. The `tenant_usage` table has no soft-delete column. Corrections are made via `adjustment` or `credit` event types with negative quantities.
