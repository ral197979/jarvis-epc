// Denver Engineering — Operational Cost Analyzer (Phase 11)
// Track, aggregate, and analyze infrastructure and AI costs per tenant

import { pool, tenantQuery } from '../../db/pool'
import {
  CostRecord,
  CostForecast,
  CostCategory,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapCostRecord(row: Record<string, unknown>): CostRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string | null,
    category: row.category as CostCategory,
    featureId: row.feature_id as string | null,
    costUsd: Number(row.cost_usd),
    unitCount: Number(row.unit_count),
    unitType: row.unit_type as string,
    billingPeriod: row.billing_period as string,
    recordedAt: new Date(row.recorded_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

function _mapCostForecast(row: Record<string, unknown>): CostForecast {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string | null,
    category: row.category as CostCategory,
    forecastPeriod: row.forecast_period as string,
    projectedCostUsd: Number(row.projected_cost_usd),
    currentRunRateUsd: Number(row.current_run_rate_usd),
    growthRatePct: Number(row.growth_rate_pct),
    confidence: Number(row.confidence),
    forecastedAt: new Date(row.forecasted_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Record Cost ──────────────────────────────────────────────────────────────

export async function recordCost(
  tenantId: string | null,
  category: CostCategory,
  costUsd: number,
  unitCount: number,
  unitType: string,
  billingPeriod: string,
  featureId: string | null = null
): Promise<CostRecord> {
  const result = await pool.query(
    `INSERT INTO cost_records
       (tenant_id, category, feature_id, cost_usd, unit_count,
        unit_type, billing_period, recorded_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING *`,
    [tenantId, category, featureId, costUsd, unitCount, unitType, billingPeriod]
  )
  return _mapCostRecord(result.rows[0])
}

// ─── Get Cost Records ─────────────────────────────────────────────────────────

export async function getCostRecords(
  tenantId: string,
  category: CostCategory,
  billingPeriod: string
): Promise<CostRecord[]> {
  const rows = await tenantQuery(
    tenantId,
    `SELECT * FROM cost_records
     WHERE category = $1 AND billing_period = $2
     ORDER BY recorded_at DESC`,
    [category, billingPeriod]
  )
  return (rows as Record<string, unknown>[]).map(_mapCostRecord)
}

// ─── Get Total Cost for Period ────────────────────────────────────────────────

export async function getTotalCostForPeriod(
  tenantId: string | null,
  billingPeriod: string
): Promise<number> {
  if (tenantId) {
    const rows = await tenantQuery(
      tenantId,
      `SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_records WHERE billing_period = $1`,
      [billingPeriod]
    )
    return Number((rows[0] as Record<string, unknown>)?.total ?? 0)
  }

  const result = await pool.query(
    `SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_records
     WHERE billing_period = $1 AND tenant_id IS NULL`,
    [billingPeriod]
  )
  return Number(result.rows[0]?.total ?? 0)
}

// ─── Get Cost Breakdown ───────────────────────────────────────────────────────

export async function getCostBreakdown(
  billingPeriod: string
): Promise<Record<CostCategory, number>> {
  const result = await pool.query(
    `SELECT category, COALESCE(SUM(cost_usd), 0) as total
     FROM cost_records WHERE billing_period = $1
     GROUP BY category`,
    [billingPeriod]
  )

  const breakdown: Partial<Record<CostCategory, number>> = {}
  for (const row of result.rows as Record<string, unknown>[]) {
    breakdown[row.category as CostCategory] = Number(row.total)
  }
  return breakdown as Record<CostCategory, number>
}

// ─── Compute Run Rate ─────────────────────────────────────────────────────────

export function computeRunRate(
  costs: CostRecord[],
  periodDays: number
): number {
  if (periodDays === 0) return 0
  const total = costs.reduce((acc, c) => acc + c.costUsd, 0)
  return (total / periodDays) * 30 // Monthly run rate
}

// ─── Compute Cost Per Unit ────────────────────────────────────────────────────

export function computeCostPerUnit(costs: CostRecord[]): number {
  const totalCost = costs.reduce((acc, c) => acc + c.costUsd, 0)
  const totalUnits = costs.reduce((acc, c) => acc + c.unitCount, 0)
  return totalUnits === 0 ? 0 : totalCost / totalUnits
}

// ─── Store Cost Forecast ──────────────────────────────────────────────────────

export async function storeCostForecast(
  tenantId: string | null,
  category: CostCategory,
  forecastPeriod: string,
  projectedCostUsd: number,
  currentRunRateUsd: number,
  growthRatePct: number,
  confidence: number
): Promise<CostForecast> {
  const result = await pool.query(
    `INSERT INTO cost_forecasts
       (tenant_id, category, forecast_period, projected_cost_usd, current_run_rate_usd,
        growth_rate_pct, confidence, forecasted_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING *`,
    [tenantId, category, forecastPeriod, projectedCostUsd, currentRunRateUsd, growthRatePct, confidence]
  )
  return _mapCostForecast(result.rows[0])
}

// ─── Get Cost Forecasts ───────────────────────────────────────────────────────

export async function getCostForecasts(
  tenantId: string | null,
  forecastPeriod: string
): Promise<CostForecast[]> {
  const result = await pool.query(
    `SELECT * FROM cost_forecasts
     WHERE tenant_id IS NOT DISTINCT FROM $1 AND forecast_period = $2
     ORDER BY forecasted_at DESC`,
    [tenantId, forecastPeriod]
  )
  return result.rows.map(_mapCostForecast)
}

// ─── Detect Cost Anomaly ──────────────────────────────────────────────────────

export function detectCostAnomaly(
  currentCost: number,
  baselineCost: number
): { isAnomaly: boolean; deviationPct: number } {
  if (baselineCost === 0) return { isAnomaly: false, deviationPct: 0 }
  const deviationPct = ((currentCost - baselineCost) / baselineCost) * 100
  return {
    isAnomaly: Math.abs(deviationPct) > 50,
    deviationPct,
  }
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapCostRecord,
  _mapCostForecast,
  computeRunRate,
  computeCostPerUnit,
  detectCostAnomaly,
}
