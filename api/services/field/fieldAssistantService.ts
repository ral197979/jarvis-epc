/**
 * Denver Engineering — AI Field Assistant (v4.48.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8 field assistant. Answers the three canonical superintendent questions
 * for a project, deterministically and grounded in real data:
 *   • "What inspections are due today?" — scheduled inspections due/overdue
 *   • "What is behind schedule?"        — out-of-sequence tasks + overdue punch
 *   • "What is open in Area B?"         — open items grouped by location
 *
 * Inspections and punch items carry `location`, so the briefing is area-aware.
 * `buildFieldBriefing` is a PURE function over fetched rows — unit-tested.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export type FieldItemType = 'inspection' | 'punch' | 'schedule'
export type Severity = 'high' | 'medium' | 'low'

export interface FieldItem {
  type: FieldItemType
  ref: string
  title: string
  location: string | null
  status: string
  note: string
  dueDate: string | null
  daysOverdue: number | null
  severity: Severity
}

export interface FieldBriefing {
  generatedAt: string
  areas: string[]
  summary: { inspectionsDue: number; behindSchedule: number; openItems: number }
  inspectionsDue: FieldItem[]
  behindSchedule: FieldItem[]
  openItems: FieldItem[]
}

type Dateish = string | Date | null | undefined
interface InspectionRow { id: string; inspection_number?: string; title?: string; status?: string; scheduled_date?: Dateish; overall_result?: string | null; location?: string | null }
interface PunchRow { id: string; item_number?: number; title?: string; priority?: string; status?: string; due_date?: Dateish; location?: string | null }
interface ScheduleClashRow { succ_id: string; succ_name?: string; succ_status?: string; pred_name?: string; pred_status?: string }

export interface FieldInputs {
  inspections: InspectionRow[]
  punchItems: PunchRow[]
  scheduleClashes: ScheduleClashRow[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(v: Dateish): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}
function daysOverdueOf(due: Date | null, now: Date): number | null {
  if (!due) return null
  // Compare by calendar day so "due today" reads as 0, not negative hours.
  const d0 = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())
  const n0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.floor((n0 - d0) / 86_400_000)
}
const isoDay = (v: Dateish) => toDate(v)?.toISOString().slice(0, 10) ?? null
const sevByOverdue = (d: number | null): Severity => (d != null && d >= 3 ? 'high' : d != null && d >= 0 ? 'medium' : 'low')

// ─── Pure synthesis ───────────────────────────────────────────────────────────

export function buildFieldBriefing(inputs: FieldInputs, now: Date = new Date()): FieldBriefing {
  // Inspections due today or overdue (scheduled, not yet done)
  const inspectionsDue: FieldItem[] = inputs.inspections
    .filter(i => i.status === 'scheduled')
    .map(i => {
      const od = daysOverdueOf(toDate(i.scheduled_date), now)
      return { ins: i, od }
    })
    .filter(({ od }) => od != null && od >= 0)
    .map(({ ins, od }) => ({
      type: 'inspection' as const,
      ref: ins.inspection_number ? `INSP ${ins.inspection_number}` : `INSP ${ins.id.slice(0, 8)}`,
      title: ins.title ?? '',
      location: ins.location ?? null,
      status: ins.status ?? 'scheduled',
      note: od! > 0 ? `${od} day${od === 1 ? '' : 's'} overdue` : 'due today',
      dueDate: isoDay(ins.scheduled_date),
      daysOverdue: od,
      severity: sevByOverdue(od),
    }))
    .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0))

  // Behind schedule: out-of-sequence tasks + overdue open punch items
  const behindSchedule: FieldItem[] = [
    ...inputs.scheduleClashes.map(c => ({
      type: 'schedule' as const,
      ref: `Task ${c.succ_id.slice(0, 8)}`,
      title: c.succ_name ?? '',
      location: null,
      status: c.succ_status ?? 'in_progress',
      note: `out of sequence — predecessor "${c.pred_name ?? ''}" is ${c.pred_status ?? 'incomplete'}`,
      dueDate: null,
      daysOverdue: null,
      severity: 'high' as Severity,
    })),
    ...inputs.punchItems
      .map(p => ({ p, od: daysOverdueOf(toDate(p.due_date), now) }))
      .filter(({ p, od }) => p.status === 'open' && od != null && od > 0)
      .map(({ p, od }) => ({
        type: 'punch' as const,
        ref: `Punch #${p.item_number ?? p.id.slice(0, 8)}`,
        title: p.title ?? '',
        location: p.location ?? null,
        status: p.status ?? 'open',
        note: `${od} day${od === 1 ? '' : 's'} overdue (${p.priority ?? 'medium'})`,
        dueDate: isoDay(p.due_date),
        daysOverdue: od,
        severity: sevByOverdue(od),
      })),
  ].sort((a, b) => (b.daysOverdue ?? 99) - (a.daysOverdue ?? 99))

  // Open items by area: open punch + scheduled/failed inspections, with location
  const openItems: FieldItem[] = [
    ...inputs.punchItems.filter(p => p.status === 'open').map(p => {
      const od = daysOverdueOf(toDate(p.due_date), now)
      return {
        type: 'punch' as const,
        ref: `Punch #${p.item_number ?? p.id.slice(0, 8)}`,
        title: p.title ?? '',
        location: p.location ?? null,
        status: p.status ?? 'open',
        note: p.priority ? `${p.priority} priority` : 'open',
        dueDate: isoDay(p.due_date),
        daysOverdue: od,
        severity: (p.priority === 'critical' || p.priority === 'high') ? 'high' : od != null && od > 0 ? 'medium' : 'low' as Severity,
      }
    }),
    ...inputs.inspections.filter(i => i.status === 'scheduled' || (i.overall_result ?? '').toLowerCase() === 'fail').map(i => {
      const failed = (i.overall_result ?? '').toLowerCase() === 'fail'
      return {
        type: 'inspection' as const,
        ref: i.inspection_number ? `INSP ${i.inspection_number}` : `INSP ${i.id.slice(0, 8)}`,
        title: i.title ?? '',
        location: i.location ?? null,
        status: failed ? 'failed' : (i.status ?? 'scheduled'),
        note: failed ? 'failed — needs corrective action' : 'scheduled',
        dueDate: isoDay(i.scheduled_date),
        daysOverdue: daysOverdueOf(toDate(i.scheduled_date), now),
        severity: (failed ? 'high' : 'low') as Severity,
      }
    }),
  ]

  const areas = [...new Set(openItems.map(i => i.location).filter((l): l is string => !!l))].sort()

  return {
    generatedAt: now.toISOString(),
    areas,
    summary: { inspectionsDue: inspectionsDue.length, behindSchedule: behindSchedule.length, openItems: openItems.length },
    inspectionsDue,
    behindSchedule,
    openItems,
  }
}

// ─── DB-backed builder ────────────────────────────────────────────────────────

export async function buildProjectFieldBriefing(tenantId: string, projectId: string, now: Date = new Date()): Promise<FieldBriefing | null> {
  const projRes = await tenantQuery(tenantId, `SELECT id FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  if (!projRes.rows[0]) return null

  const [inspections, punchItems, scheduleClashes] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT id, inspection_number, title, status, scheduled_date, overall_result, location
         FROM inspections WHERE tenant_id=$1 AND project_id=$2 AND (status='scheduled' OR overall_result='fail') LIMIT 1000`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT id, item_number, title, priority, status, due_date, location
         FROM punch_items WHERE tenant_id=$1 AND project_id=$2 AND status='open' LIMIT 1000`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT s.id AS succ_id, s.name AS succ_name, s.status AS succ_status, p.name AS pred_name, p.status AS pred_status
         FROM schedule_dependencies d
         JOIN schedule_tasks s ON s.id = d.successor_id AND s.tenant_id=$1
         JOIN schedule_tasks p ON p.id = d.predecessor_id AND p.tenant_id=$1
        WHERE d.tenant_id=$1 AND s.project_id=$2 AND s.status='in_progress' AND p.status <> 'complete' LIMIT 500`, [tenantId, projectId]),
  ])

  return buildFieldBriefing({
    inspections: inspections.rows as InspectionRow[],
    punchItems: punchItems.rows as PunchRow[],
    scheduleClashes: scheduleClashes.rows as ScheduleClashRow[],
  }, now)
}
