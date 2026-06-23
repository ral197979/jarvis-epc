/**
 * Denver Engineering — Coordination Copilot (v4.42.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * The second AI Project Intelligence copilot (vision Phase 11 — "Coordination
 * Copilot: identify conflicts, missing approvals, schedule clashes, procurement
 * blockers"). Where the Project Copilot answers "what should *I* focus on today",
 * this answers "where is the project *blocked or out of sync* across parties".
 *
 * Five deterministic signal families, each grounded in real tables:
 *   1. missing_approval  — RFIs unanswered, submittals awaiting review (gate downstream work)
 *   2. blocker           — open actions blocked by another still-open action (action_relations)
 *   3. schedule_clash    — successor tasks being built before their predecessor finished (schedule_dependencies)
 *   4. bim_clash         — open BIM coordination issues / clashes (bim_issues)
 *   5. commercial_gate   — change orders awaiting approval (change_orders, co_status='submitted')
 *
 * Like the Focus engine, `synthesizeCoordination` is a PURE deterministic function
 * over already-fetched rows — fully unit-testable, explainable, no LLM in the ranking.
 */
import { tenantQuery } from '../../db/pool'

// ─── Public types ─────────────────────────────────────────────────────────────

export type CoordinationCategory =
  | 'missing_approval' | 'blocker' | 'schedule_clash' | 'bim_clash' | 'commercial_gate'

export type CoordinationSource = 'rfi' | 'submittal' | 'action' | 'schedule' | 'bim' | 'change_order'

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface CoordinationIssue {
  category:          CoordinationCategory
  source:            CoordinationSource
  sourceId:          string | null
  reference:         string
  title:             string
  why:               string
  recommendedAction: string
  owner:             string | null   // assigned user id, when known
  severity:          Severity
  score:             number          // 0–100
  impacts:           string[]
  dueDate:           string | null
  daysOverdue:       number | null
}

export interface ProjectSummary {
  id: string; code: string | null; name: string | null; status: string | null
}

export interface CoordinationBriefing {
  project:     ProjectSummary
  generatedAt: string
  headline:    string
  summary: {
    total: number; critical: number; high: number; medium: number; low: number
    byCategory: Record<CoordinationCategory, number>
  }
  issues: CoordinationIssue[]
}

// ─── Raw row shapes ───────────────────────────────────────────────────────────

type Dateish = string | Date | null | undefined
interface ProjectRow { id: string; code?: string | null; name?: string | null; status?: string | null }
interface RfiRow { id: string; rfi_number?: string; title?: string; status?: string; priority?: string; assigned_to?: string | null; due_date?: Dateish }
interface SubmittalRow { id: string; submittal_number?: string; title?: string; status?: string; reviewed_by?: string | null; due_date?: Dateish }
interface BlockedActionRow { id: string; title?: string; action_type?: string; priority?: string; status?: string; due_at?: Dateish; assigned_to_user_id?: string | null; blocker_title?: string; blocker_status?: string }
interface ScheduleClashRow { succ_id: string; succ_name?: string; succ_status?: string; pred_id?: string; pred_name?: string; pred_status?: string }
interface BimIssueRow { id: string; title?: string; severity?: string; status?: string; assigned_to?: string | null }
interface ChangeOrderRow { id: string; co_number?: number; title?: string; status?: string; cost_impact?: unknown; schedule_impact_days?: number | null }

export interface CoordinationInputs {
  project:        ProjectRow
  rfis:           RfiRow[]
  submittals:     SubmittalRow[]
  blockedActions: BlockedActionRow[]
  scheduleClashes: ScheduleClashRow[]
  bimIssues:      BimIssueRow[]
  changeOrders:   ChangeOrderRow[]
}

// ─── Helpers (mirrors projectCopilotService for consistency) ──────────────────

const PRIORITY_WEIGHT: Record<string, number> = { low: 0, medium: 8, high: 18, critical: 30 }
const CATEGORIES: CoordinationCategory[] = ['missing_approval', 'blocker', 'schedule_clash', 'bim_clash', 'commercial_gate']

function toDate(v: Dateish): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}
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
function overdueMod(d: number | null): number {
  if (d == null || d <= 0) return 0
  return Math.min(30, d * 3)
}
function severityOf(score: number): Severity {
  if (score >= 75) return 'critical'
  if (score >= 55) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}
function isoDay(v: Dateish): string | null {
  return toDate(v)?.toISOString().slice(0, 10) ?? null
}

// ─── Per-signal builders ──────────────────────────────────────────────────────

