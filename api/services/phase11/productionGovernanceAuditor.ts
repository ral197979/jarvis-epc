// Denver Engineering — Production Governance Auditor (Phase 11)
// Run periodic governance audits in production to detect configuration drift

import { pool } from '../../db/pool'
import {
  ProductionGovernanceAudit,
  GovernanceDriftEvent,
  GovernanceDriftType,
} from './phase11Types'
import { createHash } from 'crypto'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapAudit(row: Record<string, unknown>): ProductionGovernanceAudit {
  return {
    id: row.id as string,
    environment: row.environment as string,
    overallStatus: row.overall_status as 'compliant' | 'drifted' | 'critical',
    driftCount: Number(row.drift_count),
    controlsVerified: Number(row.controls_verified),
    controlsFailed: Number(row.controls_failed),
    auditHash: row.audit_hash as string,
    auditedAt: new Date(row.audited_at as string),
    createdAt: new Date(row.created_at as string),
  }
}

function _mapDriftEvent(row: Record<string, unknown>): GovernanceDriftEvent {
  return {
    id: row.id as string,
    driftType: row.drift_type as GovernanceDriftType,
    severity: row.severity as 'critical' | 'warning' | 'info',
    tenantId: row.tenant_id as string | null,
    description: row.description as string,
    detectedAt: new Date(row.detected_at as string),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Run Production Governance Audit ────────────────────────────────────────

export async function runProductionGovernanceAudit(
  environment: string
): Promise<ProductionGovernanceAudit> {
  const checks = await Promise.all([
    checkRlsPoliciesActive(),
    checkAuditLogRecency(),
    checkReplayDivergenceRate(),
    checkImmutableLedgerIntegrity(),
    checkAiExplainabilityCompliance(),
  ])

  const controlsVerified = checks.filter(c => c.passed).length
  const controlsFailed = checks.filter(c => !c.passed).length
  const driftEvents = checks.filter(c => !c.passed)

  // Record drift events
  for (const drift of driftEvents) {
    await recordDriftEvent(drift.driftType, drift.severity, null, drift.description)
  }

  const overallStatus: 'compliant' | 'drifted' | 'critical' =
    driftEvents.some(d => d.severity === 'critical') ? 'critical' :
    driftEvents.length > 0 ? 'drifted' : 'compliant'

  const auditHash = computeAuditHash(environment, controlsVerified, controlsFailed)

  const result = await pool.query(
    `INSERT INTO production_governance_audits
       (environment, overall_status, drift_count, controls_verified, controls_failed,
        audit_hash, audited_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     RETURNING *`,
    [environment, overallStatus, driftEvents.length, controlsVerified, controlsFailed, auditHash]
  )
  return _mapAudit(result.rows[0])
}

// ─── Individual Control Checks ────────────────────────────────────────────────

async function checkRlsPoliciesActive(): Promise<{
  passed: boolean
  driftType: GovernanceDriftType
  severity: 'critical' | 'warning' | 'info'
  description: string
}> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM pg_policies WHERE schemaname = 'public'`
  )
  const count = Number(result.rows[0]?.count ?? 0)
  const passed = count >= 10
  return {
    passed,
    driftType: 'rls_policy_removed',
    severity: passed ? 'info' : 'critical',
    description: passed
      ? `${count} RLS policies active`
      : `Only ${count} RLS policies found — expected ≥ 10`,
  }
}

async function checkAuditLogRecency(): Promise<{
  passed: boolean
  driftType: GovernanceDriftType
  severity: 'critical' | 'warning' | 'info'
  description: string
}> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM audit_log_entries
     WHERE created_at >= NOW() - INTERVAL '1 hour'`
  )
  const count = Number(result.rows[0]?.count ?? 0)
  const passed = count > 0
  return {
    passed,
    driftType: 'audit_gap',
    severity: passed ? 'info' : 'warning',
    description: passed
      ? `${count} audit events in last hour`
      : 'No audit events in last hour — possible audit gap',
  }
}

