/**
 * Denver Engineering — Portfolio Copilot (v4.44.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * The fourth and final AI Project Intelligence copilot (vision Phase 11 —
 * "Portfolio Copilot: compare projects; identify systemic issues, resource
 * conflicts, best practices"). Distinct from the Executive briefing (a health
 * report): this is cross-project *comparison*.
 *
 * Deterministic outputs:
 *   • benchmarks        — best / worst / median per metric across active projects
 *   • resourceConflicts — people carrying open/overdue work on ≥2 projects at once
 *   • exemplars         — projects leading on every tracked dimension (best practices)
 *   • outliers          — projects in the worst tier on ≥2 metrics (need attention)
 *
 * `synthesizePortfolioInsights` is a PURE function over fetched rows — testable,
 * explainable, no LLM.
 */
import { tenantQuery } from '../../db/pool'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BenchmarkEnd { projectId: string; name: string | null; value: number }
export interface Benchmark {
  metric: string
  unit: string
  lowerIsBetter: boolean
  best: BenchmarkEnd | null
  worst: BenchmarkEnd | null
  median: number
}

export interface ResourceConflict {
  userId: string
  projectCount: number
  totalOpen: number
  totalOverdue: number
  severity: 'critical' | 'high' | 'medium'
  projects: { projectId: string; name: string | null; open: number; overdue: number }[]
  summary: string
}

export interface PortfolioInsights {
  generatedAt: string
  headline: string
  summary: { projects: number; resourceConflicts: number; exemplars: number; outliers: number }
  benchmarks: Benchmark[]
  resourceConflicts: ResourceConflict[]
  exemplars: { projectId: string; name: string | null; reason: string }[]
  outliers: { projectId: string; name: string | null; reasons: string[] }[]
}

// ─── Raw rows ─────────────────────────────────────────────────────────────────

type Dateish = string | Date | null | undefined
interface ProjectMetricRow {
  id: string; name?: string | null; status?: string | null
  budget?: unknown; committed_cost?: unknown; actual_cost?: unknown; forecast_cost?: unknown
  planned_finish?: Dateish; progress_pct?: unknown
}
interface WorkItemRow { assignee: string | null; project_id: string; project_name?: string | null; status?: string; due?: Dateish; priority?: string }

export interface PortfolioInsightsInputs {
  projects:  ProjectMetricRow[]
  workItems: WorkItemRow[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return isNaN(n) ? 0 : n
}
function toDate(v: Dateish): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}
function daysBetween(due: Date | null, now: Date): number | null {
  if (!due) return null
  return Math.floor((now.getTime() - due.getTime()) / 86_400_000)
}
function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ─── Pure synthesis ───────────────────────────────────────────────────────────

interface PerProject {
  id: string; name: string | null
  costVarPct: number       // >0 = over budget
  slipDays: number         // >0 = behind plan
  overdue: number          // overdue open work items
}

