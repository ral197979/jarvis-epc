// Denver Engineering — Scale Validation Engine (Phase 11)
// Run and track scale validation tests at production load targets

import { pool } from '../../db/pool'
import {
  ScaleValidationRun,
  PerformanceBaseline,
  ScaleTestType,
  ScaleTestStatus,
  SCALE_REGRESSION_THRESHOLD,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapScaleRun(row: Record<string, unknown>): ScaleValidationRun {
  return {
    id: row.id as string,
    testType: row.test_type as ScaleTestType,
    targetLoad: Number(row.target_load),
    actualLoad: Number(row.actual_load),
    status: row.status as ScaleTestStatus,
    p50Ms: Number(row.p50_ms),
    p95Ms: Number(row.p95_ms),
    p99Ms: Number(row.p99_ms),
    errorRate: Number(row.error_rate),
    throughput: Number(row.throughput),
    environment: row.environment as string,
    startedAt: new Date(row.started_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

function _mapBaseline(row: Record<string, unknown>): PerformanceBaseline {
  return {
    id: row.id as string,
    testType: row.test_type as ScaleTestType,
    baselineLoad: Number(row.baseline_load),
    baselineP50Ms: Number(row.baseline_p50_ms),
    baselineP95Ms: Number(row.baseline_p95_ms),
    baselineP99Ms: Number(row.baseline_p99_ms),
    baselineErrorRate: Number(row.baseline_error_rate),
    baselineThroughput: Number(row.baseline_throughput),
    establishedAt: new Date(row.established_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Create Scale Validation Run ─────────────────────────────────────────────

export async function createScaleValidationRun(
  testType: ScaleTestType,
  targetLoad: number,
  environment: string
): Promise<ScaleValidationRun> {
  const result = await pool.query(
    `INSERT INTO scale_validation_runs
       (test_type, target_load, actual_load, status,
        p50_ms, p95_ms, p99_ms, error_rate, throughput,
        environment, started_at, completed_at, created_at)
     VALUES ($1, $2, 0, 'pending', 0, 0, 0, 0, 0, $3, NOW(), NULL, NOW())
     RETURNING *`,
    [testType, targetLoad, environment]
  )
  return _mapScaleRun(result.rows[0])
}

// ─── Complete Scale Validation Run ───────────────────────────────────────────

export async function completeScaleValidationRun(
  runId: string,
  actualLoad: number,
  p50Ms: number,
  p95Ms: number,
  p99Ms: number,
  errorRate: number,
  throughput: number,
  status: ScaleTestStatus
): Promise<ScaleValidationRun> {
  const result = await pool.query(
    `UPDATE scale_validation_runs
     SET actual_load = $1, p50_ms = $2, p95_ms = $3, p99_ms = $4,
         error_rate = $5, throughput = $6, status = $7, completed_at = NOW()
     WHERE id = $8
     RETURNING *`,
    [actualLoad, p50Ms, p95Ms, p99Ms, errorRate, throughput, status, runId]
  )
  return _mapScaleRun(result.rows[0])
}

// ─── Get Scale Validation Run ─────────────────────────────────────────────────

export async function getScaleValidationRun(runId: string): Promise<ScaleValidationRun | null> {
  const result = await pool.query(
    `SELECT * FROM scale_validation_runs WHERE id = $1`,
    [runId]
  )
  return result.rows.length > 0 ? _mapScaleRun(result.rows[0]) : null
}

// ─── List Scale Validation Runs ───────────────────────────────────────────────

export async function listScaleValidationRuns(
  testType: ScaleTestType,
  environment: string
): Promise<ScaleValidationRun[]> {
  const result = await pool.query(
    `SELECT * FROM scale_validation_runs
     WHERE test_type = $1 AND environment = $2
     ORDER BY started_at DESC`,
    [testType, environment]
  )
  return result.rows.map(_mapScaleRun)
}

// ─── Performance Baseline ─────────────────────────────────────────────────────

export async function createPerformanceBaseline(
  testType: ScaleTestType,
  run: ScaleValidationRun
): Promise<PerformanceBaseline> {
  const result = await pool.query(
    `INSERT INTO performance_baselines
       (test_type, baseline_load, baseline_p50_ms, baseline_p95_ms, baseline_p99_ms,
        baseline_error_rate, baseline_throughput, established_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     RETURNING *`,
    [
      testType, run.actualLoad, run.p50Ms, run.p95Ms, run.p99Ms,
      run.errorRate, run.throughput,
    ]
  )
  return _mapBaseline(result.rows[0])
}

export async function getPerformanceBaseline(
  testType: ScaleTestType
): Promise<PerformanceBaseline | null> {
  const result = await pool.query(
    `SELECT * FROM performance_baselines
     WHERE test_type = $1
     ORDER BY established_at DESC
     LIMIT 1`,
    [testType]
  )
  return result.rows.length > 0 ? _mapBaseline(result.rows[0]) : null
}

// ─── Regression Detection ─────────────────────────────────────────────────────

export function detectP95Regression(
  run: ScaleValidationRun,
  baseline: PerformanceBaseline
): boolean {
  if (baseline.baselineP95Ms === 0) return false
  const delta = (run.p95Ms - baseline.baselineP95Ms) / baseline.baselineP95Ms
  return delta > SCALE_REGRESSION_THRESHOLD
}

export function detectThroughputRegression(
  run: ScaleValidationRun,
  baseline: PerformanceBaseline
): boolean {
  if (baseline.baselineThroughput === 0) return false
  const delta = (baseline.baselineThroughput - run.throughput) / baseline.baselineThroughput
  return delta > SCALE_REGRESSION_THRESHOLD
}

export function computeRegressionPercent(current: number, baseline: number): number {
  if (baseline === 0) return 0
  return ((current - baseline) / baseline) * 100
}

// ─── Determine Scale Test Status ─────────────────────────────────────────────

export function determineScaleTestStatus(
  run: ScaleValidationRun,
  baseline: PerformanceBaseline | null
): ScaleTestStatus {
  if (run.errorRate > 0.05) return 'failed'
  if (!baseline) return 'passed'
  if (detectP95Regression(run, baseline)) return 'degraded'
  if (detectThroughputRegression(run, baseline)) return 'degraded'
  return 'passed'
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapScaleRun,
  _mapBaseline,
  detectP95Regression,
  detectThroughputRegression,
  computeRegressionPercent,
  determineScaleTestStatus,
}
