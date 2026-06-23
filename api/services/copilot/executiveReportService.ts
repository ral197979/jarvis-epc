/**
 * Denver Engineering — Executive Copilot (v4.43.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * The third AI Project Intelligence copilot (vision Phase 11 — "Executive Copilot:
 * generate board reports, owner reports, weekly summaries"). Produces a structured,
 * deterministic executive briefing per project and a board-level portfolio briefing.
 *
 * It is DETERMINISTIC and auditable by design: the health score and narrative are
 * templated over real numbers (project financials + the shipped Focus and
 * Coordination engines). An LLM "prose polish" step can wrap this later, but the
 * facts and the score never come from a model — so the briefing is testable and
 * never hallucinated. Reuses `buildProjectFocus` and `buildProjectCoordination`.
 */
import { tenantQuery } from '../../db/pool'
import { buildProjectFocus, type FocusBriefing } from './projectCopilotService'
import { buildProjectCoordination, type CoordinationBriefing } from './coordinationService'

// ─── Public types ─────────────────────────────────────────────────────────────

export type HealthStatus = 'on_track' | 'watch' | 'at_risk' | 'critical'

export interface ReportMetric { label: string; value: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }
export interface ReportLine { ref: string; text: string; severity?: string }
export interface ReportSection {
  id: 'summary' | 'schedule' | 'cost' | 'risk' | 'coordination' | 'actions'
  title: string
  body: string
  metrics?: ReportMetric[]
  items?: ReportLine[]
}

export interface ProjectReport {
  project: { id: string; code: string | null; name: string | null; status: string | null }
  generatedAt: string
  healthScore: number          // 0–100
  healthStatus: HealthStatus
  headline: string
  sections: ReportSection[]
  recommendedActions: string[]
}

interface ProjectFinancialsRow {
  id: string; code?: string | null; name?: string | null; status?: string | null
  budget?: unknown; committed_cost?: unknown; actual_cost?: unknown; forecast_cost?: unknown
  progress_pct?: unknown; planned_finish?: string | Date | null; actual_finish?: string | Date | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return isNaN(n) ? 0 : n
}
function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}
function daysBetween(due: Date | null, now: Date): number | null {
  if (!due) return null
  return Math.floor((now.getTime() - due.getTime()) / 86_400_000)
}
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const ACTIVE = (s?: string | null) => !['completed', 'closed', 'cancelled', 'archived'].includes((s ?? '').toLowerCase())

function statusOf(score: number): HealthStatus {
  if (score >= 80) return 'on_track'
  if (score >= 65) return 'watch'
  if (score >= 45) return 'at_risk'
  return 'critical'
}
const STATUS_LABEL: Record<HealthStatus, string> = {
  on_track: 'On track', watch: 'Watch', at_risk: 'At risk', critical: 'Critical',
}

// ─── Pure generation ──────────────────────────────────────────────────────────

/**
 * Build a deterministic executive briefing from a project's financials plus its
 * Focus and Coordination briefings. Pure — given the same inputs and `now` it
 * always returns the same report.
 */