export function synthesizePortfolioInsights(inputs: PortfolioInsightsInputs, now: Date = new Date()): PortfolioInsights {
  const overdueByProject = new Map<string, number>()
  for (const w of inputs.workItems) {
    const d = daysBetween(toDate(w.due), now)
    if (d != null && d > 0) overdueByProject.set(w.project_id, (overdueByProject.get(w.project_id) ?? 0) + 1)
  }

  const per: PerProject[] = inputs.projects.map(p => {
    const budget = num(p.budget)
    const costBasis = Math.max(num(p.forecast_cost), num(p.committed_cost) + num(p.actual_cost))
    const costVarPct = budget > 0 ? ((costBasis - budget) / budget) * 100 : 0
    const finish = toDate(p.planned_finish)
    const slipRaw = daysBetween(finish, now)
    const active = !['completed', 'closed', 'cancelled', 'archived'].includes((p.status ?? '').toLowerCase())
    const slipDays = active && slipRaw != null && slipRaw > 0 ? slipRaw : 0
    return { id: p.id, name: p.name ?? null, costVarPct, slipDays, overdue: overdueByProject.get(p.id) ?? 0 }
  })

  // ── Benchmarks (lower is better for all three) ──
  const mkBenchmark = (metric: string, unit: string, pick: (p: PerProject) => number): Benchmark => {
    if (per.length === 0) return { metric, unit, lowerIsBetter: true, best: null, worst: null, median: 0 }
    const sorted = [...per].sort((a, b) => pick(a) - pick(b))
    const best = sorted[0], worst = sorted[sorted.length - 1]
    return {
      metric, unit, lowerIsBetter: true,
      best: { projectId: best.id, name: best.name, value: Math.round(pick(best) * 10) / 10 },
      worst: { projectId: worst.id, name: worst.name, value: Math.round(pick(worst) * 10) / 10 },
      median: Math.round(median(per.map(pick)) * 10) / 10,
    }
  }
  const benchmarks = [
    mkBenchmark('Cost variance', '%', p => p.costVarPct),
    mkBenchmark('Schedule slip', 'days', p => p.slipDays),
    mkBenchmark('Overdue work', 'items', p => p.overdue),
  ]

  // ── Resource conflicts: assignees with open work on ≥2 projects ──
  const byUser = new Map<string, Map<string, { name: string | null; open: number; overdue: number }>>()
  const nameByProject = new Map<string, string | null>()
  for (const p of inputs.projects) nameByProject.set(p.id, p.name ?? null)
  for (const w of inputs.workItems) {
    if (!w.assignee) continue
    const projMap = byUser.get(w.assignee) ?? new Map()
    const entry = projMap.get(w.project_id) ?? { name: w.project_name ?? nameByProject.get(w.project_id) ?? null, open: 0, overdue: 0 }
    entry.open += 1
    const d = daysBetween(toDate(w.due), now)
    if (d != null && d > 0) entry.overdue += 1
    projMap.set(w.project_id, entry)
    byUser.set(w.assignee, projMap)
  }
  const resourceConflicts: ResourceConflict[] = []
  for (const [userId, projMap] of byUser) {
    if (projMap.size < 2) continue
    const projects = [...projMap.entries()].map(([projectId, e]) => ({ projectId, name: e.name, open: e.open, overdue: e.overdue }))
      .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
    const totalOpen = projects.reduce((s, p) => s + p.open, 0)
    const totalOverdue = projects.reduce((s, p) => s + p.overdue, 0)
    const severity: ResourceConflict['severity'] =
      (totalOverdue >= 5 || (projects.length >= 3 && totalOverdue >= 1)) ? 'critical'
      : totalOverdue >= 2 ? 'high' : 'medium'
    resourceConflicts.push({
      userId, projectCount: projects.length, totalOpen, totalOverdue, severity, projects,
      summary: `Owns ${totalOpen} open item${totalOpen === 1 ? '' : 's'} (${totalOverdue} overdue) across ${projects.length} projects — likely over-allocated.`,
    })
  }
  resourceConflicts.sort((a, b) => b.totalOverdue - a.totalOverdue || b.projectCount - a.projectCount || b.totalOpen - a.totalOpen)

  // ── Exemplars (best practices): under budget, on schedule, no overdue work ──
  const exemplars = per.filter(p => p.costVarPct <= 0 && p.slipDays === 0 && p.overdue === 0)
    .map(p => ({ projectId: p.id, name: p.name, reason: 'On budget, on schedule, and no overdue work — a model to replicate.' }))

  // ── Outliers: worst tier (top third) on ≥2 metrics ──
  const worstTier = (pick: (p: PerProject) => number): Set<string> => {
    if (per.length < 3) return new Set()
    const sorted = [...per].sort((a, b) => pick(b) - pick(a))  // worst (highest) first
    const cut = Math.max(1, Math.ceil(per.length / 3))
    return new Set(sorted.slice(0, cut).filter(p => pick(p) > 0).map(p => p.id))
  }
  const wCost = worstTier(p => p.costVarPct), wSlip = worstTier(p => p.slipDays), wOver = worstTier(p => p.overdue)
  const outliers = per.map(p => {
    const reasons: string[] = []
    if (wCost.has(p.id)) reasons.push(`cost ${p.costVarPct.toFixed(0)}% over budget`)
    if (wSlip.has(p.id)) reasons.push(`${p.slipDays}d behind plan`)
    if (wOver.has(p.id)) reasons.push(`${p.overdue} overdue items`)
    return { projectId: p.id, name: p.name, reasons }
  }).filter(o => o.reasons.length >= 2)
    .sort((a, b) => b.reasons.length - a.reasons.length)

  const headline = per.length === 0
    ? 'No active projects to compare.'
    : `${per.length} active projects compared — ${resourceConflicts.length} resource conflict${resourceConflicts.length === 1 ? '' : 's'}, ${outliers.length} outlier${outliers.length === 1 ? '' : 's'}, ${exemplars.length} exemplar${exemplars.length === 1 ? '' : 's'}.`

  return {
    generatedAt: now.toISOString(),
    headline,
    summary: { projects: per.length, resourceConflicts: resourceConflicts.length, exemplars: exemplars.length, outliers: outliers.length },
    benchmarks, resourceConflicts, exemplars, outliers,
  }
}

// ─── DB-backed builder ────────────────────────────────────────────────────────

export async function buildPortfolioInsights(
  tenantId: string, now: Date = new Date(), maxProjects = 40,
): Promise<PortfolioInsights> {
  const projRes = await tenantQuery(tenantId,
    `SELECT id, name, status, budget, committed_cost, actual_cost, forecast_cost, planned_finish, progress_pct
       FROM projects
      WHERE tenant_id=$1 AND status NOT IN ('completed','closed','cancelled','archived')
      ORDER BY updated_at DESC LIMIT $2`, [tenantId, maxProjects])
  const projects = projRes.rows as ProjectMetricRow[]
  if (projects.length === 0) return synthesizePortfolioInsights({ projects: [], workItems: [] }, now)

  const ids = projects.map(p => p.id)
  // Open work items across the portfolio (cross-module actions + RFIs) for
  // resource-conflict + overdue benchmarks.
  const [actions, rfis] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT assigned_to_user_id AS assignee, project_id, status, due_at AS due, priority
         FROM actions
        WHERE tenant_id=$1 AND project_id = ANY($2) AND status IN ('open','in_progress') LIMIT 5000`, [tenantId, ids]),
    tenantQuery(tenantId,
      `SELECT assigned_to AS assignee, project_id, status, due_date AS due, priority
         FROM rfis
        WHERE tenant_id=$1 AND project_id = ANY($2) AND status IN ('open','pending') LIMIT 5000`, [tenantId, ids]),
  ])

  const nameById = new Map(projects.map(p => [p.id, p.name ?? null]))
  type RawWork = { assignee?: string | null; project_id: string; status?: string; due?: Dateish; priority?: string }
  const rawWork = [...actions.rows, ...rfis.rows] as RawWork[]
  const workItems: WorkItemRow[] = rawWork.map(w => ({
    assignee: w.assignee ?? null,
    project_id: w.project_id,
    project_name: nameById.get(w.project_id) ?? null,
    status: w.status,
    due: w.due,
    priority: w.priority,
  }))

  return synthesizePortfolioInsights({ projects, workItems }, now)
}
