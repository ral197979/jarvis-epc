// Denver Engineering — GA Readiness Service (Phase 11)
// Aggregate GA readiness scores across all dimensions and manage deployment waves

import { pool } from '../../db/pool'
import {
  GAReadinessScore,
  DeploymentWave,
  GAReadinessDimension,
  GA_READINESS_PASS_SCORE,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapReadinessScore(row: Record<string, unknown>): GAReadinessScore {
  return {
    id: row.id as string,
    environment: row.environment as string,
    dimension: row.dimension as GAReadinessDimension,
    score: Number(row.score),
    status: row.status as 'ready' | 'at_risk' | 'blocking',
    notes: row.notes as string | null,
    scoredAt: new Date(row.scored_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

function _mapDeploymentWave(row: Record<string, unknown>): DeploymentWave {
  return {
    id: row.id as string,
    waveName: row.wave_name as string,
    waveNumber: Number(row.wave_number),
    targetCustomers: (row.target_customers as string[]) ?? [],
    status: row.status as 'planned' | 'active' | 'complete' | 'paused',
    startDate: row.start_date ? new Date(row.start_date as string) : null,
    endDate: row.end_date ? new Date(row.end_date as string) : null,
    successCriteria: (row.success_criteria as string[]) ?? [],
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Record Readiness Score ───────────────────────────────────────────────────

export async function recordReadinessScore(
  environment: string,
  dimension: GAReadinessDimension,
  score: number,
  notes: string | null = null
): Promise<GAReadinessScore> {
  const status = classifyReadinessStatus(score)
  const result = await pool.query(
    `INSERT INTO ga_readiness_scores
       (environment, dimension, score, status, notes, scored_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [environment, dimension, score, status, notes]
  )
  return _mapReadinessScore(result.rows[0])
}

// ─── Get Readiness Scores ─────────────────────────────────────────────────────

export async function getReadinessScores(environment: string): Promise<GAReadinessScore[]> {
  const result = await pool.query(
    `SELECT DISTINCT ON (dimension) *
     FROM ga_readiness_scores
     WHERE environment = $1
     ORDER BY dimension, scored_at DESC`,
    [environment]
  )
  return result.rows.map(_mapReadinessScore)
}

// ─── Classify Readiness Status ────────────────────────────────────────────────

export function classifyReadinessStatus(score: number): 'ready' | 'at_risk' | 'blocking' {
  if (score >= GA_READINESS_PASS_SCORE) return 'ready'
  if (score >= 60) return 'at_risk'
  return 'blocking'
}

// ─── Compute Overall Readiness ────────────────────────────────────────────────

export function computeOverallReadiness(scores: GAReadinessScore[]): {
  overallScore: number
  status: 'ready' | 'at_risk' | 'blocking'
  blockingCount: number
  atRiskCount: number
} {
  if (scores.length === 0) {
    return { overallScore: 0, status: 'blocking', blockingCount: 0, atRiskCount: 0 }
  }

  const avg = scores.reduce((acc, s) => acc + s.score, 0) / scores.length
  const blockingCount = scores.filter(s => s.status === 'blocking').length
  const atRiskCount = scores.filter(s => s.status === 'at_risk').length

  const status: 'ready' | 'at_risk' | 'blocking' =
    blockingCount > 0 ? 'blocking' :
    atRiskCount > 0 ? 'at_risk' : 'ready'

  return {
    overallScore: Math.round(avg),
    status,
    blockingCount,
    atRiskCount,
  }
}

// ─── Is Ready for GA ──────────────────────────────────────────────────────────

export function isReadyForGA(scores: GAReadinessScore[]): boolean {
  const { status, blockingCount } = computeOverallReadiness(scores)
  return status === 'ready' && blockingCount === 0
}

// ─── Create Deployment Wave ───────────────────────────────────────────────────

export async function createDeploymentWave(
  waveName: string,
  waveNumber: number,
  targetCustomers: string[],
  successCriteria: string[],
  startDate: Date | null = null,
  endDate: Date | null = null
): Promise<DeploymentWave> {
  const result = await pool.query(
    `INSERT INTO deployment_waves
       (wave_name, wave_number, target_customers, status, start_date, end_date,
        success_criteria, created_at)
     VALUES ($1, $2, $3, 'planned', $4, $5, $6, NOW())
     RETURNING *`,
    [waveName, waveNumber, targetCustomers, startDate, endDate, successCriteria]
  )
  return _mapDeploymentWave(result.rows[0])
}

// ─── Advance Wave Status ──────────────────────────────────────────────────────

export async function advanceWaveStatus(
  waveId: string,
  status: 'active' | 'complete' | 'paused'
): Promise<DeploymentWave> {
  const result = await pool.query(
    `UPDATE deployment_waves SET status = $1 WHERE id = $2 RETURNING *`,
    [status, waveId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Deployment wave ${waveId} not found`)
  }
  return _mapDeploymentWave(result.rows[0])
}

// ─── Get Deployment Waves ─────────────────────────────────────────────────────

export async function getDeploymentWaves(): Promise<DeploymentWave[]> {
  const result = await pool.query(
    `SELECT * FROM deployment_waves ORDER BY wave_number ASC`
  )
  return result.rows.map(_mapDeploymentWave)
}

// ─── Get Active Wave ──────────────────────────────────────────────────────────

export async function getActiveWave(): Promise<DeploymentWave | null> {
  const result = await pool.query(
    `SELECT * FROM deployment_waves WHERE status = 'active' ORDER BY wave_number ASC LIMIT 1`
  )
  return result.rows.length > 0 ? _mapDeploymentWave(result.rows[0]) : null
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapReadinessScore,
  _mapDeploymentWave,
  classifyReadinessStatus,
  computeOverallReadiness,
  isReadyForGA,
}
