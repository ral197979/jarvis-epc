// Denver Engineering — Deployment Automation Engine (Phase 11)
// Orchestrate automated rollout plans with canary and wave strategies

import { pool } from '../../db/pool'
import {
  RolloutPlan,
  DeploymentStrategy,
  RolloutStatus,
} from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapRolloutPlan(row: Record<string, unknown>): RolloutPlan {
  return {
    id: row.id as string,
    environment: row.environment as string,
    version: row.version as string,
    strategy: row.strategy as DeploymentStrategy,
    status: row.status as RolloutStatus,
    totalTenants: Number(row.total_tenants),
    deployedTenants: Number(row.deployed_tenants),
    failedTenants: Number(row.failed_tenants),
    canaryPercent: row.canary_percent != null ? Number(row.canary_percent) : null,
    waveSize: row.wave_size != null ? Number(row.wave_size) : null,
    currentWave: Number(row.current_wave),
    startedAt: new Date(row.started_at as string),
    completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Create Rollout Plan ──────────────────────────────────────────────────────

export async function createRolloutPlan(
  environment: string,
  version: string,
  strategy: DeploymentStrategy,
  totalTenants: number,
  canaryPercent: number | null = null,
  waveSize: number | null = null
): Promise<RolloutPlan> {
  const result = await pool.query(
    `INSERT INTO rollout_plans
       (environment, version, strategy, status, total_tenants, deployed_tenants,
        failed_tenants, canary_percent, wave_size, current_wave,
        started_at, completed_at, created_at)
     VALUES ($1, $2, $3, 'pending', $4, 0, 0, $5, $6, 0, NOW(), NULL, NOW())
     RETURNING *`,
    [environment, version, strategy, totalTenants, canaryPercent, waveSize]
  )
  return _mapRolloutPlan(result.rows[0])
}

// ─── Get Rollout Plan ─────────────────────────────────────────────────────────

export async function getRolloutPlan(planId: string): Promise<RolloutPlan | null> {
  const result = await pool.query(
    `SELECT * FROM rollout_plans WHERE id = $1`,
    [planId]
  )
  return result.rows.length > 0 ? _mapRolloutPlan(result.rows[0]) : null
}

// ─── Advance Rollout ──────────────────────────────────────────────────────────

export async function advanceRollout(
  planId: string,
  deployedCount: number,
  failedCount: number
): Promise<RolloutPlan> {
  const result = await pool.query(
    `UPDATE rollout_plans
     SET deployed_tenants = deployed_tenants + $1,
         failed_tenants = failed_tenants + $2
     WHERE id = $3
     RETURNING *`,
    [deployedCount, failedCount, planId]
  )
  return _mapRolloutPlan(result.rows[0])
}

// ─── Advance Wave ─────────────────────────────────────────────────────────────

export async function advanceWave(planId: string): Promise<RolloutPlan> {
  const result = await pool.query(
    `UPDATE rollout_plans
     SET current_wave = current_wave + 1, status = 'running'
     WHERE id = $1
     RETURNING *`,
    [planId]
  )
  return _mapRolloutPlan(result.rows[0])
}

// ─── Finalize Rollout ─────────────────────────────────────────────────────────

export async function finalizeRollout(
  planId: string,
  status: RolloutStatus
): Promise<RolloutPlan> {
  const result = await pool.query(
    `UPDATE rollout_plans
     SET status = $1, completed_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [status, planId]
  )
  return _mapRolloutPlan(result.rows[0])
}

// ─── Pause Rollout ────────────────────────────────────────────────────────────

export async function pauseRollout(planId: string): Promise<RolloutPlan> {
  const result = await pool.query(
    `UPDATE rollout_plans SET status = 'paused' WHERE id = $1 RETURNING *`,
    [planId]
  )
  return _mapRolloutPlan(result.rows[0])
}

// ─── List Rollout Plans ───────────────────────────────────────────────────────

export async function listRolloutPlans(
  environment: string,
  status?: RolloutStatus
): Promise<RolloutPlan[]> {
  if (status) {
    const result = await pool.query(
      `SELECT * FROM rollout_plans WHERE environment = $1 AND status = $2 ORDER BY started_at DESC`,
      [environment, status]
    )
    return result.rows.map(_mapRolloutPlan)
  }
  const result = await pool.query(
    `SELECT * FROM rollout_plans WHERE environment = $1 ORDER BY started_at DESC`,
    [environment]
  )
  return result.rows.map(_mapRolloutPlan)
}

// ─── Compute Canary Tenant Count ─────────────────────────────────────────────

export function computeCanaryTenantCount(
  totalTenants: number,
  canaryPercent: number
): number {
  return Math.max(1, Math.floor(totalTenants * (canaryPercent / 100)))
}

// ─── Compute Rollout Progress ─────────────────────────────────────────────────

export function computeRolloutProgress(plan: RolloutPlan): number {
  if (plan.totalTenants === 0) return 0
  const processed = plan.deployedTenants + plan.failedTenants
  return Math.round((processed / plan.totalTenants) * 100)
}

// ─── Is Rollout Healthy ───────────────────────────────────────────────────────

export function isRolloutHealthy(plan: RolloutPlan): boolean {
  const processed = plan.deployedTenants + plan.failedTenants
  if (processed === 0) return true
  const failureRate = plan.failedTenants / processed
  return failureRate <= 0.05
}

// ─── Should Rollback ──────────────────────────────────────────────────────────

export function shouldRollback(plan: RolloutPlan): boolean {
  const processed = plan.deployedTenants + plan.failedTenants
  if (processed === 0) return false
  const failureRate = plan.failedTenants / processed
  return failureRate > 0.1
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapRolloutPlan,
  computeCanaryTenantCount,
  computeRolloutProgress,
  isRolloutHealthy,
  shouldRollback,
}
