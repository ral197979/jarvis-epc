// Denver Engineering — Operational Forecast Engine (v6.0.0)
// Readiness, SLA, and workload forecasting with cache management.

import { tenantQuery } from '../../db/pool'
import { OperationalForecast, ForecastInput } from './twinTypes'
import { projectTwinTimeline } from './timelineProjectionService'

// ─── Get or compute forecast ──────────────────────────────────────────────────

export async function getOrComputeForecast(input: ForecastInput): Promise<OperationalForecast> {
  const { tenantId, forecastType, scopeType, scopeId, horizonDays = 30 } = input

  // Check cache first
  const cached = await tenantQuery(
    tenantId,
    `SELECT * FROM operational_forecasts
     WHERE tenant_id=$1 AND forecast_type=$2 AND scope_type=$3 AND scope_id=$4
       AND horizon_days=$5 AND valid_until > now()`,
    [tenantId, forecastType, scopeType, scopeId, horizonDays]
  )
  if (cached.rows.length > 0) return _mapForecast(cached.rows[0])

  // Compute
  const { projections, confidence } = await _computeForecast(
    tenantId, forecastType, scopeType, scopeId, horizonDays
  )

  // Upsert cache
  const res = await tenantQuery(
    tenantId,
    `INSERT INTO operational_forecasts
       (tenant_id, forecast_type, scope_type, scope_id, horizon_days, projections, confidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, forecast_type, scope_type, scope_id, horizon_days)
     DO UPDATE SET
       projections = EXCLUDED.projections,
       confidence = EXCLUDED.confidence,
       computed_at = now(),
       valid_until = now() + interval '1 hour'
     RETURNING *`,
    [tenantId, forecastType, scopeType, scopeId, horizonDays, JSON.stringify(projections), confidence]
  )
  return _mapForecast(res.rows[0])
}

// ─── Compute forecast by type ─────────────────────────────────────────────────

async function _computeForecast(
  tenantId: string,
  forecastType: string,
  scopeType: string,
  scopeId: string,
  horizonDays: number
): Promise<{ projections: Record<string, unknown>; confidence: number }> {
  switch (forecastType) {
    case 'readiness': return _forecastReadiness(tenantId, scopeType, scopeId, horizonDays)
    case 'sla': return _forecastSla(tenantId, scopeType, scopeId, horizonDays)
    case 'workload': return _forecastWorkload(tenantId, scopeType, scopeId, horizonDays)
    case 'portfolio': return _forecastPortfolio(tenantId, horizonDays)
    default: return { projections: {}, confidence: 0 }
  }
}

async function _forecastReadiness(
  tenantId: string,
  scopeType: string,
  scopeId: string,
  horizonDays: number
): Promise<{ projections: Record<string, unknown>; confidence: number }> {
  // Find twin for this entity
  const twinRes = await tenantQuery(
    tenantId,
    'SELECT id FROM operational_twins WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3',
    [tenantId, scopeType, scopeId]
  )

  if (twinRes.rows.length === 0) {
    return {
      projections: { timeline: [], finalReadiness: 50, trend: 'unknown' },
      confidence: 0,
    }
  }

  const twinId = twinRes.rows[0].id as string
  const projection = await projectTwinTimeline(twinId, tenantId, horizonDays)

  return {
    projections: {
      timeline: projection.projectedReadiness,
      finalReadiness: projection.projectedReadiness[projection.projectedReadiness.length - 1]?.value ?? 50,
      slaBreachProbability: projection.projectedSlaBreachProbability,
      explanation: projection.explanation,
    },
    confidence: projection.confidence,
  }
}

