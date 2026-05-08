// Denver Engineering — Operational Readiness Scanner (v10.0.0)
// Evaluates platform readiness across all operational dimensions.

import { default as pool } from '../../db/pool'
import {
  OperationalReadinessScan, ReadinessScanResult,
  ReadinessDimension, ReadinessLevel,
  READINESS_SCORE_THRESHOLD,
} from './phase10Types'

// ─── Scan lifecycle ───────────────────────────────────────────────────────────

export async function createScan(environment: string): Promise<OperationalReadinessScan> {
  const res = await pool.query(
    `INSERT INTO operational_readiness_scans
      (environment, overall_score, overall_level,
       dimension_count, ready_count, degraded_count, not_ready_count)
     VALUES ($1,0,'unknown',0,0,0,0)
     RETURNING *`,
    [environment],
  )
  return _mapScan(res.rows[0])
}

export async function recordDimensionResult(
  scanId: string,
  dimension: ReadinessDimension,
  score: number,
  details: string,
  blockers: string[] = [],
  warnings: string[] = [],
): Promise<ReadinessScanResult> {
  const level = scoreToDimensionLevel(score)

  const res = await pool.query(
    `INSERT INTO readiness_scan_results
      (scan_id, dimension, level, score, details, blockers, warnings, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())
     RETURNING *`,
    [
      scanId, dimension, level, score, details,
      JSON.stringify(blockers), JSON.stringify(warnings),
    ],
  )
  return _mapScanResult(res.rows[0])
}

export async function finalizeScan(scanId: string): Promise<OperationalReadinessScan> {
  const resultsRes = await pool.query(
    `SELECT
       COUNT(*) AS total,
       AVG(score) AS avg_score,
       SUM(CASE WHEN level = 'ready' THEN 1 ELSE 0 END)::int AS ready,
       SUM(CASE WHEN level = 'degraded' THEN 1 ELSE 0 END)::int AS degraded,
       SUM(CASE WHEN level = 'not_ready' THEN 1 ELSE 0 END)::int AS not_ready
     FROM readiness_scan_results WHERE scan_id = $1`,
    [scanId],
  )
  const r = resultsRes.rows[0]
  const avgScore = Math.round(Number(r['avg_score'] ?? 0))
  const notReady = Number(r['not_ready'] ?? 0)
  const degraded = Number(r['degraded'] ?? 0)

  const overallLevel: ReadinessLevel =
    notReady > 0 ? 'not_ready'
    : degraded > 0 ? 'degraded'
    : avgScore >= READINESS_SCORE_THRESHOLD ? 'ready'
    : 'degraded'

  const res = await pool.query(
    `UPDATE operational_readiness_scans
     SET overall_score = $2, overall_level = $3,
         dimension_count = $4, ready_count = $5,
         degraded_count = $6, not_ready_count = $7,
         completed_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      scanId, avgScore, overallLevel,
      Number(r['total']),
      Number(r['ready'] ?? 0),
      degraded,
      notReady,
    ],
  )
  return _mapScan(res.rows[0])
}

export async function getScan(scanId: string): Promise<OperationalReadinessScan | null> {
  const res = await pool.query(
    `SELECT * FROM operational_readiness_scans WHERE id = $1`,
    [scanId],
  )
  return res.rows.length > 0 ? _mapScan(res.rows[0]) : null
}

export async function getScanResults(scanId: string): Promise<ReadinessScanResult[]> {
  const res = await pool.query(
    `SELECT * FROM readiness_scan_results WHERE scan_id = $1
     ORDER BY level, score`,
    [scanId],
  )
  return res.rows.map(_mapScanResult)
}

export async function listScans(
  environment?: string,
  limit = 10,
): Promise<OperationalReadinessScan[]> {
  const res = await pool.query(
    `SELECT * FROM operational_readiness_scans
     WHERE ($1::text IS NULL OR environment = $1)
     ORDER BY created_at DESC LIMIT $2`,
    [environment ?? null, limit],
  )
  return res.rows.map(_mapScan)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function scoreToDimensionLevel(score: number): ReadinessLevel {
  if (score >= READINESS_SCORE_THRESHOLD) return 'ready'
  if (score >= 50) return 'degraded'
  return 'not_ready'
}

export function computeOverallScore(scores: number[]): number {
  if (scores.length === 0) return 0
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

export function isReadyForProduction(scan: OperationalReadinessScan): boolean {
  return scan.overallLevel === 'ready' && scan.notReadyCount === 0
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapScan,
  _mapScanResult,
  scoreToDimensionLevel,
  computeOverallScore,
  isReadyForProduction,
  READINESS_SCORE_THRESHOLD,
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapScan(row: Record<string, unknown>): OperationalReadinessScan {
  return {
    id: row['id'] as string,
    environment: row['environment'] as string,
    overallScore: Number(row['overall_score'] ?? 0),
    overallLevel: row['overall_level'] as ReadinessLevel,
    dimensionCount: Number(row['dimension_count'] ?? 0),
    readyCount: Number(row['ready_count'] ?? 0),
    degradedCount: Number(row['degraded_count'] ?? 0),
    notReadyCount: Number(row['not_ready_count'] ?? 0),
    completedAt: row['completed_at'] != null ? new Date(row['completed_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}

function _mapScanResult(row: Record<string, unknown>): ReadinessScanResult {
  return {
    id: row['id'] as string,
    scanId: row['scan_id'] as string,
    dimension: row['dimension'] as ReadinessDimension,
    level: row['level'] as ReadinessLevel,
    score: Number(row['score']),
    details: row['details'] as string,
    blockers: (typeof row['blockers'] === 'string'
      ? JSON.parse(row['blockers'] as string)
      : row['blockers']) as string[],
    warnings: (typeof row['warnings'] === 'string'
      ? JSON.parse(row['warnings'] as string)
      : row['warnings']) as string[],
    checkedAt: new Date(row['checked_at'] as string),
    createdAt: new Date(row['created_at'] as string),
  }
}
