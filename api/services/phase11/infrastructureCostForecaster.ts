// Denver Engineering — Infrastructure Cost Forecaster (Phase 11)
// Project future infrastructure costs based on growth trends

import { pool } from '../../db/pool'
import { CostCategory } from './phase11Types'

// ─── Forecast Input ───────────────────────────────────────────────────────────

export interface CostDataPoint {
  period: string
  costUsd: number
}

export interface CostProjection {
  category: CostCategory
  periods: Array<{ period: string; projectedCostUsd: number }>
  growthRatePct: number
  confidence: number
  generatedAt: Date
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapProjection(row: Record<string, unknown>): CostProjection {
  return {
    category: row.category as CostCategory,
    periods: (row.periods as Array<{ period: string; projectedCostUsd: number }>) ?? [],
    growthRatePct: Number(row.growth_rate_pct),
    confidence: Number(row.confidence),
    generatedAt: new Date(row.generated_at as string),
  }
}

// ─── Compute Linear Growth Rate ───────────────────────────────────────────────

export function computeLinearGrowthRate(dataPoints: CostDataPoint[]): number {
  if (dataPoints.length < 2) return 0

  const sorted = [...dataPoints].sort((a, b) => a.period.localeCompare(b.period))
  const first = sorted[0].costUsd
  const last = sorted[sorted.length - 1].costUsd

  if (first === 0) return 0
  const totalGrowth = (last - first) / first
  const periods = sorted.length - 1
  // Monthly compound growth rate approximation
  return (totalGrowth / periods) * 100
}

// ─── Project Future Costs ─────────────────────────────────────────────────────

export function projectFutureCosts(
  currentCostUsd: number,
  monthlyGrowthRatePct: number,
  months: number
): Array<{ month: number; projectedCostUsd: number }> {
  const projections = []
  let cost = currentCostUsd
  const growthFactor = 1 + (monthlyGrowthRatePct / 100)

  for (let m = 1; m <= months; m++) {
    cost = cost * growthFactor
    projections.push({ month: m, projectedCostUsd: Math.round(cost * 100) / 100 })
  }

  return projections
}

// ─── Compute Confidence ───────────────────────────────────────────────────────

export function computeForecastConfidence(dataPointCount: number): number {
  if (dataPointCount >= 12) return 0.9
  if (dataPointCount >= 6) return 0.75
  if (dataPointCount >= 3) return 0.5
  return 0.25
}

// ─── Get Historical Cost Data ─────────────────────────────────────────────────

export async function getHistoricalCostData(
  category: CostCategory,
  limit: number = 12
): Promise<CostDataPoint[]> {
  const result = await pool.query(
    `SELECT billing_period as period, SUM(cost_usd) as cost_usd
     FROM cost_records
     WHERE category = $1
     GROUP BY billing_period
     ORDER BY billing_period DESC
     LIMIT $2`,
    [category, limit]
  )
  return result.rows.map((row: Record<string, unknown>) => ({
    period: row.period as string,
    costUsd: Number(row.cost_usd),
  }))
}

// ─── Store Forecast ───────────────────────────────────────────────────────────

export async function storeForecast(
  category: CostCategory,
  growthRatePct: number,
  periods: Array<{ period: string; projectedCostUsd: number }>,
  confidence: number
): Promise<void> {
  await pool.query(
    `INSERT INTO infrastructure_cost_forecasts
       (category, periods, growth_rate_pct, confidence, generated_at, created_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [category, JSON.stringify(periods), growthRatePct, confidence]
  )
}

// ─── Get Latest Forecast ──────────────────────────────────────────────────────

export async function getLatestForecast(
  category: CostCategory
): Promise<CostProjection | null> {
  const result = await pool.query(
    `SELECT * FROM infrastructure_cost_forecasts
     WHERE category = $1
     ORDER BY generated_at DESC
     LIMIT 1`,
    [category]
  )
  return result.rows.length > 0 ? _mapProjection(result.rows[0]) : null
}

// ─── Run Full Cost Forecast ───────────────────────────────────────────────────

export async function runFullCostForecast(
  forecastMonths: number = 6
): Promise<Record<CostCategory, CostProjection | null>> {
  const categories: CostCategory[] = [
    'ai_provider', 'replay_compute', 'graph_traversal', 'websocket_fanout',
    'export', 'simulation', 'edge_sync', 'storage', 'network',
  ]

  const projections: Partial<Record<CostCategory, CostProjection | null>> = {}

  for (const category of categories) {
    const history = await getHistoricalCostData(category)
    if (history.length < 2) {
      projections[category] = null
      continue
    }

    const growthRate = computeLinearGrowthRate(history)
    const currentCost = history[0].costUsd
    const futureMonths = projectFutureCosts(currentCost, growthRate, forecastMonths)
    const confidence = computeForecastConfidence(history.length)

    const periods = futureMonths.map((m, i) => ({
      period: `+${m.month}mo`,
      projectedCostUsd: m.projectedCostUsd,
    }))

    await storeForecast(category, growthRate, periods, confidence)

    projections[category] = {
      category,
      periods,
      growthRatePct: growthRate,
      confidence,
      generatedAt: new Date(),
    }
  }

  return projections as Record<CostCategory, CostProjection | null>
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeLinearGrowthRate,
  projectFutureCosts,
  computeForecastConfidence,
}