export function generateProjectBriefing(
  project: ProjectFinancialsRow, focus: FocusBriefing, coordination: CoordinationBriefing, now: Date = new Date(),
): ProjectReport {
  const name = project.name ?? project.code ?? 'Project'

  // ── Cost position ──
  const budget   = num(project.budget)
  const forecast = num(project.forecast_cost)
  const spent    = num(project.committed_cost) + num(project.actual_cost)
  const costBasis = Math.max(forecast, spent)
  const costVarPct = budget > 0 ? (costBasis - budget) / budget : 0
  const overBudget = budget > 0 && costBasis > budget

  // ── Schedule position ──
  const finish = toDate(project.planned_finish)
  const slip = daysBetween(finish, now)
  const overdueFinish = ACTIVE(project.status) && slip != null && slip > 0
  const progress = num(project.progress_pct)

  // ── Health score (start 100, subtract grounded penalties) ──
  let score = 100
  if (overBudget) score -= Math.min(30, costVarPct * 200)
  if (overdueFinish) score -= Math.min(25, (slip! / 7) * 4 + 6)
  score -= Math.min(28, focus.summary.critical * 7 + focus.summary.high * 3)
  score -= Math.min(22, coordination.summary.critical * 6 + coordination.summary.high * 2)
  const healthScore = clamp(score)
  const healthStatus = statusOf(healthScore)

  // ── Sections ──
  const sections: ReportSection[] = []

  // Schedule
  const schedMetrics: ReportMetric[] = [
    { label: 'Progress', value: `${progress}%`, tone: progress >= 90 ? 'good' : progress >= 50 ? 'neutral' : 'warn' },
    { label: 'Planned finish', value: finish ? finish.toISOString().slice(0, 10) : '—', tone: overdueFinish ? 'bad' : 'neutral' },
  ]
  const schedBody = overdueFinish
    ? `Behind plan: the planned finish passed ${slip} day${slip === 1 ? '' : 's'} ago with the project at ${progress}% complete.`
    : finish
      ? `Tracking to a planned finish of ${finish.toISOString().slice(0, 10)} at ${progress}% complete.`
      : `No planned finish set; project is ${progress}% complete.`
  sections.push({ id: 'schedule', title: 'Schedule confidence', body: schedBody, metrics: schedMetrics })

  // Cost
  const costMetrics: ReportMetric[] = [
    { label: 'Budget', value: budget > 0 ? money(budget) : '—' },
    { label: forecast >= spent ? 'Forecast' : 'Committed + actual', value: money(costBasis), tone: overBudget ? 'bad' : 'good' },
    { label: 'Variance', value: budget > 0 ? `${(costVarPct * 100).toFixed(1)}%` : '—', tone: overBudget ? 'bad' : 'good' },
  ]
  const costBody = overBudget
    ? `Cost is trending ${(costVarPct * 100).toFixed(1)}% over budget (${money(costBasis)} vs ${money(budget)}). Recovery options should be reviewed.`
    : budget > 0
      ? `Cost is within budget (${money(costBasis)} of ${money(budget)}).`
      : `No budget set for this project.`
  sections.push({ id: 'cost', title: 'Cost position', body: costBody, metrics: costMetrics })

  // Risk (top risk/quality items from Focus)
  const riskItems = focus.items.filter(i => ['risk', 'inspection'].includes(i.source)).slice(0, 5)
    .map(i => ({ ref: i.reference, text: i.why, severity: i.severity }))
  sections.push({
    id: 'risk', title: 'Top risks',
    body: riskItems.length ? `${riskItems.length} risk/quality item${riskItems.length === 1 ? '' : 's'} need executive attention.` : 'No high-scoring risks flagged.',
    items: riskItems,
  })

  // Coordination (top blockers/approvals)
  const coordItems = coordination.issues.slice(0, 5).map(i => ({ ref: i.reference, text: i.why, severity: i.severity }))
  sections.push({
    id: 'coordination', title: 'Blockers & missing approvals',
    body: coordItems.length ? `${coordination.summary.total} open coordination issue${coordination.summary.total === 1 ? '' : 's'} (${coordination.summary.critical} critical).` : 'No coordination issues detected.',
    items: coordItems,
  })

  // Recommended actions — dedup the top recommendations across Focus + Coordination
  const recs: string[] = []
  for (const r of [...focus.items.map(i => i.recommendedAction), ...coordination.issues.map(i => i.recommendedAction)]) {
    if (r && !recs.includes(r)) recs.push(r)
    if (recs.length >= 5) break
  }

  // Executive summary (templated over the computed facts)
  const drivers: string[] = []
  if (overBudget) drivers.push(`cost ${(costVarPct * 100).toFixed(0)}% over budget`)
  if (overdueFinish) drivers.push(`${slip}d behind plan`)
  if (focus.summary.critical) drivers.push(`${focus.summary.critical} critical focus item${focus.summary.critical === 1 ? '' : 's'}`)
  if (coordination.summary.total) drivers.push(`${coordination.summary.total} coordination issue${coordination.summary.total === 1 ? '' : 's'}`)
  const summaryBody = drivers.length
    ? `${name} is ${STATUS_LABEL[healthStatus].toLowerCase()} (health ${healthScore}/100), driven by ${drivers.join(', ')}.`
    : `${name} is ${STATUS_LABEL[healthStatus].toLowerCase()} (health ${healthScore}/100) with no material issues flagged.`
  sections.unshift({
    id: 'summary', title: 'Executive summary', body: summaryBody,
    metrics: [{ label: 'Health', value: `${healthScore}/100`, tone: healthScore >= 80 ? 'good' : healthScore >= 45 ? 'warn' : 'bad' },
              { label: 'Status', value: STATUS_LABEL[healthStatus], tone: healthScore >= 80 ? 'good' : healthScore >= 45 ? 'warn' : 'bad' }],
  })

  return {
    project: { id: project.id, code: project.code ?? null, name: project.name ?? null, status: project.status ?? null },
    generatedAt: now.toISOString(),
    healthScore, healthStatus,
    headline: summaryBody,
    sections,
    recommendedActions: recs,
  }
}

