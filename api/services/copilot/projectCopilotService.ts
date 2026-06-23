/**
 * Denver Engineering — Project Copilot (v4.41.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * The AI Project Intelligence differentiator (vision Phase 11 / Phase 8 field
 * assistant). Where the rest of the platform *stores* project state, this turns
 * live cross-module state into a ranked, explained answer to one question:
 *
 *     "What should I focus on today?"
 *
 * It synthesises actionable signals from eight sources — RFIs, submittals, risks,
 * inspections, punch items, cross-module actions, cost, and schedule — scores
 * each by urgency/impact, and returns a prioritised briefing with a plain-English
 * reason and recommended next action per item.
 *
 * The ranking is a PURE, deterministic function (`synthesizeFocus`) over already
 * fetched rows, so it is fully unit-testable without a database. `buildProjectFocus`
 * / `buildPortfolioFocus` are the thin DB-backed wrappers used by the route.
 */
import { tenantQuery } from '../../db/pool'

// ─── Public types ─────────────────────────────────────────────────────────────

export type FocusSource =
  | 'rfi' | 'submittal' | 'risk' | 'inspection' | 'punch' | 'action' | 'budget' | 'schedule'

export type FocusSeverity = 'critical' | 'high' | 'medium' | 'low'

export interface FocusItem {
  source:            FocusSource
  sourceId:          string | null   // originating record id (for deep-linking)
  reference:         string          // human-facing ref, e.g. "RFI-014"
  title:             string
  why:               string          // explanation of why it matters
  recommendedAction: string          // the suggested next step
  severity:          FocusSeverity
  score:             number          // 0–100
  impacts:           string[]        // ['schedule','cost',...]
  dueDate:           string | null   // ISO date if known
  daysOverdue:       number | null   // >0 = overdue, <0 = days remaining, null = no due date
  parentId?:         string | null   // parent record id for nested sources (e.g. punch item → list)
}

export interface ProjectSummary {
  id:     string
  code:   string | null
  name:   string | null
  status: string | null
}

export interface FocusBriefing {
  project:     ProjectSummary
  generatedAt: string
  headline:    string
  summary:     { total: number; critical: number; high: number; medium: number; low: number }
  items:       FocusItem[]
}

// ─── Raw row shapes (loosely typed — pg returns NUMERIC as string) ────────────

type Dateish = string | Date | null | undefined
interface ProjectRow {
  id: string; code?: string | null; name?: string | null; status?: string | null
  budget?: unknown; committed_cost?: unknown; actual_cost?: unknown; forecast_cost?: unknown
  planned_finish?: Dateish; actual_finish?: Dateish; progress_pct?: unknown
}
interface RfiRow {
  id: string; rfi_number?: string; title?: string; status?: string
  priority?: string; assigned_to?: string | null; due_date?: Dateish
}
interface SubmittalRow {
  id: string; submittal_number?: string; title?: string; status?: string
  reviewed_by?: string | null; due_date?: Dateish
}
interface RiskRow {
  id: string; risk_number?: number; title?: string; status?: string; category?: string
  probability?: number; impact?: number; risk_score?: number
  cost_exposure?: unknown; target_date?: Dateish; mitigation_plan?: string | null
}
interface InspectionRow {
  id: string; inspection_number?: string; title?: string; status?: string
  scheduled_date?: Dateish; overall_result?: string | null; location?: string | null
}
interface PunchRow {
  id: string; item_number?: number; title?: string; priority?: string; status?: string
  due_date?: Dateish; location?: string | null; punch_list_id?: string | null
}
interface ActionRow {
  id: string; title?: string; action_type?: string; source_module?: string
  priority?: string; status?: string; due_at?: Dateish
}