function rfiApprovalIssue(r: RfiRow, now: Date): CoordinationIssue | null {
  const od = daysOverdue(toDate(r.due_date), now)
  const unassigned = !r.assigned_to
  const overdue = od != null && od > 0
  if (!overdue && !unassigned) return null
  const ref = r.rfi_number ? `RFI ${r.rfi_number}` : `RFI ${r.id.slice(0, 8)}`
  const score = clamp((overdue ? 40 : 32) + overdueMod(od) + (PRIORITY_WEIGHT[r.priority ?? 'medium'] ?? 0) + (unassigned ? 8 : 0))
  const why = overdue
    ? `${ref} "${r.title ?? ''}" is ${od} day${od === 1 ? '' : 's'} overdue and unanswered — downstream work waits on the answer.`
    : `${ref} "${r.title ?? ''}" has no assignee, so no one is on the hook to answer it.`
  return {
    category: 'missing_approval', source: 'rfi', sourceId: r.id, reference: ref, title: r.title ?? ref, why,
    recommendedAction: unassigned ? 'Assign a responder and set a due date.' : 'Expedite the response with the assignee.',
    owner: r.assigned_to ?? null, severity: severityOf(score), score, impacts: ['schedule'],
    dueDate: isoDay(r.due_date), daysOverdue: od,
  }
}

function submittalApprovalIssue(s: SubmittalRow, now: Date): CoordinationIssue | null {
  const od = daysOverdue(toDate(s.due_date), now)
  const unassigned = !s.reviewed_by
  const overdue = od != null && od > 0
  if (!overdue && !unassigned) return null
  const ref = s.submittal_number ? `SUB ${s.submittal_number}` : `SUB ${s.id.slice(0, 8)}`
  const score = clamp((overdue ? 40 : 32) + overdueMod(od) + (s.status === 'under_review' ? 6 : 0) + (unassigned ? 8 : 0))
  const why = overdue
    ? `${ref} "${s.title ?? ''}" review is ${od} day${od === 1 ? '' : 's'} overdue — procurement/fabrication is gated.`
    : `${ref} "${s.title ?? ''}" has no reviewer assigned.`
  return {
    category: 'missing_approval', source: 'submittal', sourceId: s.id, reference: ref, title: s.title ?? ref, why,
    recommendedAction: unassigned ? 'Assign a reviewer to keep procurement on track.' : 'Complete the pending review.',
    owner: s.reviewed_by ?? null, severity: severityOf(score), score, impacts: ['schedule', 'procurement'],
    dueDate: isoDay(s.due_date), daysOverdue: od,
  }
}

function blockerIssue(a: BlockedActionRow, now: Date): CoordinationIssue {
  const od = daysOverdue(toDate(a.due_at), now)
  const score = clamp(55 + (PRIORITY_WEIGHT[a.priority ?? 'medium'] ?? 0) + overdueMod(od))
  const ref = a.action_type ? `${a.action_type}` : 'Action'
  const why = `${ref} "${a.title ?? ''}" is blocked by still-open work${a.blocker_title ? ` ("${a.blocker_title}")` : ''}` +
    (od != null && od > 0 ? `, and is ${od} day${od === 1 ? '' : 's'} overdue.` : '.')
  return {
    category: 'blocker', source: 'action', sourceId: a.id, reference: ref, title: a.title ?? ref, why,
    recommendedAction: a.blocker_title ? `Clear the blocker "${a.blocker_title}" or re-sequence the work.` : 'Resolve the upstream blocker or escalate.',
    owner: a.assigned_to_user_id ?? null, severity: severityOf(score), score, impacts: ['execution'],
    dueDate: isoDay(a.due_at), daysOverdue: od,
  }
}

function scheduleClashIssue(c: ScheduleClashRow): CoordinationIssue {
  const score = clamp(60 + (c.pred_status === 'not_started' ? 8 : 0))
  const ref = `Task ${c.succ_id.slice(0, 8)}`
  const why = `"${c.succ_name ?? 'A task'}" is in progress while its predecessor "${c.pred_name ?? ''}" is ${c.pred_status ?? 'incomplete'} — work is proceeding out of sequence.`
  return {
    category: 'schedule_clash', source: 'schedule', sourceId: c.succ_id, reference: ref, title: c.succ_name ?? ref, why,
    recommendedAction: `Confirm predecessor "${c.pred_name ?? ''}" status; re-sequence or accelerate to remove the out-of-sequence risk.`,
    owner: null, severity: severityOf(score), score, impacts: ['schedule'], dueDate: null, daysOverdue: null,
  }
}

