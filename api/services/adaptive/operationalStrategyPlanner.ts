// Denver Engineering — Operational Strategy Planner (v7.0.0)
// Generates multi-horizon strategy plans from portfolio state and forecasts.

import { tenantQuery } from '../../db/pool'
import { StrategyPlan, StrategyAction } from './adaptiveTypes'
import { randomUUID } from 'crypto'

// ─── Generate strategy plan ───────────────────────────────────────────────────

export async function generateStrategyPlan(
  tenantId: string,
  opts: {
    horizon?: number       // days; default 30
    objectives?: string[]
  } = {},
): Promise<StrategyPlan> {
  const { horizon = 30, objectives = _defaultObjectives(horizon) } = opts

  const [portfolioState, anomalies, bottlenecks] = await Promise.all([
    _getPortfolioState(tenantId),
    _getOpenAnomalies(tenantId),
    _getBottlenecks(tenantId),
  ])

  const actions = _buildActions(portfolioState, anomalies, bottlenecks, horizon)
  const riskMitigations = _buildRiskMitigations(anomalies, portfolioState)
  const contingencies = _buildContingencies(portfolioState)

  const degradedCount = portfolioState.filter(p => p.status === 'degraded').length
  const estimatedGain = Math.min(25, degradedCount * 3 + Math.min(10, bottlenecks.length * 2))

  return {
    planId: randomUUID(),
    tenantId,
    horizon,
    objectives,
    actions: actions.sort((a, b) => a.priority - b.priority),
    riskMitigations,
    contingencies,
    estimatedReadinessGain: estimatedGain,
    generatedAt: new Date(),
  }
}

// ─── Data gathering ───────────────────────────────────────────────────────────

interface PortfolioItem {
  entityId: string
  name: string
  status: string
  readinessScore: number
  riskScore: number
}

async function _getPortfolioState(tenantId: string): Promise<PortfolioItem[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT entity_id, name, status, readiness_score, risk_score
     FROM operational_twins
     WHERE tenant_id = $1 AND entity_type = 'project'
     ORDER BY readiness_score ASC
     LIMIT 50`,
    [tenantId],
  )
  return res.rows.map(row => ({
    entityId: row.entity_id as string,
    name: row.name as string,
    status: row.status as string,
    readinessScore: Number(row.readiness_score ?? 50),
    riskScore: Number(row.risk_score ?? 50),
  }))
}

interface OpenAnomaly {
  id: string
  twinId: string
  severity: string
  anomalyType: string
}

async function _getOpenAnomalies(tenantId: string): Promise<OpenAnomaly[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT id, twin_id, severity, anomaly_type
     FROM operational_anomalies
     WHERE tenant_id = $1 AND resolved_at IS NULL
     ORDER BY CASE severity
       WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
     LIMIT 20`,
    [tenantId],
  )
  return res.rows.map(row => ({
    id: row.id as string,
    twinId: row.twin_id as string,
    severity: row.severity as string,
    anomalyType: row.anomaly_type as string,
  }))
}

async function _getBottlenecks(tenantId: string): Promise<string[]> {
  try {
    const res = await tenantQuery(
      tenantId,
      `SELECT DISTINCT entity_id
       FROM optimization_feedback
       WHERE tenant_id = $1
         AND status = 'proposed'
         AND optimization_type IN ('workload', 'resource', 'capacity')
       LIMIT 10`,
      [tenantId],
    )
    return res.rows.map(r => r.entity_id as string)
  } catch {
    return []
  }
}

// ─── Action generation ────────────────────────────────────────────────────────

