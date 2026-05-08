// Denver Engineering — Predictive Coordination Engine (v6.0.0)
// Cross-project conflict detection, bottleneck forecasting, and coordination recommendations.

import { tenantQuery } from '../../db/pool'
import { PortfolioReadiness, PortfolioConflict, AnomalySeverity } from './twinTypes'

// ─── Portfolio readiness ──────────────────────────────────────────────────────

export async function computePortfolioReadiness(tenantId: string): Promise<PortfolioReadiness> {
  const res = await tenantQuery(
    tenantId,
    `SELECT entity_id, readiness_score, risk_score
     FROM operational_twins
     WHERE tenant_id = $1 AND entity_type = 'project' AND status = 'active'`,
    [tenantId]
  )

  const projects = res.rows.map(r => ({
    entityId: r.entity_id as string,
    readiness: Number(r.readiness_score ?? 50),
    risk: Number(r.risk_score ?? 0),
  }))

  const readinessByProject: Record<string, number> = {}
  for (const p of projects) readinessByProject[p.entityId] = p.readiness

  const averageReadiness = projects.length > 0
    ? projects.reduce((s, p) => s + p.readiness, 0) / projects.length
    : 0

  const atRiskProjects = projects
    .filter(p => p.readiness < 60 || p.risk > 70)
    .map(p => p.entityId)

  const topRisks = await _identifyTopRisks(tenantId)

  return {
    tenantId,
    projectCount: projects.length,
    averageReadiness: Math.round(averageReadiness * 10) / 10,
    readinessByProject,
    atRiskProjects,
    topRisks,
    computedAt: new Date(),
  }
}

// ─── Portfolio conflicts ──────────────────────────────────────────────────────

export async function detectPortfolioConflicts(tenantId: string): Promise<PortfolioConflict[]> {
  const conflicts: PortfolioConflict[] = []

  // Shared resource conflicts
  const resourceConflicts = await _detectSharedResourceConflicts(tenantId)
  conflicts.push(...resourceConflicts)

  // Timeline overlaps (projects with conflicting peak periods)
  const timelineConflicts = await _detectTimelineConflicts(tenantId)
  conflicts.push(...timelineConflicts)

  // Dependency bottlenecks
  const bottlenecks = await _detectBottlenecks(tenantId)
  conflicts.push(...bottlenecks)

  return conflicts.sort((a, b) => _severityOrder(b.severity) - _severityOrder(a.severity))
}

// ─── Bottleneck forecast ──────────────────────────────────────────────────────

export async function forecastBottlenecks(
  tenantId: string,
  horizonDays = 30
): Promise<Array<{
  entityType: string
  entityId: string
  bottleneckType: string
  severity: AnomalySeverity
  projectedAt: Date
  description: string
}>> {
  // Actions clustering near due dates
  const res = await tenantQuery(
    tenantId,
    `SELECT
       project_id,
       DATE_TRUNC('week', due_date) as week,
       COUNT(*) as cnt,
       COUNT(*) FILTER (WHERE status = 'blocked') as blocked
     FROM actions
     WHERE tenant_id = $1
       AND due_date BETWEEN now() AND now() + ($2 || ' days')::interval
     GROUP BY project_id, week
     HAVING COUNT(*) >= 10
     ORDER BY cnt DESC
     LIMIT 20`,
    [tenantId, horizonDays.toString()]
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }))

  return res.rows.map(row => {
    const count = Number(row.cnt)
    const blocked = Number(row.blocked)
    const severity: AnomalySeverity = count >= 30 ? 'critical' : count >= 20 ? 'high' : 'medium'
    return {
      entityType: 'project',
      entityId: row.project_id as string,
      bottleneckType: blocked > 0 ? 'blocked_actions_cluster' : 'action_overload',
      severity,
      projectedAt: new Date(row.week as string),
      description: `${count} actions due in week, ${blocked} blocked`,
    }
  })
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _identifyTopRisks(tenantId: string): Promise<string[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT entity_id FROM operational_twins
     WHERE tenant_id = $1 AND entity_type = 'project' AND risk_score >= 70
     ORDER BY risk_score DESC LIMIT 5`,
    [tenantId]
  )
  return res.rows.map(r => r.entity_id as string)
}

async function _detectSharedResourceConflicts(tenantId: string): Promise<PortfolioConflict[]> {
  // Look for assignees overloaded across projects
  const res = await tenantQuery(
    tenantId,
    `SELECT
       assignee_id,
       array_agg(DISTINCT project_id) as project_ids,
       COUNT(*) as open_count
     FROM actions
     WHERE tenant_id = $1
       AND status NOT IN ('done','cancelled')
       AND due_date <= now() + interval '14 days'
       AND assignee_id IS NOT NULL
     GROUP BY assignee_id
     HAVING COUNT(*) >= 5 AND COUNT(DISTINCT project_id) >= 2
     LIMIT 10`,
    [tenantId]
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }))

  return res.rows.map(row => ({
    conflictType: 'shared_resource_overload',
    severity: Number(row.open_count) >= 15 ? 'high' as AnomalySeverity : 'medium' as AnomalySeverity,
    involvedProjectIds: row.project_ids as string[],
    description: `Assignee has ${row.open_count} open actions across ${(row.project_ids as string[]).length} projects due within 14 days`,
    suggestedResolution: 'Rebalance workload or extend timelines for lower-priority actions',
  }))
}

async function _detectTimelineConflicts(tenantId: string): Promise<PortfolioConflict[]> {
  // Projects with peak action weeks overlapping
  const res = await tenantQuery(
    tenantId,
    `SELECT
       DATE_TRUNC('week', due_date) as peak_week,
       array_agg(DISTINCT project_id) as project_ids,
       COUNT(DISTINCT project_id) as project_count,
       COUNT(*) as total_actions
     FROM actions
     WHERE tenant_id = $1
       AND status NOT IN ('done','cancelled')
       AND due_date BETWEEN now() AND now() + interval '30 days'
     GROUP BY peak_week
     HAVING COUNT(DISTINCT project_id) >= 3 AND COUNT(*) >= 20
     ORDER BY peak_week ASC
     LIMIT 5`,
    [tenantId]
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }))

  return res.rows.map(row => ({
    conflictType: 'timeline_overlap',
    severity: Number(row.project_count) >= 5 ? 'high' as AnomalySeverity : 'medium' as AnomalySeverity,
    involvedProjectIds: row.project_ids as string[],
    description: `${row.project_count} projects have ${row.total_actions} actions due in same week (${row.peak_week})`,
    suggestedResolution: 'Stagger deadlines or allocate additional resources for that week',
  }))
}

async function _detectBottlenecks(tenantId: string): Promise<PortfolioConflict[]> {
  // Blocked actions that are blocking others
  const res = await tenantQuery(
    tenantId,
    `SELECT project_id, COUNT(*) as blocked_count
     FROM actions
     WHERE tenant_id = $1 AND status = 'blocked'
       AND due_date <= now() + interval '7 days'
     GROUP BY project_id
     HAVING COUNT(*) >= 3`,
    [tenantId]
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }))

  return res.rows.map(row => ({
    conflictType: 'dependency_bottleneck',
    severity: Number(row.blocked_count) >= 10 ? 'critical' as AnomalySeverity : 'high' as AnomalySeverity,
    involvedProjectIds: [row.project_id as string],
    description: `${row.blocked_count} actions blocked and due within 7 days`,
    suggestedResolution: 'Escalate blockers immediately; consider dependency re-routing',
  }))
}

function _severityOrder(severity: AnomalySeverity): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[severity]
}

export const __testHooks = { computePortfolioReadiness, detectPortfolioConflicts }
