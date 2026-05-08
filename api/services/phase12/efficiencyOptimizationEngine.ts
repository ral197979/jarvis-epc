// Denver Engineering — Efficiency Optimization Engine (Phase 12)
// Tracks operational efficiency gains across cost categories

import { pool } from '../../db/pool'
import { EfficiencyMetric } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapEfficiencyMetric(row: Record<string, unknown>): EfficiencyMetric {
  return {
    id: row.id as string,
    category: row.category as EfficiencyMetric['category'],
    baselineCost: Number(row.baseline_cost),
    currentCost: Number(row.current_cost),
    efficiencyGainPct: Number(row.efficiency_gain_pct),
    measuredAt: new Date(row.measured_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeEfficiencyGain(baselineCost: number, currentCost: number): number {
  if (baselineCost === 0) return 0
  return ((baselineCost - currentCost) / baselineCost) * 100
}

export function isEfficiencyImproved(metric: EfficiencyMetric): boolean {
  return metric.efficiencyGainPct > 0
}

export function computeAggregateEfficiencyGain(metrics: EfficiencyMetric[]): number {
  if (metrics.length === 0) return 0
  const totalBaseline = metrics.reduce((sum, m) => sum + m.baselineCost, 0)
  const totalCurrent = metrics.reduce((sum, m) => sum + m.currentCost, 0)
  return computeEfficiencyGain(totalBaseline, totalCurrent)
}

export function getTopOptimizationOpportunities(
  metrics: EfficiencyMetric[],
  topN = 3,
): EfficiencyMetric[] {
  // Sort by highest current cost (biggest savings opportunity)
  return [...metrics]
    .filter(m => m.efficiencyGainPct <= 0 || m.currentCost > 0)
    .sort((a, b) => b.currentCost - a.currentCost)
    .slice(0, topN)
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordEfficiencyMetric(
  category: EfficiencyMetric['category'],
  baselineCost: number,
  currentCost: number,
): Promise<EfficiencyMetric> {
  const efficiencyGainPct = computeEfficiencyGain(baselineCost, currentCost)
  const result = await pool.query(
    `INSERT INTO p12_efficiency_metrics
       (category, baseline_cost, current_cost, efficiency_gain_pct, measured_at)
     VALUES ($1,$2,$3,$4,NOW())
     RETURNING *`,
    [category, baselineCost, currentCost, efficiencyGainPct],
  )
  return _mapEfficiencyMetric(result.rows[0])
}

export async function getEfficiencyMetrics(category?: EfficiencyMetric['category']): Promise<EfficiencyMetric[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (category) *
     FROM p12_efficiency_metrics
     WHERE ($1::text IS NULL OR category = $1)
     ORDER BY category, measured_at DESC`,
    [category ?? null],
  )
  return result.rows.map(_mapEfficiencyMetric)
}

export async function getEfficiencyHistory(category: EfficiencyMetric['category'], limit = 30): Promise<EfficiencyMetric[]> {
  const result = await pool.query(
    `SELECT * FROM p12_efficiency_metrics
     WHERE category = $1
     ORDER BY measured_at DESC
     LIMIT $2`,
    [category, limit],
  )
  return result.rows.map(_mapEfficiencyMetric)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeEfficiencyGain,
  isEfficiencyImproved,
  computeAggregateEfficiencyGain,
  getTopOptimizationOpportunities,
  _mapEfficiencyMetric,
}