function bimClashIssue(b: BimIssueRow): CoordinationIssue {
  const sev = (b.severity ?? 'minor').toLowerCase()
  const base = sev === 'critical' ? 72 : sev === 'major' ? 52 : 35
  const unassigned = !b.assigned_to
  const score = clamp(base + (unassigned ? 6 : 0))
  const ref = `Clash ${b.id.slice(0, 8)}`
  const why = `Open ${sev} BIM coordination clash "${b.title ?? ''}"${unassigned ? ' with no owner' : ''} — unresolved conflicts block trades downstream.`
  return {
    category: 'bim_clash', source: 'bim', sourceId: b.id, reference: ref, title: b.title ?? ref, why,
    recommendedAction: unassigned ? 'Assign the clash to a discipline lead and set a due date.' : 'Drive the open clash to resolution.',
    owner: b.assigned_to ?? null, severity: severityOf(score), score, impacts: ['coordination', 'quality'], dueDate: null, daysOverdue: null,
  }
}

function commercialGateIssue(co: ChangeOrderRow): CoordinationIssue {
  const cost = Math.abs(num(co.cost_impact))
  const sched = num(co.schedule_impact_days)
  const score = clamp(38 + Math.min(30, cost / 50000) + (sched > 0 ? 10 : 0))
  const ref = co.co_number != null ? `CO-${co.co_number}` : `CO ${co.id.slice(0, 8)}`
  const impactStr = cost > 0 ? ` ($${cost.toLocaleString('en-US')}${sched > 0 ? `, +${sched}d` : ''})` : ''
  const why = `${ref} "${co.title ?? ''}"${impactStr} is submitted and awaiting approval — commercial certainty and any gated work are on hold.`
  const impacts = sched > 0 ? ['cost', 'schedule'] : ['cost']
  return {
    category: 'commercial_gate', source: 'change_order', sourceId: co.id, reference: ref, title: co.title ?? ref, why,
    recommendedAction: `Route ${ref} for approval to unblock commercial certainty.`,
    owner: null, severity: severityOf(score), score, impacts, dueDate: null, daysOverdue: null,
  }
}

// ─── Pure synthesis ───────────────────────────────────────────────────────────

function headlineFor(project: ProjectSummary, issues: CoordinationIssue[], summary: CoordinationBriefing['summary']): string {
  const name = project.name ?? project.code ?? 'This project'
  if (summary.total === 0) {
    return `${name} is in sync — no blockers, missing approvals, clashes, or pending change orders detected.`
  }
  const lead = [summary.critical ? `${summary.critical} critical` : '', summary.high ? `${summary.high} high` : '']
    .filter(Boolean).join(' and ') || `${summary.total}`
  return `${name}: ${lead} coordination issue${summary.total === 1 ? '' : 's'}. Top — ${issues[0].why}`
}

export function synthesizeCoordination(inputs: CoordinationInputs, now: Date = new Date(), limit = 50): CoordinationBriefing {
  const project: ProjectSummary = {
    id: inputs.project.id, code: inputs.project.code ?? null, name: inputs.project.name ?? null, status: inputs.project.status ?? null,
  }

  const issues: CoordinationIssue[] = [
    ...inputs.rfis.map(r => rfiApprovalIssue(r, now)),
    ...inputs.submittals.map(s => submittalApprovalIssue(s, now)),
    ...inputs.blockedActions.map(a => blockerIssue(a, now)),
    ...inputs.scheduleClashes.map(c => scheduleClashIssue(c)),
    ...inputs.bimIssues.map(b => bimClashIssue(b)),
    ...inputs.changeOrders.map(co => commercialGateIssue(co)),
  ].filter((x): x is CoordinationIssue => x !== null)

  issues.sort((a, b) =>
    b.score - a.score ||
    (b.daysOverdue ?? -Infinity) - (a.daysOverdue ?? -Infinity) ||
    a.category.localeCompare(b.category),
  )

  const byCategory = CATEGORIES.reduce((acc, c) => {
    acc[c] = issues.filter(i => i.category === c).length
    return acc
  }, {} as Record<CoordinationCategory, number>)

  const summary = {
    total:    issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
    high:     issues.filter(i => i.severity === 'high').length,
    medium:   issues.filter(i => i.severity === 'medium').length,
    low:      issues.filter(i => i.severity === 'low').length,
    byCategory,
  }

  return {
    project,
    generatedAt: now.toISOString(),
    headline: headlineFor(project, issues, summary),
    summary,
    issues: issues.slice(0, limit),
  }
}

// ─── DB-backed builders ───────────────────────────────────────────────────────

