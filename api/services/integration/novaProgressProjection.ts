/**
 * Denver Engineering — Nova progress projection (ADR-001, v1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only aggregator that assembles the `summary` object of the
 * progress-event contract (docs/integration/nova-denver/contracts/v1/
 * progress-event.schema.json) from Denver's existing rollups:
 * projects.progress_pct/status/current_phase, open deficiencies, overdue
 * action items, and turnover package states.
 *
 * HONESTY RULE (contract README): fields Denver cannot compute honestly for a
 * project are OMITTED, never zero-filled — Nova renders them "not reported".
 * e.g. discipline-split percents (engineering/procurement/construction) have no
 * canonical source today and are never emitted; systems.status is free-text
 * vocabulary so systemsReadyForStartup/systemsAccepted are never emitted.
 *
 * The mapping helpers are PURE so they are unit-tested without a database,
 * mirroring the turnoverService pure+wrapper style.
 */
import { createHash } from 'node:crypto'
import { tenantQuery } from '../../db/pool'

// ─── Types (contract shape) ───────────────────────────────────────────────────

export type OverallStatus =
  | 'planning' | 'engineering' | 'procurement' | 'construction'
  | 'mechanical_completion' | 'pre_commissioning' | 'commissioning'
  | 'performance_testing' | 'turnover' | 'client_acceptance' | 'closed'
  | 'on_hold' | 'cancelled'

export type TurnoverStatus = 'not_started' | 'in_progress' | 'issued' | 'accepted'

export interface ProgressSummary {
  overallStatus: OverallStatus
  overallPercent?: number
  criticalDeficienciesOpen?: number
  deficienciesOpen?: number
  overdueActivities?: number
  turnoverStatus?: TurnoverStatus
}

// ─── Pure mapping helpers ─────────────────────────────────────────────────────

/**
 * Pure: Denver project status + current_phase → contract overallStatus.
 * Mapping table lives in the contract README (both repos agree on it).
 * Project status wins over phase for the terminal/hold states.
 */
export function phaseToOverallStatus(status: string | null, phase: string | null): OverallStatus {
  if (status === 'on_hold')   return 'on_hold'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'completed') return 'closed'
  switch (phase) {
    case 'feasibility':
    case 'feed':            return 'planning'
    case 'detailed_design': return 'engineering'
    case 'procurement':     return 'procurement'
    case 'construction':    return 'construction'
    case 'commissioning':   return 'commissioning'
    case 'closeout':        return 'turnover'
    default:                return 'planning'
  }
}

/**
 * Pure: turnover package statuses → contract turnoverStatus. Denver's handoff
 * chain has no 'issued' state, so that value is never produced here.
 */
export function turnoverStatusFromPackages(statuses: string[]): TurnoverStatus {
  if (statuses.length === 0) return 'not_started'
  if (statuses.every(s => s === 'accepted')) return 'accepted'
  return 'in_progress'
}

/** Pure: deterministic JSON with sorted keys (stable across property order). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/** Pure: stable content hash used by the snapshot-diff job to detect change. */
export function summaryHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex')
}

// ─── Aggregator ───────────────────────────────────────────────────────────────

function _pct(v: unknown): number | undefined {
  const n = Number(v)
  if (v == null || !Number.isFinite(n)) return undefined
  return Math.min(100, Math.max(0, n))
}

/**
 * Build the contract progress summary for one project. Returns null when the
 * project does not exist (or is not visible to the tenant).
 */
export async function buildProgressSummary(
  tenantId: string, projectId: string,
): Promise<ProgressSummary | null> {
  const projectRes = await tenantQuery(tenantId, `
    SELECT status::text AS status, current_phase::text AS current_phase, progress_pct
    FROM projects
    WHERE id = $1 AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [projectId])
  const project = projectRes.rows[0] as
    { status: string | null; current_phase: string | null; progress_pct: unknown } | undefined
  if (!project) return null

  const [defRes, actionRes, pkgRes] = await Promise.all([
    tenantQuery<{ open: string; critical: string }>(tenantId, `
      SELECT COUNT(*)::text AS open,
             COUNT(*) FILTER (WHERE severity = 'critical')::text AS critical
      FROM deficiencies
      WHERE project_id = $1 AND status NOT IN ('closed', 'waived')
    `, [projectId]),
    tenantQuery<{ overdue: string }>(tenantId, `
      SELECT COUNT(*)::text AS overdue
      FROM action_items
      WHERE project_id = $1
        AND (status = 'overdue'
             OR (status IN ('open', 'in_progress') AND due_date IS NOT NULL AND due_date < CURRENT_DATE))
    `, [projectId]),
    tenantQuery<{ status: string }>(tenantId, `
      SELECT status FROM turnover_packages WHERE project_id = $1
    `, [projectId]),
  ])

  const summary: ProgressSummary = {
    overallStatus: phaseToOverallStatus(project.status, project.current_phase),
    turnoverStatus: turnoverStatusFromPackages(pkgRes.rows.map(r => String(r.status))),
  }

  const overallPercent = _pct(project.progress_pct)
  if (overallPercent !== undefined) summary.overallPercent = overallPercent

  const open = parseInt(defRes.rows[0]?.open ?? '', 10)
  const critical = parseInt(defRes.rows[0]?.critical ?? '', 10)
  if (Number.isFinite(open))     summary.deficienciesOpen = open
  if (Number.isFinite(critical)) summary.criticalDeficienciesOpen = critical

  const overdue = parseInt(actionRes.rows[0]?.overdue ?? '', 10)
  if (Number.isFinite(overdue)) summary.overdueActivities = overdue

  return summary
}