async function _forecastSla(
  tenantId: string,
  scopeType: string,
  scopeId: string,
  horizonDays: number
): Promise<{ projections: Record<string, unknown>; confidence: number }> {
  // Count upcoming SLA-sensitive actions
  const res = await tenantQuery(
    tenantId,
    `SELECT
       COUNT(*) FILTER (WHERE due_date <= now() + ($3 || ' days')::interval) as upcoming,
       COUNT(*) FILTER (WHERE due_date < now() AND status NOT IN ('done','cancelled')) as already_late
     FROM actions
     WHERE project_id = $2 AND tenant_id = $1`,
    [tenantId, scopeId, horizonDays.toString()]
  ).catch(() => ({ rows: [{ upcoming: '0', already_late: '0' }] as Record<string, unknown>[] }))

  const upcoming = Number(res.rows[0]?.upcoming ?? 0)
  const alreadyLate = Number(res.rows[0]?.already_late ?? 0)
  const breachProbability = Math.min(1, (alreadyLate * 0.3 + upcoming * 0.05) / Math.max(1, upcoming))

  return {
    projections: { breachProbability, upcomingActions: upcoming, lateActions: alreadyLate },
    confidence: 0.7,
  }
}

async function _forecastWorkload(
  tenantId: string,
  _scopeType: string,
  scopeId: string,
  horizonDays: number
): Promise<{ projections: Record<string, unknown>; confidence: number }> {
  const res = await tenantQuery(
    tenantId,
    `SELECT DATE_TRUNC('week', due_date) as week, COUNT(*) as cnt
     FROM actions
     WHERE project_id = $2 AND tenant_id = $1
       AND due_date BETWEEN now() AND now() + ($3 || ' days')::interval
     GROUP BY week ORDER BY week ASC`,
    [tenantId, scopeId, horizonDays.toString()]
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }))

  const weeklyDistribution = res.rows.map(r => ({
    week: r.week,
    count: Number(r.cnt),
  }))

  return {
    projections: { weeklyDistribution, peakWeek: weeklyDistribution[0]?.week ?? null },
    confidence: 0.65,
  }
}

async function _forecastPortfolio(
  tenantId: string,
  horizonDays: number
): Promise<{ projections: Record<string, unknown>; confidence: number }> {
  const res = await tenantQuery(
    tenantId,
    `SELECT readiness_score, risk_score, entity_id
     FROM operational_twins
     WHERE tenant_id = $1 AND entity_type = 'project'`,
    [tenantId]
  )

  const projects = res.rows.map(r => ({
    entityId: r.entity_id as string,
    readiness: Number(r.readiness_score ?? 50),
    risk: Number(r.risk_score ?? 0),
  }))

  const avgReadiness = projects.length > 0
    ? projects.reduce((s, p) => s + p.readiness, 0) / projects.length
    : 50

  const atRisk = projects.filter(p => p.readiness < 60 || p.risk > 70).map(p => p.entityId)

  return {
    projections: {
      projectCount: projects.length,
      averageReadiness: Math.round(avgReadiness * 10) / 10,
      atRiskCount: atRisk.length,
      atRiskProjects: atRisk,
      horizonDays,
    },
    confidence: 0.75,
  }
}

// ─── Invalidate cache ─────────────────────────────────────────────────────────

export async function invalidateForecast(
  tenantId: string,
  forecastType: string,
  scopeType: string,
  scopeId: string
): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE operational_forecasts
     SET valid_until = now() - interval '1 second'
     WHERE tenant_id=$1 AND forecast_type=$2 AND scope_type=$3 AND scope_id=$4`,
    [tenantId, forecastType, scopeType, scopeId]
  )
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function _mapForecast(row: Record<string, unknown>): OperationalForecast {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    forecastType: row.forecast_type as string,
    scopeType: row.scope_type as string,
    scopeId: row.scope_id as string,
    horizonDays: Number(row.horizon_days),
    projections: (row.projections ?? {}) as Record<string, unknown>,
    confidence: row.confidence != null ? Number(row.confidence) : undefined,
    computedAt: new Date(row.computed_at as string),
    validUntil: new Date(row.valid_until as string),
  }
}

export const __testHooks = { _mapForecast, _computeForecast: _computeForecast as unknown }