export async function buildProjectCoordination(
  tenantId: string, projectId: string, now: Date = new Date(), limit = 50,
): Promise<CoordinationBriefing | null> {
  const projectRes = await tenantQuery(tenantId,
    `SELECT id, code, name, status FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  const project = projectRes.rows[0] as ProjectRow | undefined
  if (!project) return null

  const [rfis, submittals, blockedActions, scheduleClashes, bimIssues, changeOrders] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT id, rfi_number, title, status, priority, assigned_to, due_date
         FROM rfis WHERE tenant_id=$1 AND project_id=$2 AND status IN ('open','pending') LIMIT 500`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT id, submittal_number, title, status, reviewed_by, due_date
         FROM submittals WHERE tenant_id=$1 AND project_id=$2 AND status IN ('submitted','under_review') LIMIT 500`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT a.id, a.title, a.action_type, a.priority, a.status, a.due_at, a.assigned_to_user_id,
              b.title AS blocker_title, b.status AS blocker_status
         FROM actions a
         JOIN action_relations ar ON ar.target_action_id = a.id AND ar.tenant_id = a.tenant_id
              AND ar.deleted_at IS NULL AND ar.relation_type IN ('blocks','caused_by','spawned_from')
         JOIN actions b ON b.id = ar.source_action_id AND b.tenant_id = a.tenant_id
        WHERE a.tenant_id=$1 AND a.project_id=$2
          AND a.status IN ('open','in_progress')
          AND b.status NOT IN ('completed','cancelled') LIMIT 500`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT s.id AS succ_id, s.name AS succ_name, s.status AS succ_status,
              p.id AS pred_id, p.name AS pred_name, p.status AS pred_status
         FROM schedule_dependencies d
         JOIN schedule_tasks s ON s.id = d.successor_id AND s.tenant_id=$1
         JOIN schedule_tasks p ON p.id = d.predecessor_id AND p.tenant_id=$1
        WHERE d.tenant_id=$1 AND s.project_id=$2
          AND s.status = 'in_progress' AND p.status <> 'complete' LIMIT 500`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT id, title, severity, status, assigned_to
         FROM bim_issues WHERE tenant_id=$1 AND project_id=$2 AND status='open' LIMIT 500`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT id, co_number, title, status, cost_impact, schedule_impact_days
         FROM change_orders WHERE tenant_id=$1 AND project_id=$2 AND status='submitted' LIMIT 500`, [tenantId, projectId]),
  ])

  return synthesizeCoordination({
    project,
    rfis: rfis.rows as RfiRow[],
    submittals: submittals.rows as SubmittalRow[],
    blockedActions: blockedActions.rows as BlockedActionRow[],
    scheduleClashes: scheduleClashes.rows as ScheduleClashRow[],
    bimIssues: bimIssues.rows as BimIssueRow[],
    changeOrders: changeOrders.rows as ChangeOrderRow[],
  }, now, limit)
}

export interface PortfolioCoordinationItem extends CoordinationIssue {
  projectId: string
  projectName: string | null
}

export interface PortfolioCoordinationBriefing {
  generatedAt: string
  headline: string
  summary: { projects: number; total: number; critical: number; high: number }
  issues: PortfolioCoordinationItem[]
}

export async function buildPortfolioCoordination(
  tenantId: string, now: Date = new Date(), limit = 50, maxProjects = 25,
): Promise<PortfolioCoordinationBriefing> {
  const projRes = await tenantQuery(tenantId,
    `SELECT id FROM projects
       WHERE tenant_id=$1 AND status NOT IN ('completed','closed','cancelled','archived')
       ORDER BY updated_at DESC LIMIT $2`, [tenantId, maxProjects])
  const projectIds = (projRes.rows as { id: string }[]).map(r => r.id)

  const briefings = await Promise.all(projectIds.map(id => buildProjectCoordination(tenantId, id, now, limit)))

  const issues: PortfolioCoordinationItem[] = []
  for (const b of briefings) {
    if (!b) continue
    for (const it of b.issues) issues.push({ ...it, projectId: b.project.id, projectName: b.project.name })
  }
  issues.sort((a, b) =>
    b.score - a.score ||
    (b.daysOverdue ?? -Infinity) - (a.daysOverdue ?? -Infinity) ||
    a.category.localeCompare(b.category),
  )
  const critical = issues.filter(i => i.severity === 'critical').length
  const high = issues.filter(i => i.severity === 'high').length
  const headline = issues.length === 0
    ? `All ${projectIds.length} active project${projectIds.length === 1 ? '' : 's'} are in sync — no coordination issues detected.`
    : `${critical} critical and ${high} high-priority coordination issue${critical + high === 1 ? '' : 's'} across ${projectIds.length} active project${projectIds.length === 1 ? '' : 's'}.`

  return {
    generatedAt: now.toISOString(),
    headline,
    summary: { projects: projectIds.length, total: issues.length, critical, high },
    issues: issues.slice(0, limit),
  }
}
