/**
 * Denver Engineering — Readiness Engine (v4.35.0)
 * ─────────────────────────────────────────────────
 * Ava Phase 3 — Computes operational readiness scores for projects,
 * systems, subsystems, and other domain entities.
 *
 * Scoring is deterministic, weighted, and explainable.
 * All scores 0–100. State thresholds are configurable per tenant.
 */
import pool from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReadinessDomain =
  | 'project' | 'system' | 'subsystem' | 'commissioning'
  | 'safety' | 'compliance' | 'turnover'

export type ReadinessState = 'not_ready' | 'at_risk' | 'conditionally_ready' | 'ready'

export interface ComponentScores {
  open_actions:  number   // 0-100 (100 = no open actions)
  blockers:      number   // 0-100 (100 = no blockers)
  sla_health:    number   // 0-100 (100 = no SLA breaches or risks)
  inspections:   number   // 0-100 (100 = all inspections passing)
  escalations:   number   // 0-100 (100 = no escalations)
}

export interface BlockingFactor {
  type:        string
  count:       number
  severity:    'low' | 'medium' | 'high' | 'critical'
  description: string
}

export interface ReadinessResult {
  readiness_score:            number
  readiness_state:            ReadinessState
  blocking_factors:           BlockingFactor[]
  predicted_completion_risk:  number | null
  component_scores:           ComponentScores
}

export interface ReadinessThresholds {
  not_ready_below:             number  // default 40
  at_risk_below:               number  // default 65
  conditionally_ready_below:   number  // default 85
  weight_open_actions:         number  // default 0.30
  weight_blockers:             number  // default 0.25
  weight_sla_health:           number  // default 0.20
  weight_inspections:          number  // default 0.15
  weight_escalations:          number  // default 0.10
}

const DEFAULT_THRESHOLDS: ReadinessThresholds = {
  not_ready_below:           40,
  at_risk_below:             65,
  conditionally_ready_below: 85,
  weight_open_actions:       0.30,
  weight_blockers:           0.25,
  weight_sla_health:         0.20,
  weight_inspections:        0.15,
  weight_escalations:        0.10,
}

// ─── Threshold resolution ─────────────────────────────────────────────────────

export async function getThresholds(
  tenantId: string,
  domain:   ReadinessDomain,
): Promise<ReadinessThresholds> {
  try {
    const res = await pool.query(
      `SELECT * FROM readiness_thresholds WHERE tenant_id = $1 AND domain = $2`,
      [tenantId, domain],
    )
    if (res.rows[0]) {
      const r = res.rows[0]
      return {
        not_ready_below:           Number(r.not_ready_below),
        at_risk_below:             Number(r.at_risk_below),
        conditionally_ready_below: Number(r.conditionally_ready_below),
        weight_open_actions:       Number(r.weight_open_actions),
        weight_blockers:           Number(r.weight_blockers),
        weight_sla_health:         Number(r.weight_sla_health),
        weight_inspections:        Number(r.weight_inspections),
        weight_escalations:        Number(r.weight_escalations),
      }
    }
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_THRESHOLDS }
}

// ─── State resolution ─────────────────────────────────────────────────────────

export function resolveState(score: number, t: ReadinessThresholds): ReadinessState {
  if (score < t.not_ready_below)           return 'not_ready'
  if (score < t.at_risk_below)             return 'at_risk'
  if (score < t.conditionally_ready_below) return 'conditionally_ready'
  return 'ready'
}

// ─── Component scorers ────────────────────────────────────────────────────────

/** Score open actions: fewer open → higher score */
export function scoreOpenActions(openCount: number, totalCount: number): number {
  if (totalCount === 0) return 100
  const ratio = openCount / totalCount
  if (ratio === 0) return 100
  if (ratio <= 0.05) return 90
  if (ratio <= 0.15) return 75
  if (ratio <= 0.30) return 55
  if (ratio <= 0.50) return 35
  return 10
}

/** Score blockers: any blocker drastically reduces score */
export function scoreBlockers(blockerCount: number): number {
  if (blockerCount === 0) return 100
  if (blockerCount === 1) return 60
  if (blockerCount === 2) return 40
  if (blockerCount <= 5) return 20
  return 5
}

/** Score SLA health based on breach count and at-risk count */
export function scoreSlaHealth(breachCount: number, atRiskCount: number, totalOpen: number): number {
  if (totalOpen === 0) return 100
  const penaltyBreach  = Math.min(breachCount  * 15, 60)
  const penaltyAtRisk  = Math.min(atRiskCount  *  5, 25)
  return Math.max(0, 100 - penaltyBreach - penaltyAtRisk)
}

