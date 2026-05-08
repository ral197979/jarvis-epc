// Denver Engineering — Governance Durability Auditor (Post-GA)
// Continuously validates governance dimensions under real production conditions

import { pool } from '../../db/pool'
import {
  GovernanceDurabilityRecord,
  ReplayDriftRecord,
  GovernanceDimension,
  GOVERNANCE_DURABILITY_MIN_PASS_RATE,
  REPLAY_DRIFT_ALERT_THRESHOLD,
} from './postGATypes'

// ─── Mappers ─────────────────────────────────────────────────────────────────

function _mapDurabilityRecord(row: Record<string, unknown>): GovernanceDurabilityRecord {
  return {
    id: row.id as string,
    dimension: row.dimension as GovernanceDimension,
    passRate: Number(row.pass_rate),
    failCount: Number(row.fail_count),
    warnCount: Number(row.warn_count),
    isDurable: row.is_durable as boolean,
    trend: row.trend as GovernanceDurabilityRecord['trend'],
    measuredAt: new Date(row.measured_at as string),
  }
}

function _mapReplayDriftRecord(row: Record<string, unknown>): ReplayDriftRecord {
  return {
    id: row.id as string,
    streamId: row.stream_id as string,
    tenantId: row.tenant_id as string,
    baselineDeterminismRate: Number(row.baseline_determinism_rate),
    currentDeterminismRate: Number(row.current_determinism_rate),
    driftPct: Number(row.drift_pct),
    isAlert: row.is_alert as boolean,
    detectedAt: new Date(row.detected_at as string),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function isGovernanceDurable(passRate: number): boolean {
  return passRate >= GOVERNANCE_DURABILITY_MIN_PASS_RATE
}

export function classifyGovernanceTrend(
  currentPassRate: number,
  previousPassRate: number,
): GovernanceDurabilityRecord['trend'] {
  const delta = currentPassRate - previousPassRate
  if (delta > 0.01) return 'improving'
  if (delta < -0.01) return 'degrading'
  return 'stable'
}

export function computeReplayDriftPct(baseline: number, current: number): number {
  if (baseline === 0) return current !== 0 ? 1.0 : 0
  return Math.abs(current - baseline) / baseline
}

export function isReplayDriftAlert(driftPct: number): boolean {
  return driftPct > REPLAY_DRIFT_ALERT_THRESHOLD
}

export function hasOpenReplayDrift(records: ReplayDriftRecord[]): boolean {
  return records.some(r => r.isAlert && r.resolvedAt === null)
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordDurabilityCheck(
  dimension: GovernanceDimension,
  passRate: number,
  failCount: number,
  warnCount: number,
  previousPassRate: number,
): Promise<GovernanceDurabilityRecord> {
  const isDurable = isGovernanceDurable(passRate)
  const trend = classifyGovernanceTrend(passRate, previousPassRate)

  const result = await pool.query(
    `INSERT INTO pga_governance_durability
       (dimension, pass_rate, fail_count, warn_count, is_durable, trend, measured_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [dimension, passRate, failCount, warnCount, isDurable, trend],
  )
  return _mapDurabilityRecord(result.rows[0])
}

export async function recordReplayDrift(
  streamId: string,
  tenantId: string,
  baselineDeterminismRate: number,
  currentDeterminismRate: number,
): Promise<ReplayDriftRecord> {
  const driftPct = computeReplayDriftPct(baselineDeterminismRate, currentDeterminismRate)
  const isAlert = isReplayDriftAlert(driftPct)

  const result = await pool.query(
    `INSERT INTO pga_replay_drift_records
       (stream_id, tenant_id, baseline_determinism_rate, current_determinism_rate, drift_pct, is_alert, detected_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())
     RETURNING *`,
    [streamId, tenantId, baselineDeterminismRate, currentDeterminismRate, driftPct, isAlert],
  )
  return _mapReplayDriftRecord(result.rows[0])
}

export async function getOpenReplayDriftAlerts(): Promise<ReplayDriftRecord[]> {
  const result = await pool.query(
    `SELECT * FROM pga_replay_drift_records WHERE is_alert=TRUE AND resolved_at IS NULL ORDER BY detected_at ASC`,
  )
  return result.rows.map(_mapReplayDriftRecord)
}

export async function getDurabilityByDimension(dimension: GovernanceDimension, limit = 10): Promise<GovernanceDurabilityRecord[]> {
  const result = await pool.query(
    `SELECT * FROM pga_governance_durability WHERE dimension=$1 ORDER BY measured_at DESC LIMIT $2`,
    [dimension, limit],
  )
  return result.rows.map(_mapDurabilityRecord)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  isGovernanceDurable,
  classifyGovernanceTrend,
  computeReplayDriftPct,
  isReplayDriftAlert,
  hasOpenReplayDrift,
  _mapDurabilityRecord,
  _mapReplayDriftRecord,
}
