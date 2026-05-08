// Denver Engineering — Rollout Coordinator (Phase 11)
// Coordinate per-tenant rollout execution within a rollout plan

import { pool } from '../../db/pool'
import { TenantRollout } from './phase11Types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapTenantRollout(row: Record<string, unknown>): TenantRollout {
  return {
    id: row.id as string,
    rolloutPlanId: row.rollout_plan_id as string,
    tenantId: row.tenant_id as string,
    wave: Number(row.wave),
    status: row.status as TenantRollout['status'],
    deployedAt: row.deployed_at ? new Date(row.deployed_at as string) : null,
    verifiedAt: row.verified_at ? new Date(row.verified_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Enqueue Tenant Rollout ───────────────────────────────────────────────────

export async function enqueueTenantRollout(
  rolloutPlanId: string,
  tenantId: string,
  wave: number
): Promise<TenantRollout> {
  const result = await pool.query(
    `INSERT INTO tenant_rollouts
       (rollout_plan_id, tenant_id, wave, status, deployed_at, verified_at, created_at)
     VALUES ($1, $2, $3, 'pending', NULL, NULL, NOW())
     RETURNING *`,
    [rolloutPlanId, tenantId, wave]
  )
  return _mapTenantRollout(result.rows[0])
}

// ─── Mark Tenant Deployed ─────────────────────────────────────────────────────

export async function markTenantDeployed(rolloutId: string): Promise<TenantRollout> {
  const result = await pool.query(
    `UPDATE tenant_rollouts
     SET status = 'complete', deployed_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [rolloutId]
  )
  if (result.rows.length === 0) {
    throw new Error(`TenantRollout ${rolloutId} not found`)
  }
  return _mapTenantRollout(result.rows[0])
}

// ─── Mark Tenant Verified ─────────────────────────────────────────────────────

export async function markTenantVerified(rolloutId: string): Promise<TenantRollout> {
  const result = await pool.query(
    `UPDATE tenant_rollouts
     SET verified_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [rolloutId]
  )
  if (result.rows.length === 0) {
    throw new Error(`TenantRollout ${rolloutId} not found`)
  }
  return _mapTenantRollout(result.rows[0])
}

// ─── Mark Tenant Failed ───────────────────────────────────────────────────────

export async function markTenantFailed(rolloutId: string): Promise<TenantRollout> {
  const result = await pool.query(
    `UPDATE tenant_rollouts
     SET status = 'failed'
     WHERE id = $1
     RETURNING *`,
    [rolloutId]
  )
  if (result.rows.length === 0) {
    throw new Error(`TenantRollout ${rolloutId} not found`)
  }
  return _mapTenantRollout(result.rows[0])
}

// ─── Skip Tenant Rollout ──────────────────────────────────────────────────────

export async function skipTenantRollout(rolloutId: string): Promise<TenantRollout> {
  const result = await pool.query(
    `UPDATE tenant_rollouts SET status = 'skipped' WHERE id = $1 RETURNING *`,
    [rolloutId]
  )
  if (result.rows.length === 0) {
    throw new Error(`TenantRollout ${rolloutId} not found`)
  }
  return _mapTenantRollout(result.rows[0])
}

// ─── Get Tenant Rollout ───────────────────────────────────────────────────────

export async function getTenantRollout(rolloutId: string): Promise<TenantRollout | null> {
  const result = await pool.query(
    `SELECT * FROM tenant_rollouts WHERE id = $1`,
    [rolloutId]
  )
  return result.rows.length > 0 ? _mapTenantRollout(result.rows[0]) : null
}

// ─── List Rollouts for Plan ───────────────────────────────────────────────────

export async function listRolloutsForPlan(
  rolloutPlanId: string,
  wave?: number
): Promise<TenantRollout[]> {
  if (wave !== undefined) {
    const result = await pool.query(
      `SELECT * FROM tenant_rollouts WHERE rollout_plan_id = $1 AND wave = $2 ORDER BY created_at ASC`,
      [rolloutPlanId, wave]
    )
    return result.rows.map(_mapTenantRollout)
  }
  const result = await pool.query(
    `SELECT * FROM tenant_rollouts WHERE rollout_plan_id = $1 ORDER BY wave ASC, created_at ASC`,
    [rolloutPlanId]
  )
  return result.rows.map(_mapTenantRollout)
}

// ─── Get Pending Rollouts for Wave ────────────────────────────────────────────

export async function getPendingRolloutsForWave(
  rolloutPlanId: string,
  wave: number
): Promise<TenantRollout[]> {
  const result = await pool.query(
    `SELECT * FROM tenant_rollouts
     WHERE rollout_plan_id = $1 AND wave = $2 AND status = 'pending'
     ORDER BY created_at ASC`,
    [rolloutPlanId, wave]
  )
  return result.rows.map(_mapTenantRollout)
}

// ─── Compute Wave Success Rate ────────────────────────────────────────────────

export function computeWaveSuccessRate(rollouts: TenantRollout[]): number {
  const finished = rollouts.filter(r => r.status === 'complete' || r.status === 'failed')
  if (finished.length === 0) return 0
  const successful = finished.filter(r => r.status === 'complete').length
  return successful / finished.length
}

// ─── Is Wave Complete ─────────────────────────────────────────────────────────

export function isWaveComplete(rollouts: TenantRollout[]): boolean {
  return rollouts.length > 0 && rollouts.every(
    r => r.status === 'complete' || r.status === 'failed' || r.status === 'skipped'
  )
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapTenantRollout,
  computeWaveSuccessRate,
  isWaveComplete,
}
