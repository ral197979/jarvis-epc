// Denver Engineering — Governance Regression Monitor (Phase 12)
// Detects regressions in governance check results over time

import { pool } from '../../db/pool'
import { GovernanceRegressionAlert, GovernanceCheckType } from './phase12Types'

// ─── Mapper ──────────────────────────────────────────────────────────────────

function _mapRegressionAlert(row: Record<string, unknown>): GovernanceRegressionAlert {
  return {
    id: row.id as string,
    checkType: row.check_type as GovernanceCheckType,
    previousStatus: row.previous_status as 'pass' | 'warn' | 'fail',
    currentStatus: row.current_status as 'pass' | 'warn' | 'fail',
    severity: row.severity as 'critical' | 'warning',
    detail: row.detail as string,
    detectedAt: new Date(row.detected_at as string),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function classifyRegressionSeverity(
  checkType: GovernanceCheckType,
  previousStatus: 'pass' | 'warn' | 'fail',
  currentStatus: 'pass' | 'warn' | 'fail',
): 'critical' | 'warning' {
  const criticalChecks: GovernanceCheckType[] = [
    'replay_integrity',
    'tenant_isolation',
    'plugin_isolation',
    'billing_correctness',
  ]
  if (criticalChecks.includes(checkType)) return 'critical'
  if (previousStatus === 'pass' && currentStatus === 'fail') return 'critical'
  return 'warning'
}

export function isRegressionDetected(
  previousStatus: 'pass' | 'warn' | 'fail',
  currentStatus: 'pass' | 'warn' | 'fail',
): boolean {
  if (previousStatus === 'pass' && currentStatus !== 'pass') return true
  if (previousStatus === 'warn' && currentStatus === 'fail') return true
  return false
}

export function hasOpenCriticalRegression(alerts: GovernanceRegressionAlert[]): boolean {
  return alerts.some(a => a.severity === 'critical' && a.resolvedAt === null)
}

// ─── Service ─────────────────────────────────────────────────────────────────

export async function recordRegressionAlert(
  checkType: GovernanceCheckType,
  previousStatus: 'pass' | 'warn' | 'fail',
  currentStatus: 'pass' | 'warn' | 'fail',
  detail: string,
): Promise<GovernanceRegressionAlert> {
  const severity = classifyRegressionSeverity(checkType, previousStatus, currentStatus)
  const result = await pool.query(
    `INSERT INTO p12_governance_regression_alerts
       (check_type, previous_status, current_status, severity, detail, detected_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     RETURNING *`,
    [checkType, previousStatus, currentStatus, severity, detail],
  )
  return _mapRegressionAlert(result.rows[0])
}

export async function getOpenAlerts(): Promise<GovernanceRegressionAlert[]> {
  const result = await pool.query(
    `SELECT * FROM p12_governance_regression_alerts
     WHERE resolved_at IS NULL
     ORDER BY detected_at DESC`,
  )
  return result.rows.map(_mapRegressionAlert)
}

export async function resolveAlert(alertId: string): Promise<GovernanceRegressionAlert> {
  const result = await pool.query(
    `UPDATE p12_governance_regression_alerts
     SET resolved_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [alertId],
  )
  if (!result.rows[0]) throw new Error(`RegressionAlert ${alertId} not found`)
  return _mapRegressionAlert(result.rows[0])
}

export async function getAlertsByCheck(checkType: GovernanceCheckType): Promise<GovernanceRegressionAlert[]> {
  const result = await pool.query(
    `SELECT * FROM p12_governance_regression_alerts
     WHERE check_type = $1
     ORDER BY detected_at DESC
     LIMIT 50`,
    [checkType],
  )
  return result.rows.map(_mapRegressionAlert)
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  classifyRegressionSeverity,
  isRegressionDetected,
  hasOpenCriticalRegression,
  _mapRegressionAlert,
}
