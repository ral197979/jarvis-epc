// Denver Engineering — Rollout Wave Manager (Post-GA)
// Manages phased tenant rollout waves with deployment tracking

import { pool } from '../../db/pool'
import { RolloutWave, WaveStatus } from './postGATypes'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapRolloutWave(row: Record<string, unknown>): RolloutWave {
  return {
    id: row.id as string,
    waveName: row.wave_name as string,
    tenantIds: row.tenant_ids as string[],
    status: row.status as WaveStatus,
    targetCount: Number(row.target_count),
    deployedCount: Number(row.deployed_count),
    failedCount: Number(row.failed_count),
    replayValidated: row.replay_validated as boolean,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at as string) : null,
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeWaveProgress(wave: RolloutWave): number {
  if (wave.targetCount === 0) return 0
  return Math.round((wave.deployedCount / wave.targetCount) * 100)
}

export function computeWaveSuccessRate(wave: RolloutWave): number {
  const attempted = wave.deployedCount + wave.failedCount
  if (attempted === 0) return 1.0
  return wave.deployedCount / attempted
}

export function isWaveComplete(wave: RolloutWave): boolean {
  return wave.status === 'completed' || wave.deployedCount >= wave.targetCount
}

export function shouldAbortWave(wave: RolloutWave): boolean {
  const successRate = computeWaveSuccessRate(wave)
  return !wave.replayValidated || successRate < 0.80
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function createWave(
  waveName: string,
  tenantIds: string[],
  replayValidated: boolean,
  scheduledAt: Date | null,
): Promise<RolloutWave> {
  const result = await pool.query(
    `INSERT INTO pga_rollout_waves
       (wave_name, tenant_ids, status, target_count, deployed_count, failed_count, replay_validated, scheduled_at)
     VALUES ($1,$2,'pending',$3,0,0,$4,$5)
     RETURNING *`,
    [waveName, JSON.stringify(tenantIds), tenantIds.length, replayValidated, scheduledAt],
  )
  return _mapRolloutWave(result.rows[0])
}

export async function advanceWave(waveId: string, deployedDelta: number, failedDelta: number): Promise<RolloutWave> {
  const result = await pool.query(
    `UPDATE pga_rollout_waves
     SET deployed_count = deployed_count + $2,
         failed_count = failed_count + $3,
         status = CASE
           WHEN deployed_count + $2 >= target_count THEN 'completed'
           ELSE 'active'
         END,
         completed_at = CASE WHEN deployed_count + $2 >= target_count THEN NOW() ELSE NULL END
     WHERE id=$1
     RETURNING *`,
    [waveId, deployedDelta, failedDelta],
  )
  if (!result.rows[0]) throw new Error(`RolloutWave ${waveId} not found`)
  return _mapRolloutWave(result.rows[0])
}

export async function getActiveWaves(): Promise<RolloutWave[]> {
  const result = await pool.query(
    `SELECT * FROM pga_rollout_waves WHERE status IN ('pending','active') ORDER BY scheduled_at ASC NULLS LAST`,
  )
  return result.rows.map(_mapRolloutWave)
}

export async function getWave(waveId: string): Promise<RolloutWave | null> {
  const result = await pool.query(
    `SELECT * FROM pga_rollout_waves WHERE id=$1`,
    [waveId],
  )
  return result.rows[0] ? _mapRolloutWave(result.rows[0]) : null
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeWaveProgress,
  computeWaveSuccessRate,
  isWaveComplete,
  shouldAbortWave,
  _mapRolloutWave,
}