/** Score inspections: failed/pending → lower */
export function scoreInspections(failCount: number, totalCount: number): number {
  if (totalCount === 0) return 100  // no inspections yet = no penalty
  const passRate = (totalCount - failCount) / totalCount
  return Math.round(passRate * 100)
}

/** Score escalations: escalated actions → risk */
export function scoreEscalations(escalatedCount: number, totalOpen: number): number {
  if (totalOpen === 0) return 100
  const ratio = escalatedCount / totalOpen
  if (ratio === 0) return 100
  if (ratio <= 0.05) return 85
  if (ratio <= 0.15) return 65
  if (ratio <= 0.30) return 40
  return 15
}

// ─── Weighted aggregate ───────────────────────────────────────────────────────

export function computeWeightedScore(
  components: ComponentScores,
  weights: Pick<ReadinessThresholds,
    'weight_open_actions' | 'weight_blockers' | 'weight_sla_health' |
    'weight_inspections'  | 'weight_escalations'>,
): number {
  const raw =
    components.open_actions * weights.weight_open_actions +
    components.blockers     * weights.weight_blockers     +
    components.sla_health   * weights.weight_sla_health   +
    components.inspections  * weights.weight_inspections  +
    components.escalations  * weights.weight_escalations
  return Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10
}

// ─── Blocking factor builder ──────────────────────────────────────────────────

export function buildBlockingFactors(params: {
  blockerCount:     number
  overdueCount:     number
  escalatedCount:   number
  failedInspections: number
}): BlockingFactor[] {
  const factors: BlockingFactor[] = []

  if (params.blockerCount > 0) {
    factors.push({
      type:        'dependency_blockers',
      count:       params.blockerCount,
      severity:    params.blockerCount >= 3 ? 'critical' : 'high',
      description: `${params.blockerCount} unresolved dependency blocker${params.blockerCount > 1 ? 's' : ''}`,
    })
  }
  if (params.overdueCount > 0) {
    factors.push({
      type:        'overdue_actions',
      count:       params.overdueCount,
      severity:    params.overdueCount >= 5 ? 'critical' : params.overdueCount >= 2 ? 'high' : 'medium',
      description: `${params.overdueCount} overdue action${params.overdueCount > 1 ? 's' : ''}`,
    })
  }
  if (params.escalatedCount > 0) {
    factors.push({
      type:        'escalated_actions',
      count:       params.escalatedCount,
      severity:    'high',
      description: `${params.escalatedCount} escalated action${params.escalatedCount > 1 ? 's' : ''}`,
    })
  }
  if (params.failedInspections > 0) {
    factors.push({
      type:        'failed_inspections',
      count:       params.failedInspections,
      severity:    'high',
      description: `${params.failedInspections} failed inspection${params.failedInspections > 1 ? 's' : ''}`,
    })
  }

  return factors.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 }
    return order[a.severity] - order[b.severity]
  })
}

// ─── Main compute function ────────────────────────────────────────────────────

export async function computeReadiness(
  tenantId:   string,
  domain:     ReadinessDomain,
  entityId:   string,
): Promise<ReadinessResult> {
  const thresholds = await getThresholds(tenantId, domain)

  // Fetch metrics from actions and related tables
  const metrics = await _fetchEntityMetrics(tenantId, entityId)

  const components: ComponentScores = {
    open_actions: scoreOpenActions(metrics.openCount,       metrics.totalCount),
    blockers:     scoreBlockers(metrics.blockerCount),
    sla_health:   scoreSlaHealth(metrics.breachCount,      metrics.atRiskCount, metrics.openCount),
    inspections:  scoreInspections(metrics.failedInspections, metrics.totalInspections),
    escalations:  scoreEscalations(metrics.escalatedCount,  metrics.openCount),
  }

  const readiness_score = computeWeightedScore(components, thresholds)
  const readiness_state = resolveState(readiness_score, thresholds)
  const blocking_factors = buildBlockingFactors({
    blockerCount:     metrics.blockerCount,
    overdueCount:     metrics.overdueCount,
    escalatedCount:   metrics.escalatedCount,
    failedInspections: metrics.failedInspections,
  })

  // Completion risk: simple linear model based on blockers + overdue ratio
  const predicted_completion_risk = metrics.totalCount > 0
    ? Math.min(100, Math.round(
        (metrics.blockerCount * 20 + metrics.overdueCount * 10) / metrics.totalCount * 10
      ))
    : null

  return {
    readiness_score,
    readiness_state,
    blocking_factors,
    predicted_completion_risk,
    component_scores: components,
  }
}

