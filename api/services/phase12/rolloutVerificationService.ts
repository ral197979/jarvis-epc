// Denver Engineering — Rollout Verification Service (Phase 12)
// Verifies rollout health via sampling and error rate monitoring

import { pool } from '../../db/pool'
import { RolloutVerification } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapVerification(row: Record<string, unknown>): RolloutVerification {
  return {
    id: row.id as string,
    rolloutId: row.rollout_id as string,
    checksRun: Number(row.checks_run),
    checksPassed: Number(row.checks_passed),
    tenantSampleSize: Number(row.tenant_sample_size),
    errorRateInWindow: Number(row.error_rate_in_window),
    p95InWindow: Number(row.p95_in_window),
    verified: row.verified as boolean,
    verifiedAt: row.verified_at ? new Date(row.verified_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isRolloutVerified(
  errorRateInWindow: number,
  p95InWindow: number,
  checksPassed: number,
  checksRun: number,
): boolean {
  if (errorRateInWindow > 0.01) return false
  if (p95InWindow > 300) return false
  if (checksRun === 0) return false
  return checksPassed / checksRun >= 0.95
}

export function computeVerificationCheckRate(checksPassed: number, checksRun: number): number {
  if (checksRun === 0) return 0
  return checksPassed / checksRun
}

export function classifyRolloutHealth(
  errorRate: number,
  p95Ms: number,
): 'healthy' | 'degraded' | 'failing' {
  if (errorRate > 0.05 || p95Ms > 500) return 'failing'
  if (errorRate > 0.01 || p95Ms > 300) return 'degraded'
  return 'healthy'
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function createVerification(
  rolloutId: string,
  checksRun: number,
  checksPassed: number,
  tenantSampleSize: number,
  errorRateInWindow: number,
  p95InWindow: number,
): Promise<RolloutVerification> {
  const verified = isRolloutVerified(errorRateInWindow, p95InWindow, checksPassed, checksRun)
  const result = await pool.query(
    `INSERT INTO p12_rollout_verifications
       (rollout_id, checks_run, checks_passed, tenant_sample_size, error_rate_in_window, p95_in_window, verified, verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [rolloutId, checksRun, checksPassed, tenantSampleSize, errorRateInWindow, p95InWindow, verified, verified ? new Date() : null],
  )
  return _mapVerification(result.rows[0])
}

export async function getVerification(rolloutId: string): Promise<RolloutVerification | null> {
  const result = await pool.query(
    `SELECT * FROM p12_rollout_verifications
     WHERE rollout_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [rolloutId],
  )
  return result.rows[0] ? _mapVerification(result.rows[0]) : null
}

export async function getUnverifiedRollouts(): Promise<RolloutVerification[]> {
  const result = await pool.query(
    `SELECT * FROM p12_rollout_verifications
     WHERE verified = FALSE
     ORDER BY created_at ASC`,
  )
  return result.rows.map(_mapVerification)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  isRolloutVerified,
  computeVerificationCheckRate,
  classifyRolloutHealth,
  _mapVerification,
}
