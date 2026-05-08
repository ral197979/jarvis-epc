// Denver Engineering — Tenant Health Escalation (Phase 11)
// Auto-escalate tenant health alerts based on telemetry and pilot scores

import { pool } from '../../db/pool'
import { PILOT_HEALTH_SCORE_THRESHOLD } from './phase11Types'

// ─── Health Escalation ────────────────────────────────────────────────────────

export interface TenantHealthAlert {
  id: string
  tenantId: string
  alertType: 'health_score_drop' | 'churn_risk_elevated' | 'incident_spike' | 'adoption_stall'
  severity: 'critical' | 'warning' | 'info'
  currentValue: number
  thresholdValue: number
  message: string
  assignedTo: string | null
  resolvedAt: Date | null
  createdAt: Date
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _mapAlert(row: Record<string, unknown>): TenantHealthAlert {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    alertType: row.alert_type as TenantHealthAlert['alertType'],
    severity: row.severity as TenantHealthAlert['severity'],
    currentValue: Number(row.current_value),
    thresholdValue: Number(row.threshold_value),
    message: row.message as string,
    assignedTo: row.assigned_to as string | null,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as string) : null,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Create Health Alert ──────────────────────────────────────────────────────

export async function createHealthAlert(
  tenantId: string,
  alertType: TenantHealthAlert['alertType'],
  severity: TenantHealthAlert['severity'],
  currentValue: number,
  thresholdValue: number,
  message: string
): Promise<TenantHealthAlert> {
  const result = await pool.query(
    `INSERT INTO tenant_health_alerts
       (tenant_id, alert_type, severity, current_value, threshold_value,
        message, assigned_to, resolved_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, NOW())
     RETURNING *`,
    [tenantId, alertType, severity, currentValue, thresholdValue, message]
  )
  return _mapAlert(result.rows[0])
}

// ─── Resolve Health Alert ─────────────────────────────────────────────────────

export async function resolveHealthAlert(alertId: string): Promise<TenantHealthAlert> {
  const result = await pool.query(
    `UPDATE tenant_health_alerts SET resolved_at = NOW() WHERE id = $1 RETURNING *`,
    [alertId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Health alert ${alertId} not found`)
  }
  return _mapAlert(result.rows[0])
}

// ─── Assign Health Alert ─────────────────────────────────────────────────────

export async function assignHealthAlert(
  alertId: string,
  assignedTo: string
): Promise<TenantHealthAlert> {
  const result = await pool.query(
    `UPDATE tenant_health_alerts SET assigned_to = $1 WHERE id = $2 RETURNING *`,
    [assignedTo, alertId]
  )
  if (result.rows.length === 0) {
    throw new Error(`Health alert ${alertId} not found`)
  }
  return _mapAlert(result.rows[0])
}

// ─── Get Active Alerts ────────────────────────────────────────────────────────

export async function getActiveAlerts(tenantId?: string): Promise<TenantHealthAlert[]> {
  if (tenantId) {
    const result = await pool.query(
      `SELECT * FROM tenant_health_alerts
       WHERE tenant_id = $1 AND resolved_at IS NULL
       ORDER BY created_at DESC`,
      [tenantId]
    )
    return result.rows.map(_mapAlert)
  }
  const result = await pool.query(
    `SELECT * FROM tenant_health_alerts
     WHERE resolved_at IS NULL
     ORDER BY severity DESC, created_at DESC`
  )
  return result.rows.map(_mapAlert)
}

// ─── Evaluate Health Score Escalation ────────────────────────────────────────

export function evaluateHealthScoreEscalation(
  tenantId: string,
  healthScore: number
): { shouldAlert: boolean; severity: TenantHealthAlert['severity']; message: string } {
  if (healthScore >= PILOT_HEALTH_SCORE_THRESHOLD) {
    return { shouldAlert: false, severity: 'info', message: '' }
  }

  const severity: TenantHealthAlert['severity'] =
    healthScore < 40 ? 'critical' : 'warning'

  return {
    shouldAlert: true,
    severity,
    message: `Tenant health score ${healthScore} is below threshold ${PILOT_HEALTH_SCORE_THRESHOLD}`,
  }
}

// ─── Evaluate Adoption Stall ──────────────────────────────────────────────────

export function evaluateAdoptionStall(
  tenantId: string,
  adoptionScore: number,
  daysSinceLastImprovement: number
): { shouldAlert: boolean; severity: TenantHealthAlert['severity']; message: string } {
  if (adoptionScore >= 60 && daysSinceLastImprovement < 14) {
    return { shouldAlert: false, severity: 'info', message: '' }
  }

  if (daysSinceLastImprovement >= 30 || adoptionScore < 20) {
    return {
      shouldAlert: true,
      severity: 'critical',
      message: `Adoption stall: score ${adoptionScore}, no improvement for ${daysSinceLastImprovement} days`,
    }
  }

  return {
    shouldAlert: true,
    severity: 'warning',
    message: `Adoption slowing: score ${adoptionScore}, ${daysSinceLastImprovement} days since last improvement`,
  }
}

// ─── Evaluate Incident Spike ──────────────────────────────────────────────────

export function evaluateIncidentSpike(
  tenantId: string,
  openIncidents: number
): { shouldAlert: boolean; severity: TenantHealthAlert['severity']; message: string } {
  if (openIncidents < 3) return { shouldAlert: false, severity: 'info', message: '' }

  const severity: TenantHealthAlert['severity'] = openIncidents >= 10 ? 'critical' : 'warning'
  return {
    shouldAlert: true,
    severity,
    message: `Incident spike: ${openIncidents} open incidents for tenant`,
  }
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  _mapAlert,
  evaluateHealthScoreEscalation,
  evaluateAdoptionStall,
  evaluateIncidentSpike,
}
