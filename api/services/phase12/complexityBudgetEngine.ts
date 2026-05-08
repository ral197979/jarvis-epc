// Denver Engineering — Complexity Budget Engine (Phase 12)
// Tracks platform complexity and enforces budget limits

import { pool } from '../../db/pool'
import { ComplexityBudget, COMPLEXITY_BUDGET_LIMIT } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapComplexityBudget(row: Record<string, unknown>): ComplexityBudget {
  return {
    id: row.id as string,
    environment: row.environment as string,
    serviceCount: Number(row.service_count),
    averageDependencies: Number(row.average_dependencies),
    replaySurface: Number(row.replay_surface),
    pluginCount: Number(row.plugin_count),
    totalComplexityScore: Number(row.total_complexity_score),
    budgetLimit: Number(row.budget_limit),
    isOverBudget: row.is_over_budget as boolean,
    measuredAt: new Date(row.measured_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeComplexityScore(
  serviceCount: number,
  averageDependencies: number,
  replaySurface: number,
  pluginCount: number,
): number {
  return Math.round(
    serviceCount * 3 +
    averageDependencies * 10 +
    replaySurface * 5 +
    pluginCount * 2,
  )
}

export function isOverBudget(score: number, limit = COMPLEXITY_BUDGET_LIMIT): boolean {
  return score > limit
}

export function computeBudgetUtilization(score: number, limit = COMPLEXITY_BUDGET_LIMIT): number {
  return score / limit
}

export function classifyComplexityRisk(score: number): 'low' | 'medium' | 'high' | 'critical' {
  const utilization = computeBudgetUtilization(score)
  if (utilization > 1.0) return 'critical'
  if (utilization > 0.85) return 'high'
  if (utilization > 0.65) return 'medium'
  return 'low'
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function measureComplexityBudget(
  environment: string,
  serviceCount: number,
  averageDependencies: number,
  replaySurface: number,
  pluginCount: number,
): Promise<ComplexityBudget> {
  const totalComplexityScore = computeComplexityScore(serviceCount, averageDependencies, replaySurface, pluginCount)
  const over = isOverBudget(totalComplexityScore)

  const result = await pool.query(
    `INSERT INTO p12_complexity_budget
       (environment, service_count, average_dependencies, replay_surface, plugin_count,
        total_complexity_score, budget_limit, is_over_budget, measured_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     RETURNING *`,
    [environment, serviceCount, averageDependencies, replaySurface, pluginCount, totalComplexityScore, COMPLEXITY_BUDGET_LIMIT, over],
  )
  return _mapComplexityBudget(result.rows[0])
}

export async function getLatestComplexityBudget(environment: string): Promise<ComplexityBudget | null> {
  const result = await pool.query(
    `SELECT * FROM p12_complexity_budget
     WHERE environment = $1
     ORDER BY measured_at DESC
     LIMIT 1`,
    [environment],
  )
  return result.rows[0] ? _mapComplexityBudget(result.rows[0]) : null
}

export async function getComplexityTrend(environment: string, limit = 14): Promise<ComplexityBudget[]> {
  const result = await pool.query(
    `SELECT * FROM p12_complexity_budget
     WHERE environment = $1
     ORDER BY measured_at DESC
     LIMIT $2`,
    [environment, limit],
  )
  return result.rows.map(_mapComplexityBudget)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeComplexityScore,
  isOverBudget,
  computeBudgetUtilization,
  classifyComplexityRisk,
  _mapComplexityBudget,
}