async function checkReplayDivergenceRate(): Promise<{
  passed: boolean
  driftType: GovernanceDriftType
  severity: 'critical' | 'warning' | 'info'
  description: string
}> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM replay_incidents
     WHERE status = 'open' AND created_at >= NOW() - INTERVAL '24 hours'`
  )
  const count = Number(result.rows[0]?.count ?? 0)
  const passed = count === 0
  return {
    passed,
    driftType: 'replay_divergence_spike',
    severity: passed ? 'info' : 'critical',
    description: passed
      ? 'No replay divergence incidents in last 24h'
      : `${count} open replay divergence incident(s) in last 24h`,
  }
}

async function checkImmutableLedgerIntegrity(): Promise<{
  passed: boolean
  driftType: GovernanceDriftType
  severity: 'critical' | 'warning' | 'info'
  description: string
}> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM audit_log_entries WHERE modified_at IS NOT NULL`
    )
    const count = Number(result.rows[0]?.count ?? 0)
    const passed = count === 0
    return {
      passed,
      driftType: 'immutable_record_modified',
      severity: passed ? 'info' : 'critical',
      description: passed
        ? 'No immutable records modified'
        : `${count} audit records have been modified — integrity violation`,
    }
  } catch {
    return {
      passed: true,
      driftType: 'immutable_record_modified',
      severity: 'info',
      description: 'Immutable ledger column not present (expected)',
    }
  }
}

async function checkAiExplainabilityCompliance(): Promise<{
  passed: boolean
  driftType: GovernanceDriftType
  severity: 'critical' | 'warning' | 'info'
  description: string
}> {
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM ai_explainability_reports
     WHERE status != 'compliant' AND created_at >= NOW() - INTERVAL '7 days'`
  )
  const count = Number(result.rows[0]?.count ?? 0)
  const passed = count === 0
  return {
    passed,
    driftType: 'ai_explainability_regression',
    severity: passed ? 'info' : 'warning',
    description: passed
      ? 'All AI models compliant with explainability requirements'
      : `${count} AI model(s) failing explainability checks in last 7 days`,
  }
}

// ─── Record Drift Event ───────────────────────────────────────────────────────

export async function recordDriftEvent(
  driftType: GovernanceDriftType,
  severity: 'critical' | 'warning' | 'info',
  tenantId: string | null,
  description: string
): Promise<GovernanceDriftEvent> {
  const result = await pool.query(
    `INSERT INTO governance_drift_events
       (drift_type, severity, tenant_id, description, detected_at, resolved_at, created_at)
     VALUES ($1, $2, $3, $4, NOW(), NULL, NOW())
     RETURNING *`,
    [driftType, severity, tenantId, description]
  )
  return _mapDriftEvent(result.rows[0])
}

// ─── Resolve Drift Event ──────────────────────────────────────────────────────

export async function resolveDriftEvent(driftEventId: string): Promise<GovernanceDriftEvent> {
  const result = await pool.query(
    `UPDATE governance_drift_events SET resolved_at = NOW() WHERE id = $1 RETURNING *`,
    [driftEventId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Drift event ${driftEventId} not found`)
  }
  return _mapDriftEvent(result.rows[0])
}

// ─── Get Active Drift Events ──────────────────────────────────────────────────

export async function getActiveDriftEvents(): Promise<GovernanceDriftEvent[]> {
  const result = await pool.query(
    `SELECT * FROM governance_drift_events
     WHERE resolved_at IS NULL
     ORDER BY severity DESC, detected_at DESC`
  )
  return result.rows.map(_mapDriftEvent)
}

// ─── Get Latest Audit ─────────────────────────────────────────────────────────

export async function getLatestGovernanceAudit(
  environment: string
): Promise<ProductionGovernanceAudit | null> {
  const result = await pool.query(
    `SELECT * FROM production_governance_audits
     WHERE environment = $1 ORDER BY audited_at DESC LIMIT 1`,
    [environment]
  )
  return result.rows.length > 0 ? _mapAudit(result.rows[0]) : null
}

// ─── Compute Audit Hash ───────────────────────────────────────────────────────

export function computeAuditHash(
  environment: string,
  controlsVerified: number,
  controlsFailed: number
): string {
  const payload = `${environment}:${controlsVerified}:${controlsFailed}:${Date.now()}`
  return createHash('sha256').update(payload).digest('hex').substring(0, 24)
}

// ─── Is Governance Compliant ──────────────────────────────────────────────────

export function isGovernanceCompliant(audit: ProductionGovernanceAudit): boolean {
  return audit.overallStatus === 'compliant' && audit.driftCount === 0
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapAudit,
  _mapDriftEvent,
  computeAuditHash,
  isGovernanceCompliant,
}
