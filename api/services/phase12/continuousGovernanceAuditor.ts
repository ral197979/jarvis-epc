// Denver Engineering — Continuous Governance Auditor (Phase 12)
// Runs periodic governance validation cycles across all check types

import crypto from 'crypto'
import { pool } from '../../db/pool'
import { GovernanceAuditCycle, GovernanceCheckType } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapAuditCycle(row: Record<string, unknown>): GovernanceAuditCycle {
  return {
    id: row.id as string,
    environment: row.environment as string,
    checksRun: row.checks_run as GovernanceCheckType[],
    passed: Number(row.passed),
    failed: Number(row.failed),
    warnings: Number(row.warnings),
    overallStatus: row.overall_status as 'compliant' | 'warning' | 'non_compliant',
    auditHash: row.audit_hash as string,
    ranAt: new Date(row.ran_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function computeAuditCycleHash(
  environment: string,
  checksRun: GovernanceCheckType[],
  passed: number,
  failed: number,
  ranAt: Date,
): string {
  const payload = JSON.stringify({ environment, checksRun: [...checksRun].sort(), passed, failed, ranAt: ranAt.toISOString() })
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24)
}

export function classifyAuditStatus(
  passed: number,
  failed: number,
  warnings: number,
): 'compliant' | 'warning' | 'non_compliant' {
  if (failed > 0) return 'non_compliant'
  if (warnings > 0) return 'warning'
  return 'compliant'
}

export function isAuditCyclePassing(cycle: GovernanceAuditCycle): boolean {
  return cycle.overallStatus === 'compliant' && cycle.failed === 0
}

export function computeAuditPassRate(cycles: GovernanceAuditCycle[]): number {
  if (cycles.length === 0) return 1.0
  const passing = cycles.filter(c => c.overallStatus === 'compliant').length
  return passing / cycles.length
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordAuditCycle(
  environment: string,
  checksRun: GovernanceCheckType[],
  passed: number,
  failed: number,
  warnings: number,
): Promise<GovernanceAuditCycle> {
  const ranAt = new Date()
  const overallStatus = classifyAuditStatus(passed, failed, warnings)
  const auditHash = computeAuditCycleHash(environment, checksRun, passed, failed, ranAt)

  const result = await pool.query(
    `INSERT INTO p12_governance_audit_cycles
       (environment, checks_run, passed, failed, warnings, overall_status, audit_hash, ran_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [environment, JSON.stringify(checksRun), passed, failed, warnings, overallStatus, auditHash, ranAt],
  )
  return _mapAuditCycle(result.rows[0])
}

export async function getLatestAuditCycles(environment: string, limit = 10): Promise<GovernanceAuditCycle[]> {
  const result = await pool.query(
    `SELECT * FROM p12_governance_audit_cycles
     WHERE environment = $1
     ORDER BY ran_at DESC
     LIMIT $2`,
    [environment, limit],
  )
  return result.rows.map(_mapAuditCycle)
}

export async function getFailingCycles(environment: string): Promise<GovernanceAuditCycle[]> {
  const result = await pool.query(
    `SELECT * FROM p12_governance_audit_cycles
     WHERE environment = $1 AND overall_status = 'non_compliant'
     ORDER BY ran_at DESC`,
    [environment],
  )
  return result.rows.map(_mapAuditCycle)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  computeAuditCycleHash,
  classifyAuditStatus,
  isAuditCyclePassing,
  computeAuditPassRate,
  _mapAuditCycle,
}
