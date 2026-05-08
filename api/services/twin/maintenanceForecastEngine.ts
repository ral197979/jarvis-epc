// Denver Engineering — Maintenance Forecast Engine (v6.0.0)
// Predicts maintenance windows, asset health decay, and inspection recommendations.

import { tenantQuery } from '../../db/pool'
import { MaintenanceRecommendation, AssetHealthScore, TwinEntityType } from './twinTypes'

// ─── Asset health scoring ─────────────────────────────────────────────────────

export async function computeAssetHealth(
  twinId: string,
  tenantId: string
): Promise<AssetHealthScore> {
  // Fetch twin + entity data
  const twinRes = await tenantQuery(
    tenantId,
    `SELECT entity_id, entity_type, health_score FROM operational_twins
     WHERE id = $1 AND tenant_id = $2`,
    [twinId, tenantId]
  )
  if (twinRes.rows.length === 0) throw new Error(`Twin not found: ${twinId}`)

  const entityId = twinRes.rows[0].entity_id as string
  const entityType = twinRes.rows[0].entity_type as TwinEntityType

  const [inspectionScore, deficiencyScore, incidentScore] = await Promise.all([
    _computeInspectionScore(tenantId, entityId, entityType),
    _computeDeficiencyScore(tenantId, entityId, entityType),
    _computeIncidentScore(tenantId, entityId),
  ])

  const ageScore = 80 // static baseline — would derive from asset created_at in real impl
  const utilizationScore = 75 // static baseline

  const overallScore = Math.round(
    inspectionScore * 0.3 +
    deficiencyScore * 0.25 +
    incidentScore * 0.2 +
    ageScore * 0.15 +
    utilizationScore * 0.1
  )

  const trend = _deriveTrend(overallScore, Number(twinRes.rows[0].health_score ?? overallScore))

  return {
    twinId,
    overallScore,
    components: { inspectionScore, deficiencyScore, incidentScore, ageScore, utilizationScore },
    trend,
    lastAssessedAt: new Date(),
  }
}

// ─── Maintenance recommendations ─────────────────────────────────────────────

export async function generateMaintenanceRecommendations(
  tenantId: string,
  entityType: TwinEntityType = 'equipment'
): Promise<MaintenanceRecommendation[]> {
  const twinsRes = await tenantQuery(
    tenantId,
    `SELECT id, entity_id, entity_type, health_score, risk_score
     FROM operational_twins
     WHERE tenant_id = $1 AND entity_type = $2 AND status = 'active'
     ORDER BY risk_score DESC NULLS LAST, health_score ASC NULLS LAST
     LIMIT 50`,
    [tenantId, entityType]
  )

  const recommendations: MaintenanceRecommendation[] = []
  for (const row of twinsRes.rows) {
    const rec = _buildRecommendation(row)
    if (rec) recommendations.push(rec)
  }
  return recommendations
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _computeInspectionScore(
  tenantId: string,
  entityId: string,
  entityType: TwinEntityType
): Promise<number> {
  const res = await tenantQuery(
    tenantId,
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'completed') as completed,
       MAX(completed_date) as last_completed
     FROM inspections
     WHERE tenant_id = $1 AND ${entityType}_id = $2`,
    [tenantId, entityId]
  ).catch(() => ({ rows: [{ total: '0', completed: '0', last_completed: null }] as Record<string, unknown>[] }))

  const total = Number(res.rows[0]?.total ?? 0)
  if (total === 0) return 70 // No inspection history → neutral score

  const completed = Number(res.rows[0]?.completed ?? 0)
  const completionRate = completed / total
  const lastCompleted = res.rows[0]?.last_completed
  const daysSinceLast = lastCompleted
    ? (Date.now() - new Date(lastCompleted as string).getTime()) / (24 * 60 * 60 * 1000)
    : 365

  const recencyPenalty = Math.min(30, daysSinceLast / 12) // up to -30 for >1yr gap
  return Math.max(0, Math.round(completionRate * 100 - recencyPenalty))
}

async function _computeDeficiencyScore(
  tenantId: string,
  entityId: string,
  entityType: TwinEntityType
): Promise<number> {
  const res = await tenantQuery(
    tenantId,
    `SELECT
       COUNT(*) FILTER (WHERE status = 'open' AND severity = 'critical') as critical_open,
       COUNT(*) FILTER (WHERE status = 'open' AND severity = 'high') as high_open,
       COUNT(*) FILTER (WHERE status = 'open') as total_open
     FROM deficiencies
     WHERE tenant_id = $1 AND ${entityType}_id = $2`,
    [tenantId, entityId]
  ).catch(() => ({
    rows: [{ critical_open: '0', high_open: '0', total_open: '0' }] as Record<string, unknown>[],
  }))

  const critical = Number(res.rows[0]?.critical_open ?? 0)
  const high = Number(res.rows[0]?.high_open ?? 0)
  const total = Number(res.rows[0]?.total_open ?? 0)

  const deductions = critical * 20 + high * 10 + (total - critical - high) * 3
  return Math.max(0, 100 - deductions)
}

async function _computeIncidentScore(tenantId: string, entityId: string): Promise<number> {
  // Proxy via realtime events
  const res = await tenantQuery(
    tenantId,
    `SELECT COUNT(*) as cnt FROM realtime_event_log
     WHERE tenant_id = $1 AND entity_id = $2
       AND event_type IN ('equipment_failure','maintenance_required','sla_breached')
       AND created_at >= now() - interval '90 days'`,
    [tenantId, entityId]
  ).catch(() => ({ rows: [{ cnt: '0' }] as Record<string, unknown>[] }))

  const incidents = Number(res.rows[0]?.cnt ?? 0)
  return Math.max(0, 100 - incidents * 15)
}

function _buildRecommendation(row: Record<string, unknown>): MaintenanceRecommendation | null {
  const riskScore = Number(row.risk_score ?? 0)
  const healthScore = Number(row.health_score ?? 80)

  if (riskScore < 30 && healthScore >= 70) return null // healthy, skip

  const predictedFailureRisk = Math.min(100, riskScore * 0.6 + (100 - healthScore) * 0.4)
  const priority: MaintenanceRecommendation['priority'] =
    predictedFailureRisk >= 80 ? 'immediate' :
    predictedFailureRisk >= 60 ? 'high' :
    predictedFailureRisk >= 40 ? 'medium' : 'low'

  const now = new Date()
  const windowStart = priority === 'immediate' ? now : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const windowEnd = new Date(windowStart.getTime() + 7 * 24 * 60 * 60 * 1000)

  return {
    twinId: row.id as string,
    entityType: row.entity_type as TwinEntityType,
    entityId: row.entity_id as string,
    priority,
    predictedFailureRisk: Math.round(predictedFailureRisk),
    recommendedWindowStart: windowStart,
    recommendedWindowEnd: windowEnd,
    maintenanceType: healthScore < 50 ? 'corrective' : 'preventive',
    rationale: `Risk score ${riskScore.toFixed(0)}, health score ${healthScore.toFixed(0)}. ${priority === 'immediate' ? 'Immediate intervention required.' : 'Preventive maintenance recommended.'}`,
    estimatedDuration: predictedFailureRisk >= 60 ? '4-8 hours' : '1-2 hours',
  }
}

function _deriveTrend(
  current: number,
  previous: number
): 'improving' | 'stable' | 'degrading' {
  const delta = current - previous
  if (delta > 5) return 'improving'
  if (delta < -5) return 'degrading'
  return 'stable'
}

export const __testHooks = { computeAssetHealth, _buildRecommendation }
