// Denver Engineering — Performance Regression Analyzer (Phase 11)
// Detect and record performance regressions against established baselines

import { pool } from '../../db/pool'
import {
  PerformanceRegression,
  PerformanceBaseline,
  ScaleValidationRun,
  ScaleTestType,
  SCALE_REGRESSION_THRESHOLD,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapRegression(row: Record<string, unknown>): PerformanceRegression {
  return {
    id: row.id as string,
    testType: row.test_type as ScaleTestType,
    baselineId: row.baseline_id as string,
    regressionPercent: Number(row.regression_percent),
    affectedMetric: row.affected_metric as PerformanceRegression['affectedMetric'],
    severity: row.severity as PerformanceRegression['severity'],
    detectedAt: new Date(row.detected_at as string),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Classify Regression Severity ────────────────────────────────────────────

export function classifyRegressionSeverity(
  regressionPercent: number
): PerformanceRegression['severity'] {
  const abs = Math.abs(regressionPercent)
  if (abs >= 50) return 'critical'
  if (abs >= 25) return 'moderate'
  return 'minor'
}

// ─── Analyze Run Against Baseline ────────────────────────────────────────────

export function analyzeRunAgainstBaseline(
  run: ScaleValidationRun,
  baseline: PerformanceBaseline
): Array<{ metric: PerformanceRegression['affectedMetric']; regressionPercent: number }> {
  const regressions: Array<{
    metric: PerformanceRegression['affectedMetric']
    regressionPercent: number
  }> = []

  const checks: Array<{
    metric: PerformanceRegression['affectedMetric']
    current: number
    base: number
    lowerIsBetter: boolean
  }> = [
    { metric: 'p50', current: run.p50Ms, base: baseline.baselineP50Ms, lowerIsBetter: true },
    { metric: 'p95', current: run.p95Ms, base: baseline.baselineP95Ms, lowerIsBetter: true },
    { metric: 'p99', current: run.p99Ms, base: baseline.baselineP99Ms, lowerIsBetter: true },
    { metric: 'error_rate', current: run.errorRate, base: baseline.baselineErrorRate, lowerIsBetter: true },
    { metric: 'throughput', current: run.throughput, base: baseline.baselineThroughput, lowerIsBetter: false },
  ]

  for (const check of checks) {
    if (check.base === 0) continue

    const delta = check.lowerIsBetter
      ? (check.current - check.base) / check.base
      : (check.base - check.current) / check.base

    if (delta > SCALE_REGRESSION_THRESHOLD) {
      regressions.push({
        metric: check.metric,
        regressionPercent: delta * 100,
      })
    }
  }

  return regressions
}

// ─── Record Regression ────────────────────────────────────────────────────────

export async function recordPerformanceRegression(
  testType: ScaleTestType,
  baselineId: string,
  metric: PerformanceRegression['affectedMetric'],
  regressionPercent: number
): Promise<PerformanceRegression> {
  const severity = classifyRegressionSeverity(regressionPercent)
  const result = await pool.query(
    `INSERT INTO performance_regressions
       (test_type, baseline_id, regression_percent, affected_metric,
        severity, detected_at, resolved_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NULL, NOW())
     RETURNING *`,
    [testType, baselineId, regressionPercent, metric, severity]
  )
  return _mapRegression(result.rows[0])
}

// ─── Resolve Regression ───────────────────────────────────────────────────────

export async function resolveRegression(regressionId: string): Promise<PerformanceRegression> {
  const result = await pool.query(
    `UPDATE performance_regressions
     SET resolved_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [regressionId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Regression ${regressionId} not found`)
  }
  return _mapRegression(result.rows[0])
}

// ─── Get Regressions ─────────────────────────────────────────────────────────

export async function getActiveRegressions(testType: ScaleTestType): Promise<PerformanceRegression[]> {
  const result = await pool.query(
    `SELECT * FROM performance_regressions
     WHERE test_type = $1 AND resolved_at IS NULL
     ORDER BY detected_at DESC`,
    [testType]
  )
  return result.rows.map(_mapRegression)
}

export async function getAllRegressions(testType: ScaleTestType): Promise<PerformanceRegression[]> {
  const result = await pool.query(
    `SELECT * FROM performance_regressions
     WHERE test_type = $1
     ORDER BY detected_at DESC`,
    [testType]
  )
  return result.rows.map(_mapRegression)
}

// ─── Has Critical Regression ─────────────────────────────────────────────────

export function hasCriticalRegression(regressions: PerformanceRegression[]): boolean {
  return regressions.some(r => r.severity === 'critical' && r.resolvedAt === null)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapRegression,
  classifyRegressionSeverity,
  analyzeRunAgainstBaseline,
  hasCriticalRegression,
}
