// Denver Engineering — Deployment Operations Coordinator (Post-GA)
// Coordinates tenant deployment readiness, onboarding verification, and launch records

import { pool } from '../../db/pool'
import { tenantQuery } from '../../db/pool'
import { TenantLaunchRecord, LaunchGate, DeploymentReadinessStatus, DEPLOYMENT_READINESS_THRESHOLD } from './postGATypes'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapLaunchRecord(row: Record<string, unknown>): TenantLaunchRecord {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    waveId: row.wave_id as string | null,
    readinessScore: Number(row.readiness_score),
    onboardingComplete: row.onboarding_complete as boolean,
    replayValidated: row.replay_validated as boolean,
    governanceVerified: row.governance_verified as boolean,
    status: row.status as DeploymentReadinessStatus,
    launchedAt: row.launched_at ? new Date(row.launched_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeReadinessScore(
  onboardingComplete: boolean,
  replayValidated: boolean,
  governanceVerified: boolean,
  gatePassRate: number,
): number {
  const base = gatePassRate * 60
  const bonus =
    (onboardingComplete ? 15 : 0) +
    (replayValidated ? 15 : 0) +
    (governanceVerified ? 10 : 0)
  return Math.min(100, Math.round(base + bonus))
}

export function isReadyToLaunch(record: TenantLaunchRecord): boolean {
  return (
    record.readinessScore >= DEPLOYMENT_READINESS_THRESHOLD &&
    record.replayValidated &&
    record.governanceVerified
  )
}

export function classifyDeploymentStatus(
  readinessScore: number,
  replayValidated: boolean,
  governanceVerified: boolean,
): DeploymentReadinessStatus {
  if (!replayValidated || !governanceVerified) return 'not_ready'
  if (readinessScore >= DEPLOYMENT_READINESS_THRESHOLD) return 'ready'
  return 'not_ready'
}

export function computeGatePassRate(gates: LaunchGate[]): number {
  if (gates.length === 0) return 1.0
  const passed = gates.filter(g => g.status === 'pass').length
  return passed / gates.length
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function createLaunchRecord(
  tenantId: string,
  waveId: string | null,
  onboardingComplete: boolean,
  replayValidated: boolean,
  governanceVerified: boolean,
  gatePassRate: number,
): Promise<TenantLaunchRecord> {
  const readinessScore = computeReadinessScore(onboardingComplete, replayValidated, governanceVerified, gatePassRate)
  const status = classifyDeploymentStatus(readinessScore, replayValidated, governanceVerified)

  const result = await pool.query(
    `INSERT INTO pga_tenant_launch_records
       (tenant_id, wave_id, readiness_score, onboarding_complete, replay_validated,
        governance_verified, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [tenantId, waveId, readinessScore, onboardingComplete, replayValidated, governanceVerified, status],
  )
  return _mapLaunchRecord(result.rows[0])
}

export async function markLaunched(tenantId: string): Promise<TenantLaunchRecord> {
  const result = await pool.query(
    `UPDATE pga_tenant_launch_records
     SET status='deployed', launched_at=NOW()
     WHERE tenant_id=$1 AND status='ready'
     RETURNING *`,
    [tenantId],
  )
  if (!result.rows[0]) throw new Error(`TenantLaunchRecord for ${tenantId} not in ready state`)
  return _mapLaunchRecord(result.rows[0])
}

export async function getLaunchRecord(tenantId: string): Promise<TenantLaunchRecord | null> {
  const result = await tenantQuery(
    tenantId,
    `SELECT * FROM pga_tenant_launch_records WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`,
    [tenantId],
  )
  return result.rows[0] ? _mapLaunchRecord(result.rows[0]) : null
}

export async function getReadyTenants(): Promise<TenantLaunchRecord[]> {
  const result = await pool.query(
    `SELECT * FROM pga_tenant_launch_records WHERE status='ready' ORDER BY readiness_score DESC`,
  )
  return result.rows.map(_mapLaunchRecord)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeReadinessScore,
  isReadyToLaunch,
  classifyDeploymentStatus,
  computeGatePassRate,
  _mapLaunchRecord,
}
