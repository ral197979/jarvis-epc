// Denver Engineering — Tenant Usage Tracker (v8.0.0)
// Records, aggregates, and summarizes tenant usage events with idempotency.

import { tenantQuery } from '../../db/pool'
import {
  TenantUsageRecord, RecordUsageInput, UsageSummary, BillingEventType,
} from './enterpriseTypes'

// ─── Record usage ─────────────────────────────────────────────────────────────

export async function recordUsage(
  tenantId: string,
  input: RecordUsageInput,
): Promise<TenantUsageRecord> {
  const {
    eventType, quantity, unit, unitCost, periodStart, periodEnd,
    idempotencyKey, metadata = {},
  } = input

  const now = new Date()
  const pStart = periodStart ?? new Date(now.getFullYear(), now.getMonth(), 1)
  const pEnd = periodEnd ?? new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  const totalCost = unitCost != null ? quantity * unitCost : null

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO tenant_usage
      (tenant_id, period_start, period_end, event_type, quantity, unit,
       unit_cost, total_cost, idempotency_key, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
     DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      tenantId, pStart, pEnd, eventType, quantity, unit,
      unitCost ?? null, totalCost, idempotencyKey ?? null, JSON.stringify(metadata),
    ],
  )
  return _mapUsageRecord(res.rows[0])
}

// ─── Get usage records ────────────────────────────────────────────────────────

export async function getUsageRecords(
  tenantId: string,
  opts: {
    eventType?: BillingEventType
    periodStart?: Date
    periodEnd?: Date
    limit?: number
  } = {},
): Promise<TenantUsageRecord[]> {
  const { eventType, periodStart, periodEnd, limit = 500 } = opts
  const params: unknown[] = [tenantId]
  const clauses: string[] = []

  if (eventType != null) { params.push(eventType); clauses.push(`event_type = $${params.length}`) }
  if (periodStart != null) { params.push(periodStart); clauses.push(`period_start >= $${params.length}`) }
  if (periodEnd != null) { params.push(periodEnd); clauses.push(`period_end <= $${params.length}`) }

  const where = clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : ''
  params.push(limit)

  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM tenant_usage WHERE tenant_id = $1 ${where}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  )
  return res.rows.map(_mapUsageRecord)
}

// ─── Summarize usage for a period ────────────────────────────────────────────

export async function getUsageSummary(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<UsageSummary> {
  const res = await tenantQuery(
    tenantId,
    `SELECT event_type,
            SUM(quantity)::float   AS total_quantity,
            SUM(total_cost)::float AS total_cost,
            MAX(unit)              AS unit
     FROM tenant_usage
     WHERE tenant_id = $1
       AND period_start >= $2
       AND period_end <= $3
     GROUP BY event_type`,
    [tenantId, periodStart, periodEnd],
  )

  const byType: UsageSummary['byType'] = {}
  let totalCostUsd = 0

  for (const row of res.rows) {
    const cost = Number(row.total_cost ?? 0)
    totalCostUsd += cost
    byType[row.event_type as BillingEventType] = {
      quantity: Number(row.total_quantity ?? 0),
      cost,
      unit: String(row.unit ?? ''),
    }
  }

  return { tenantId, periodStart, periodEnd, totalCostUsd, byType }
}

// ─── Current month summary ────────────────────────────────────────────────────

export async function getCurrentMonthSummary(tenantId: string): Promise<UsageSummary> {
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  return getUsageSummary(tenantId, periodStart, periodEnd)
}

// ─── Increment API call counter ───────────────────────────────────────────────

export async function trackApiCall(
  tenantId: string,
  count = 1,
  idempotencyKey?: string,
): Promise<TenantUsageRecord> {
  return recordUsage(tenantId, {
    eventType: 'api_calls',
    quantity: count,
    unit: 'calls',
    idempotencyKey,
  })
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

export function _mapUsageRecord(row: Record<string, unknown>): TenantUsageRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    periodStart: new Date(row.period_start as string),
    periodEnd: new Date(row.period_end as string),
    eventType: row.event_type as BillingEventType,
    quantity: Number(row.quantity),
    unit: String(row.unit),
    unitCost: row.unit_cost != null ? Number(row.unit_cost) : undefined,
    totalCost: row.total_cost != null ? Number(row.total_cost) : undefined,
    idempotencyKey: row.idempotency_key != null ? String(row.idempotency_key) : undefined,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string),
  }
}

export const __testHooks = { _mapUsageRecord }
