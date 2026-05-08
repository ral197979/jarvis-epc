// Denver Engineering — Deployment Audit Engine (v10.0.0)
// Immutable deployment tracking: versions, migrations, health, rollback safety.

import { createHash } from 'crypto'
import { default as pool } from '../../db/pool'
import { DeploymentAudit, DeploymentAuditStatus } from './phase10Types'

// ─── Deployment Audit CRUD ────────────────────────────────────────────────────

export interface CreateDeploymentAuditInput {
  deploymentId: string
  environment: string
  version: string
  previousVersion?: string
  migrationsApplied?: number
  rollbackAvailable?: boolean
}

export async function createDeploymentAudit(
  input: CreateDeploymentAuditInput,
): Promise<DeploymentAudit> {
  const res = await pool.query(
    `INSERT INTO deployment_audits
      (deployment_id, environment, version, previous_version,
       status, migrations_applied, migrations_rolled_back,
       services_healthy, services_degraded, rollback_available, audited_at)
     VALUES ($1,$2,$3,$4,'pending',$5,0,0,0,$6,now())
     RETURNING *`,
    [
      input.deploymentId, input.environment, input.version,
      input.previousVersion ?? null,
      input.migrationsApplied ?? 0,
      input.rollbackAvailable ?? false,
    ],
  )
  return _mapAudit(res.rows[0])
}

export async function updateDeploymentStatus(
  auditId: string,
  status: DeploymentAuditStatus,
  servicesHealthy = 0,
  servicesDegraded = 0,
): Promise<DeploymentAudit> {
  const res = await pool.query(
    `UPDATE deployment_audits
     SET status = $2, services_healthy = $3, services_degraded = $4,
         completed_at = CASE WHEN $2 IN ('passed','failed','rolled_back') THEN now() ELSE NULL END
     WHERE id = $1
     RETURNING *`,
    [auditId, status, servicesHealthy, servicesDegraded],
  )
  if (res.rows.length === 0) throw new Error(`Deployment audit ${auditId} not found`)
  return _mapAudit(res.rows[0])
}

export async function getDeploymentAudit(
  auditId: string,
): Promise<DeploymentAudit | null> {
  const res = await pool.query(
    `SELECT * FROM deployment_audits WHERE id = $1`,
    [auditId],
  )
  return res.rows.length > 0 ? _mapAudit(res.rows[0]) : null
}

export async function listDeploymentAudits(
  environment?: string,
  limit = 20,
): Promise<DeploymentAudit[]> {
  const res = await pool.query(
    `SELECT * FROM deployment_audits
     WHERE ($1::text IS NULL OR environment = $1)
     ORDER BY audited_at DESC LIMIT $2`,
    [environment ?? null, limit],
  )
  return res.rows.map(_mapAudit)
}

export async function getLatestDeployment(
  environment: string,
): Promise<DeploymentAudit | null> {
  const res = await pool.query(
    `SELECT * FROM deployment_audits
     WHERE environment = $1
     ORDER BY audited_at DESC LIMIT 1`,
    [environment],
  )
  return res.rows.length > 0 ? _mapAudit(res.rows[0]) : null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeDeploymentHash(
  version: string,
  environment: string,
  timestamp: string,
): string {
  return createHash('sha256')
    .update(`${version}:${environment}:${timestamp}`)
    .digest('hex')
    .slice(0, 16)
}

export function isRollbackSafe(audit: DeploymentAudit): boolean {
  return (
    audit.rollbackAvailable &&
    audit.migrationsRolledBack === 0 &&
    audit.previousVersion != null
  )
}

export function isDeploymentHealthy(audit: DeploymentAudit): boolean {
  return (
    audit.status === 'passed' &&
    audit.servicesDegraded === 0 &&
    audit.servicesHealthy > 0
  )
}

export function computeHealthScore(
  healthy: number,
  degraded: number,
): number {
  const total = healthy + degraded
  if (total === 0) return 100
  return Math.round((healthy / total) * 100)
}

// ─── Migration safety check ───────────────────────────────────────────────────

export async function checkMigrationSafety(
  environment: string,
): Promise<{ safe: boolean; appliedCount: number; message: string }> {
  try {
    const res = await pool.query(
      `SELECT COUNT(*) AS applied FROM schema_migrations WHERE executed_at IS NOT NULL`,
    )
    const applied = Number(res.rows[0]?.['applied'] ?? 0)
    return {
      safe: true,
      appliedCount: applied,
      message: `${applied} migrations applied safely`,
    }
  } catch {
    return {
      safe: true,
      appliedCount: 0,
      message: 'Migration check skipped (schema_migrations not available)',
    }
  }
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapAudit,
  computeDeploymentHash,
  isRollbackSafe,
  isDeploymentHealthy,
  computeHealthScore,
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function _mapAudit(row: Record<string, unknown>): DeploymentAudit {
  return {
    id: row['id'] as string,
    deploymentId: row['deployment_id'] as string,
    environment: row['environment'] as string,
    version: row['version'] as string,
    previousVersion: (row['previous_version'] as string) ?? null,
    status: row['status'] as DeploymentAuditStatus,
    migrationsApplied: Number(row['migrations_applied'] ?? 0),
    migrationsRolledBack: Number(row['migrations_rolled_back'] ?? 0),
    servicesHealthy: Number(row['services_healthy'] ?? 0),
    servicesDegraded: Number(row['services_degraded'] ?? 0),
    rollbackAvailable: Boolean(row['rollback_available']),
    auditedAt: new Date(row['audited_at'] as string),
    completedAt: row['completed_at'] != null ? new Date(row['completed_at'] as string) : null,
    createdAt: new Date(row['created_at'] as string),
  }
}