export interface FocusInputs {
  project:     ProjectRow
  rfis:        RfiRow[]
  submittals:  SubmittalRow[]
  risks:       RiskRow[]
  inspections: InspectionRow[]
  punchItems:  PunchRow[]
  actions:     ActionRow[]
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<string, number> = { low: 0, medium: 10, high: 22, critical: 38 }

function toDate(v: Dateish): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

/** Whole days between `from` and `due`. Positive = `due` is in the past (overdue). */
function daysOverdue(due: Date | null, now: Date): number | null {
  if (!due) return null
  return Math.floor((now.getTime() - due.getTime()) / 86_400_000)
}

function num(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return isNaN(n) ? 0 : n
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** Extra points contributed by an overdue/upcoming due date. */
function dueModifier(d: number | null): number {
  if (d == null) return 0
  if (d <= 0) return d >= -2 ? 4 : 0          // due within 2 days nudges up slightly
  return Math.min(30, d * 3)                   // overdue: +3/day up to +30
}

function severityOf(score: number): FocusSeverity {
  if (score >= 75) return 'critical'
  if (score >= 55) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

const ACTIVE_PROJECT = (s?: string | null) =>
  !['completed', 'closed', 'cancelled', 'archived'].includes((s ?? '').toLowerCase())

// ─── Per-source item builders ─────────────────────────────────────────────────

function rfiItem(r: RfiRow, now: Date): FocusItem {
  const od = daysOverdue(toDate(r.due_date), now)
  const unassigned = !r.assigned_to
  const score = clamp(30 + (PRIORITY_WEIGHT[r.priority ?? 'medium'] ?? 0) + dueModifier(od) + (unassigned ? 10 : 0))
  const ref = r.rfi_number ? `RFI ${r.rfi_number}` : `RFI ${r.id.slice(0, 8)}`
  const why = od != null && od > 0
    ? `${ref} "${r.title ?? ''}" is ${od} day${od === 1 ? '' : 's'} overdue and still ${r.status ?? 'open'}.`
    : od != null
      ? `${ref} "${r.title ?? ''}" is due in ${-od} day${od === -1 ? '' : 's'} and unanswered.`
      : `${ref} "${r.title ?? ''}" is open with no due date set.`
  return {
    source: 'rfi', sourceId: r.id, reference: ref, title: r.title ?? ref, why,
    recommendedAction: unassigned ? 'Assign a responder and set a due date.' : 'Follow up with the assignee for a response.',
    severity: severityOf(score), score, impacts: ['schedule'],
    dueDate: toDate(r.due_date)?.toISOString().slice(0, 10) ?? null, daysOverdue: od,
  }
}

function submittalItem(s: SubmittalRow, now: Date): FocusItem {
  const od = daysOverdue(toDate(s.due_date), now)
  const score = clamp(28 + dueModifier(od) + (s.status === 'under_review' ? 6 : 0))
  const ref = s.submittal_number ? `SUB ${s.submittal_number}` : `SUB ${s.id.slice(0, 8)}`
  const why = od != null && od > 0
    ? `${ref} "${s.title ?? ''}" review is ${od} day${od === 1 ? '' : 's'} overdue (${s.status ?? ''}).`
    : `${ref} "${s.title ?? ''}" is awaiting review (${s.status ?? ''}).`
  return {
    source: 'submittal', sourceId: s.id, reference: ref, title: s.title ?? ref, why,
    recommendedAction: s.reviewed_by ? 'Complete the pending review.' : 'Assign a reviewer to keep procurement on track.',
    severity: severityOf(score), score, impacts: ['schedule', 'procurement'],
    dueDate: toDate(s.due_date)?.toISOString().slice(0, 10) ?? null, daysOverdue: od,
  }
}

function riskItem(r: RiskRow, now: Date): FocusItem {
  const rs = num(r.risk_score) || num(r.probability) * num(r.impact)
  const od = daysOverdue(toDate(r.target_date), now)
  const exposure = num(r.cost_exposure)
  const score = clamp(rs * 3 + (od != null && od > 0 ? 15 : 0) + (exposure > 0 ? 6 : 0))
  const ref = r.risk_number != null ? `Risk #${r.risk_number}` : `Risk ${r.id.slice(0, 8)}`
  const exposureStr = exposure > 0 ? ` with $${exposure.toLocaleString('en-US')} exposure` : ''
  const why = `${ref} "${r.title ?? ''}" scores ${num(r.probability)}×${num(r.impact)}=${rs}${exposureStr}` +
    (od != null && od > 0 ? `; mitigation target was ${od} day${od === 1 ? '' : 's'} ago.` : '.')
  return {
    source: 'risk', sourceId: r.id, reference: ref, title: r.title ?? ref, why,
    recommendedAction: r.mitigation_plan ? 'Advance the mitigation plan and review residual exposure.' : 'Define a mitigation plan and assign an owner.',
    severity: severityOf(score), score, impacts: [r.category ?? 'other'],
    dueDate: toDate(r.target_date)?.toISOString().slice(0, 10) ?? null, daysOverdue: od,
  }
}

function inspectionItem(i: InspectionRow, now: Date): FocusItem | null {
  const failed = (i.overall_result ?? '').toLowerCase() === 'fail'
  const od = daysOverdue(toDate(i.scheduled_date), now)
  const overdue = i.status === 'scheduled' && od != null && od > 0
  if (!failed && !overdue) return null
  const ref = i.inspection_number ? `INSP ${i.inspection_number}` : `INSP ${i.id.slice(0, 8)}`
  const score = clamp(failed ? 50 + 8 : 25 + dueModifier(od))
  const loc = i.location ? ` at ${i.location}` : ''
  const why = failed
    ? `${ref} "${i.title ?? ''}"${loc} failed and needs corrective action.`
    : `${ref} "${i.title ?? ''}"${loc} was scheduled ${od} day${od === 1 ? '' : 's'} ago and is not done.`
  return {
    source: 'inspection', sourceId: i.id, reference: ref, title: i.title ?? ref, why,
    recommendedAction: failed ? 'Raise corrective action and schedule re-inspection.' : 'Dispatch the inspector or reschedule.',
    severity: severityOf(score), score, impacts: ['quality', 'schedule'],
    dueDate: toDate(i.scheduled_date)?.toISOString().slice(0, 10) ?? null, daysOverdue: failed ? null : od,
  }
}

function punchItem(p: PunchRow, now: Date): FocusItem | null {
  const od = daysOverdue(toDate(p.due_date), now)
  const hot = p.priority === 'high' || p.priority === 'critical'
  const overdue = od != null && od > 0
  if (!hot && !overdue) return null
  const ref = `Punch #${p.item_number ?? p.id.slice(0, 8)}`
  const score = clamp(20 + (PRIORITY_WEIGHT[p.priority ?? 'medium'] ?? 0) + dueModifier(od))
  const loc = p.location ? ` at ${p.location}` : ''
  const why = overdue
    ? `${ref} "${p.title ?? ''}"${loc} is ${od} day${od === 1 ? '' : 's'} past due (${p.priority ?? 'medium'}).`
    : `${ref} "${p.title ?? ''}"${loc} is a ${p.priority} closeout item still open.`
  return {
    source: 'punch', sourceId: p.id, reference: ref, title: p.title ?? ref, why,
    recommendedAction: 'Assign the trade and drive to verification.',
    severity: severityOf(score), score, impacts: ['closeout', 'quality'],
    dueDate: toDate(p.due_date)?.toISOString().slice(0, 10) ?? null, daysOverdue: od,
    parentId: p.punch_list_id ?? null,
  }
}

function actionItem(a: ActionRow, now: Date): FocusItem | null {
  const od = daysOverdue(toDate(a.due_at), now)
  const overdue = od != null && od > 0
  const critical = a.priority === 'critical'
  if (!overdue && !critical) return null
  const ref = a.action_type ? `${a.action_type}` : 'Action'
  const score = clamp(22 + (PRIORITY_WEIGHT[a.priority ?? 'medium'] ?? 0) + dueModifier(od))
  const why = overdue
    ? `${ref} task "${a.title ?? ''}" is ${od} day${od === 1 ? '' : 's'} overdue.`
    : `${ref} task "${a.title ?? ''}" is flagged critical.`
  return {
    source: 'action', sourceId: a.id, reference: ref, title: a.title ?? ref, why,
    recommendedAction: 'Reassign or escalate to clear the blocker.',
    severity: severityOf(score), score, impacts: ['execution'],
    dueDate: toDate(a.due_at)?.toISOString().slice(0, 10) ?? null, daysOverdue: od,
  }
}

function budgetItem(p: ProjectRow): FocusItem | null {
  const budget = num(p.budget)
  if (budget <= 0) return null
  const forecast = num(p.forecast_cost)
  const spent = num(p.committed_cost) + num(p.actual_cost)
  const worst = Math.max(forecast, spent)
  if (worst <= budget) return null
  const pct = (worst - budget) / budget
  const score = clamp(40 + Math.min(45, pct * 250))
  const basis = forecast >= spent ? 'Forecast cost' : 'Committed + actual cost'
  const why = `${basis} ($${worst.toLocaleString('en-US')}) exceeds budget ($${budget.toLocaleString('en-US')}) by ${(pct * 100).toFixed(1)}%.`
  return {
    source: 'budget', sourceId: p.id, reference: 'Budget', title: 'Cost forecast exceeds budget', why,
    recommendedAction: 'Review cost-to-complete and identify recovery or change-order options.',
    severity: severityOf(score), score, impacts: ['cost'], dueDate: null, daysOverdue: null,
  }
}

function scheduleItem(p: ProjectRow, now: Date): FocusItem | null {
  if (!ACTIVE_PROJECT(p.status)) return null
  const finish = toDate(p.planned_finish)
  const od = daysOverdue(finish, now)
  if (od == null || od <= 0) return null
  const progress = num(p.progress_pct)
  const score = clamp(50 + Math.min(30, od / 7) + (progress < 90 ? 8 : 0))
  const why = `Planned finish (${finish!.toISOString().slice(0, 10)}) passed ${od} day${od === 1 ? '' : 's'} ago; project still ${p.status ?? 'active'} at ${progress}% complete.`
  return {
    source: 'schedule', sourceId: p.id, reference: 'Schedule', title: 'Project past planned finish', why,
    recommendedAction: 'Re-baseline or build a recovery plan for the remaining critical path.',
    severity: severityOf(score), score, impacts: ['schedule'],
    dueDate: finish!.toISOString().slice(0, 10), daysOverdue: od,
  }
}

// ─── Pure synthesis ───────────────────────────────────────────────────────────

function headlineFor(project: ProjectSummary, items: FocusItem[], summary: FocusBriefing['summary']): string {
  const name = project.name ?? project.code ?? 'This project'
  if (summary.total === 0) {
    return `${name} is clear — no overdue or high-risk items across RFIs, submittals, risk, quality, cost, or schedule.`
  }
  const parts: string[] = []
  if (summary.critical) parts.push(`${summary.critical} critical`)
  if (summary.high) parts.push(`${summary.high} high-priority`)
  const lead = parts.length ? parts.join(' and ') : `${summary.total}`
  return `${name}: ${lead} item${summary.total === 1 ? '' : 's'} need attention. Top focus — ${items[0].why}`
}

/**
 * Rank raw cross-module rows into a focus briefing. Pure & deterministic given
 * `now` (defaults to current time); the engine of the Project Copilot.
 */
export function synthesizeFocus(inputs: FocusInputs, now: Date = new Date(), limit = 25): FocusBriefing {
  const project: ProjectSummary = {
    id: inputs.project.id,
    code: inputs.project.code ?? null,
    name: inputs.project.name ?? null,
    status: inputs.project.status ?? null,
  }

  const items: FocusItem[] = [
    ...inputs.rfis.map(r => rfiItem(r, now)),
    ...inputs.submittals.map(s => submittalItem(s, now)),
    ...inputs.risks.map(r => riskItem(r, now)),
    ...inputs.inspections.map(i => inspectionItem(i, now)),
    ...inputs.punchItems.map(p => punchItem(p, now)),
    ...inputs.actions.map(a => actionItem(a, now)),
    budgetItem(inputs.project),
    scheduleItem(inputs.project, now),
  ].filter((x): x is FocusItem => x !== null)

  // Highest score first; break ties by most-overdue, then source for stability.
  items.sort((a, b) =>
    b.score - a.score ||
    (b.daysOverdue ?? -Infinity) - (a.daysOverdue ?? -Infinity) ||
    a.source.localeCompare(b.source),
  )

  const summary = {
    total:    items.length,
    critical: items.filter(i => i.severity === 'critical').length,
    high:     items.filter(i => i.severity === 'high').length,
    medium:   items.filter(i => i.severity === 'medium').length,
    low:      items.filter(i => i.severity === 'low').length,
  }

  return {
    project,
    generatedAt: now.toISOString(),
    headline: headlineFor(project, items, summary),
    summary,
    items: items.slice(0, limit),
  }
}

// ─── DB-backed builders ───────────────────────────────────────────────────────

const SURFACED_MODULES = ['rfis', 'submittals', 'punch_items', 'inspections']

/** Fetch the actionable rows for one project and synthesise the briefing. */
export async function buildProjectFocus(
  tenantId: string, projectId: string, now: Date = new Date(), limit = 25,
): Promise<FocusBriefing | null> {
  const projectRes = await tenantQuery(tenantId,
    `SELECT id, code, name, status, budget, committed_cost, actual_cost, forecast_cost,
            planned_finish, actual_finish, progress_pct
       FROM projects WHERE tenant_id = $1 AND id = $2`, [tenantId, projectId])
  const project = projectRes.rows[0] as ProjectRow | undefined
  if (!project) return null

  const [rfis, submittals, risks, inspections, punchItems, actions] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT id, rfi_number, title, status, priority, assigned_to, due_date
         FROM rfis WHERE tenant_id=$1 AND project_id=$2 AND status IN ('open','pending') LIMIT 500`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT id, submittal_number, title, status, reviewed_by, due_date
         FROM submittals WHERE tenant_id=$1 AND project_id=$2 AND status IN ('submitted','under_review') LIMIT 500`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT id, risk_number, title, status, category, probability, impact, risk_score, cost_exposure, target_date, mitigation_plan
         FROM risks WHERE tenant_id=$1 AND project_id=$2 AND status IN ('open','mitigating') AND risk_score >= 12 LIMIT 500`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT id, inspection_number, title, status, scheduled_date, overall_result, location
         FROM inspections WHERE tenant_id=$1 AND project_id=$2 AND (status='scheduled' OR overall_result='fail') LIMIT 500`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT id, item_number, title, priority, status, due_date, location, punch_list_id
         FROM punch_items WHERE tenant_id=$1 AND project_id=$2 AND status='open' LIMIT 500`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT id, title, action_type, source_module, priority, status, due_at
         FROM actions WHERE tenant_id=$1 AND project_id=$2 AND status IN ('open','in_progress')
                        AND source_module <> ALL($3) LIMIT 500`, [tenantId, projectId, SURFACED_MODULES]),
  ])