// ─── Metrics fetcher ─────────────────────────────────────────────────────────

interface EntityMetrics {
  totalCount:        number
  openCount:         number
  overdueCount:      number
  blockerCount:      number
  breachCount:       number
  atRiskCount:       number
  escalatedCount:    number
  totalInspections:  number
  failedInspections: number
}

async function _fetchEntityMetrics(tenantId: string, entityId: string): Promise<EntityMetrics> {
  try {
    const [actionsRes, inspRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)                                                            AS total_count,
          COUNT(*) FILTER (WHERE status NOT IN ('completed','cancelled'))    AS open_count,
          COUNT(*) FILTER (WHERE due_at < NOW()
                             AND status NOT IN ('completed','cancelled'))    AS overdue_count,
          COUNT(*) FILTER (WHERE (max_escalation_level ?? 0) >= 1
                             AND status NOT IN ('completed','cancelled'))    AS escalated_count,
          COALESCE(SUM(
            (SELECT COUNT(*) FROM action_relations ar
             WHERE ar.target_action_id = a.id
               AND ar.relation_type IN ('blocks','caused_by','spawned_from')
               AND ar.deleted_at IS NULL
               AND ar.tenant_id = a.tenant_id)
          ), 0) AS blocker_count,
          COUNT(*) FILTER (WHERE s.sla_status = 'breached')                 AS breach_count,
          COUNT(*) FILTER (WHERE s.remaining_minutes IS NOT NULL
                             AND s.remaining_minutes < 120
                             AND s.sla_status = 'active')                   AS at_risk_count
        FROM actions a
        LEFT JOIN action_sla_state s ON s.action_id = a.id AND s.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1 AND a.project_id = $2
      `, [tenantId, entityId]),
      pool.query(`
        SELECT
          COUNT(*) AS total_count,
          COUNT(*) FILTER (WHERE status = 'failed') AS failed_count
        FROM inspections
        WHERE tenant_id = $1 AND project_id = $2
      `, [tenantId, entityId]),
    ])

    const a = actionsRes.rows[0]
    const i = inspRes.rows[0]

    return {
      totalCount:        Number(a.total_count)   || 0,
      openCount:         Number(a.open_count)    || 0,
      overdueCount:      Number(a.overdue_count) || 0,
      blockerCount:      Number(a.blocker_count) || 0,
      breachCount:       Number(a.breach_count)  || 0,
      atRiskCount:       Number(a.at_risk_count) || 0,
      escalatedCount:    Number(a.escalated_count) || 0,
      totalInspections:  Number(i.total_count)   || 0,
      failedInspections: Number(i.failed_count)  || 0,
    }
  } catch {
    return {
      totalCount: 0, openCount: 0, overdueCount: 0, blockerCount: 0,
      breachCount: 0, atRiskCount: 0, escalatedCount: 0,
      totalInspections: 0, failedInspections: 0,
    }
  }
}

// ─── Persist result ───────────────────────────────────────────────────────────

export async function persistReadinessScore(
  tenantId:   string,
  domain:     ReadinessDomain,
  entityId:   string,
  entityType: string,
  result:     ReadinessResult,
): Promise<void> {
  await pool.query(`
    INSERT INTO readiness_scores
      (tenant_id, domain, entity_id, entity_type, readiness_score,
       readiness_state, blocking_factors, predicted_completion_risk, component_scores)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (tenant_id, domain, entity_id)
    DO UPDATE SET
      readiness_score            = EXCLUDED.readiness_score,
      readiness_state            = EXCLUDED.readiness_state,
      blocking_factors           = EXCLUDED.blocking_factors,
      predicted_completion_risk  = EXCLUDED.predicted_completion_risk,
      component_scores           = EXCLUDED.component_scores,
      computed_at                = NOW(),
      updated_at                 = NOW()
  `, [
    tenantId, domain, entityId, entityType,
    result.readiness_score,
    result.readiness_state,
    JSON.stringify(result.blocking_factors),
    result.predicted_completion_risk,
    JSON.stringify(result.component_scores),
  ])
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  scoreOpenActions,
  scoreBlockers,
  scoreSlaHealth,
  scoreInspections,
  scoreEscalations,
  computeWeightedScore,
  resolveState,
  buildBlockingFactors,
  DEFAULT_THRESHOLDS,
}