// ─── DB-backed builders ───────────────────────────────────────────────────────

export async function buildProjectReport(
  tenantId: string, projectId: string, now: Date = new Date(),
): Promise<ProjectReport | null> {
  const projRes = await tenantQuery(tenantId,
    `SELECT id, code, name, status, budget, committed_cost, actual_cost, forecast_cost,
            progress_pct, planned_finish, actual_finish
       FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  const project = projRes.rows[0] as ProjectFinancialsRow | undefined
  if (!project) return null

  const [focus, coordination] = await Promise.all([
    buildProjectFocus(tenantId, projectId, now, 25),
    buildProjectCoordination(tenantId, projectId, now, 25),
  ])
  // Focus/coordination return null only if the project vanished mid-call; guard anyway.
  if (!focus || !coordination) return null

  return generateProjectBriefing(project, focus, coordination, now)
}

export interface PortfolioReportRow {
  projectId: string; projectName: string | null; healthScore: number; healthStatus: HealthStatus; topConcern: string
}
export interface PortfolioReport {
  generatedAt: string
  headline: string
  portfolioHealth: number
  summary: { projects: number; onTrack: number; watch: number; atRisk: number; critical: number }
  systemicIssues: { label: string; affectedProjects: number }[]
  projects: PortfolioReportRow[]
}

/** Board-level briefing: per-project health, ranked, plus systemic-issue detection. */
export async function buildPortfolioReport(
  tenantId: string, now: Date = new Date(), maxProjects = 25,
): Promise<PortfolioReport> {
  const projRes = await tenantQuery(tenantId,
    `SELECT id FROM projects
       WHERE tenant_id=$1 AND status NOT IN ('completed','closed','cancelled','archived')
       ORDER BY updated_at DESC LIMIT $2`, [tenantId, maxProjects])
  const ids = (projRes.rows as { id: string }[]).map(r => r.id)

  const reports = (await Promise.all(ids.map(id => buildProjectReport(tenantId, id, now)))).filter((r): r is ProjectReport => r !== null)

  const rows: PortfolioReportRow[] = reports.map(r => ({
    projectId: r.project.id,
    projectName: r.project.name,
    healthScore: r.healthScore,
    healthStatus: r.healthStatus,
    topConcern: r.recommendedActions[0] ?? 'No material issues',
  })).sort((a, b) => a.healthScore - b.healthScore)  // worst first

  const counts = { onTrack: 0, watch: 0, atRisk: 0, critical: 0 }
  for (const r of reports) {
    if (r.healthStatus === 'on_track') counts.onTrack++
    else if (r.healthStatus === 'watch') counts.watch++
    else if (r.healthStatus === 'at_risk') counts.atRisk++
    else counts.critical++
  }
  const portfolioHealth = reports.length ? Math.round(reports.reduce((s, r) => s + r.healthScore, 0) / reports.length) : 100

  // Systemic issues: a section concern recurring across ≥2 projects.
  const concernCount = new Map<string, number>()
  for (const r of reports) {
    const labels = new Set<string>()
    if (r.sections.find(s => s.id === 'cost')?.body.includes('over budget')) labels.add('Cost overruns')
    if (r.sections.find(s => s.id === 'schedule')?.body.includes('Behind plan')) labels.add('Schedule slippage')
    if ((r.sections.find(s => s.id === 'coordination')?.items?.length ?? 0) > 0) labels.add('Open blockers / missing approvals')
    if ((r.sections.find(s => s.id === 'risk')?.items?.length ?? 0) > 0) labels.add('Unmitigated risks')
    for (const l of labels) concernCount.set(l, (concernCount.get(l) ?? 0) + 1)
  }
  const systemicIssues = [...concernCount.entries()]
    .filter(([, n]) => n >= 2)
    .map(([label, affectedProjects]) => ({ label, affectedProjects }))
    .sort((a, b) => b.affectedProjects - a.affectedProjects)

  const headline = reports.length === 0
    ? 'No active projects to report on.'
    : `Portfolio health ${portfolioHealth}/100 across ${reports.length} active project${reports.length === 1 ? '' : 's'} — ${counts.critical} critical, ${counts.atRisk} at risk.`

  return {
    generatedAt: now.toISOString(),
    headline,
    portfolioHealth,
    summary: { projects: reports.length, ...counts },
    systemicIssues,
    projects: rows,
  }
}