  return synthesizeFocus({
    project,
    rfis: rfis.rows as RfiRow[],
    submittals: submittals.rows as SubmittalRow[],
    risks: risks.rows as RiskRow[],
    inspections: inspections.rows as InspectionRow[],
    punchItems: punchItems.rows as PunchRow[],
    actions: actions.rows as ActionRow[],
  }, now, limit)
}

export interface PortfolioFocusItem extends FocusItem {
  projectId:   string
  projectName: string | null
}

export interface PortfolioBriefing {
  generatedAt: string
  headline:    string
  summary:     { projects: number; total: number; critical: number; high: number }
  items:       PortfolioFocusItem[]
}

/**
 * Roll the per-project briefings up into a portfolio view: the top focus items
 * across all active projects, ranked. Bounded by `maxProjects` to keep the
 * dashboard query cost predictable.
 */
export async function buildPortfolioFocus(
  tenantId: string, now: Date = new Date(), limit = 30, maxProjects = 25,
): Promise<PortfolioBriefing> {
  const projRes = await tenantQuery(tenantId,
    `SELECT id FROM projects
       WHERE tenant_id=$1 AND status NOT IN ('completed','closed','cancelled','archived')
       ORDER BY updated_at DESC LIMIT $2`, [tenantId, maxProjects])
  const projectIds = (projRes.rows as { id: string }[]).map(r => r.id)

  const briefings = await Promise.all(projectIds.map(id => buildProjectFocus(tenantId, id, now, limit)))

  const items: PortfolioFocusItem[] = []
  for (const b of briefings) {
    if (!b) continue
    for (const it of b.items) {
      items.push({ ...it, projectId: b.project.id, projectName: b.project.name })
    }
  }
  items.sort((a, b) =>
    b.score - a.score ||
    (b.daysOverdue ?? -Infinity) - (a.daysOverdue ?? -Infinity) ||
    a.source.localeCompare(b.source),
  )
  const top = items.slice(0, limit)

  const critical = items.filter(i => i.severity === 'critical').length
  const high = items.filter(i => i.severity === 'high').length
  const headline = items.length === 0
    ? `All ${projectIds.length} active project${projectIds.length === 1 ? '' : 's'} are clear of overdue and high-risk items.`
    : `${critical} critical and ${high} high-priority item${critical + high === 1 ? '' : 's'} across ${projectIds.length} active project${projectIds.length === 1 ? '' : 's'}.`

  return {
    generatedAt: now.toISOString(),
    headline,
    summary: { projects: projectIds.length, total: items.length, critical, high },
    items: top,
  }
}
