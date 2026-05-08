// Denver Engineering — Infrastructure Efficiency Analyzer (Phase 12)
// Analyzes and reports on infrastructure-level efficiency metrics

import { pool } from '../../db/pool'
import { InfrastructureEfficiencyReport } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapEfficiencyReport(row: Record<string, unknown>): InfrastructureEfficiencyReport {
  return {
    id: row.id as string,
    environment: row.environment as string,
    computeEfficiencyScore: Number(row.compute_efficiency_score),
    storageEfficiencyScore: Number(row.storage_efficiency_score),
    networkEfficiencyScore: Number(row.network_efficiency_score),
    overallEfficiencyScore: Number(row.overall_efficiency_score),
    topOptimizations: row.top_optimizations as string[],
    reportedAt: new Date(row.reported_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeOverallInfraScore(
  compute: number,
  storage: number,
  network: number,
): number {
  return Math.round(compute * 0.40 + storage * 0.35 + network * 0.25)
}

export function generateOptimizationSuggestions(
  computeScore: number,
  storageScore: number,
  networkScore: number,
): string[] {
  const suggestions: string[] = []
  if (computeScore < 70) suggestions.push('Right-size underutilized ECS tasks (<20% CPU average)')
  if (storageScore < 70) suggestions.push('Enable S3 Intelligent-Tiering for cold telemetry data')
  if (networkScore < 70) suggestions.push('Enable CloudFront CDN for static asset delivery')
  if (computeScore < 50) suggestions.push('Review reserved instance coverage for steady-state workloads')
  if (storageScore < 50) suggestions.push('Archive audit records older than 90 days to S3 Glacier')
  return suggestions.slice(0, 5)
}

export function isInfrastructureEfficient(report: InfrastructureEfficiencyReport): boolean {
  return report.overallEfficiencyScore >= 70
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function generateEfficiencyReport(
  environment: string,
  computeEfficiencyScore: number,
  storageEfficiencyScore: number,
  networkEfficiencyScore: number,
): Promise<InfrastructureEfficiencyReport> {
  const overallEfficiencyScore = computeOverallInfraScore(computeEfficiencyScore, storageEfficiencyScore, networkEfficiencyScore)
  const topOptimizations = generateOptimizationSuggestions(computeEfficiencyScore, storageEfficiencyScore, networkEfficiencyScore)

  const result = await pool.query(
    `INSERT INTO p12_infra_efficiency_reports
       (environment, compute_efficiency_score, storage_efficiency_score, network_efficiency_score,
        overall_efficiency_score, top_optimizations, reported_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [environment, computeEfficiencyScore, storageEfficiencyScore, networkEfficiencyScore, overallEfficiencyScore, JSON.stringify(topOptimizations)],
  )
  return _mapEfficiencyReport(result.rows[0])
}

export async function getLatestEfficiencyReport(environment: string): Promise<InfrastructureEfficiencyReport | null> {
  const result = await pool.query(
    `SELECT * FROM p12_infra_efficiency_reports
     WHERE environment = $1
     ORDER BY reported_at DESC
     LIMIT 1`,
    [environment],
  )
  return result.rows[0] ? _mapEfficiencyReport(result.rows[0]) : null
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeOverallInfraScore,
  generateOptimizationSuggestions,
  isInfrastructureEfficient,
  _mapEfficiencyReport,
}