function _buildActions(
  portfolio: PortfolioItem[],
  anomalies: OpenAnomaly[],
  bottlenecks: string[],
  horizon: number,
): StrategyAction[] {
  const actions: StrategyAction[] = []
  let priority = 1

  // 1. Resolve critical anomalies first
  const critical = anomalies.filter(a => a.severity === 'critical')
  if (critical.length > 0) {
    actions.push({
      priority: priority++,
      action: `Resolve ${critical.length} critical anomaly/anomalies`,
      rationale: 'Critical anomalies block all downstream readiness improvements',
      requiresApproval: false,
    })
  }

  // 2. Stabilize degraded projects
  const degraded = portfolio.filter(p => p.status === 'degraded').slice(0, 5)
  for (const p of degraded) {
    actions.push({
      priority: priority++,
      action: `Stabilize project "${p.name}" (readiness: ${p.readinessScore})`,
      entityId: p.entityId,
      entityType: 'project',
      targetScore: 60,
      rationale: `Degraded status with readiness ${p.readinessScore} — below operational threshold`,
      requiresApproval: true,
    })
  }

  // 3. Lift lowest-readiness active projects
  const lowReadiness = portfolio
    .filter(p => p.status === 'active' && p.readinessScore < 50)
    .slice(0, 3)
  for (const p of lowReadiness) {
    const deadline = new Date(Date.now() + horizon * 0.5 * 24 * 60 * 60 * 1000)
    actions.push({
      priority: priority++,
      action: `Improve readiness of "${p.name}" from ${p.readinessScore} to 65`,
      entityId: p.entityId,
      entityType: 'project',
      targetScore: 65,
      deadline,
      rationale: `Low readiness (${p.readinessScore}) on active project increases risk exposure`,
      requiresApproval: false,
    })
  }

  // 4. Address bottlenecks
  if (bottlenecks.length > 0) {
    actions.push({
      priority: priority++,
      action: `Review and apply ${bottlenecks.length} pending resource optimization proposal(s)`,
      rationale: 'Unresolved resource bottlenecks constrain portfolio throughput',
      requiresApproval: true,
    })
  }

  // 5. High-risk monitoring
  const highRisk = portfolio.filter(p => p.riskScore >= 70).slice(0, 3)
  for (const p of highRisk) {
    actions.push({
      priority: priority++,
      action: `Increase monitoring cadence for "${p.name}" (risk: ${p.riskScore})`,
      entityId: p.entityId,
      entityType: 'project',
      rationale: `Risk score ${p.riskScore} exceeds threshold — daily sync recommended`,
      requiresApproval: false,
    })
  }

  return actions
}

function _buildRiskMitigations(
  anomalies: OpenAnomaly[],
  portfolio: PortfolioItem[],
): string[] {
  const mitigations: string[] = []
  const highAnomaly = anomalies.filter(a => ['critical', 'high'].includes(a.severity))
  if (highAnomaly.length > 0) {
    mitigations.push(`Escalate ${highAnomaly.length} high/critical anomaly resolution to ops team`)
  }
  const avgRisk = portfolio.length > 0
    ? portfolio.reduce((s, p) => s + p.riskScore, 0) / portfolio.length
    : 0
  if (avgRisk > 60) {
    mitigations.push(`Portfolio average risk (${avgRisk.toFixed(0)}) elevated — schedule risk review meeting`)
  }
  mitigations.push('Maintain daily twin sync health checks')
  return mitigations
}

function _buildContingencies(portfolio: PortfolioItem[]): string[] {
  const contingencies: string[] = []
  const failed = portfolio.filter(p => p.status === 'failed')
  if (failed.length > 0) {
    contingencies.push(`If ${failed.length} failed project(s) remain unresolved: escalate to senior operations`)
  }
  contingencies.push('If portfolio readiness drops below 40: pause non-critical scheduled work')
  contingencies.push('If critical anomaly count exceeds 5: trigger emergency response protocol')
  return contingencies
}

function _defaultObjectives(horizon: number): string[] {
  return [
    `Achieve ≥65% portfolio readiness within ${horizon} days`,
    'Resolve all critical anomalies',
    'Reduce high-risk project count by 30%',
    'Maintain zero SLA breaches',
  ]
}

export const __testHooks = { _buildActions, _buildRiskMitigations, _buildContingencies }
