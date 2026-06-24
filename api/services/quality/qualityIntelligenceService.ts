/**
 * Denver Engineering — Quality Intelligence (v4.51.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * AI Quality Intelligence (vision Phase 9 — "identify recurring issues, risk
 * trends, contractor performance"). For a project it produces, deterministically
 * and grounded in real data (inspections + punch items):
 *   • recurringIssues       — the most frequent failure/defect categories (discipline + keyword)
 *   • disciplinePerformance — per discipline: inspection fail rate, open punch, close speed, quality score
 *   • hotspots              — locations with the most open quality issues
 *
 * The analysis (`analyzeQuality`) is a PURE function over fetched rows — testable,
 * explainable, no LLM.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InspectionRow { discipline?: string | null; location?: string | null; title?: string | null; status?: string | null; overall_result?: string | null }
export interface PunchRow { discipline?: string | null; location?: string | null; title?: string | null; status?: string | null; created_at?: string | Date | null; closed_at?: string | Date | null }

export interface RecurringIssue { category: string; discipline: string; count: number; examples: string[] }
export interface DisciplinePerf {
  discipline: string
  inspections: number; inspectionsFailed: number; failRatePct: number
  punchTotal: number; punchOpen: number; avgDaysToClose: number | null
  qualityScore: number   // 0–100, higher is better
}
export interface Hotspot { location: string; openIssues: number }

export interface QualityIntelligence {
  generatedAt: string
  headline: string
  summary: { inspections: number; failedInspections: number; punchTotal: number; punchOpen: number; recurringIssues: number }
  recurringIssues: RecurringIssue[]
  disciplinePerformance: DisciplinePerf[]
  hotspots: Hotspot[]
}

export interface QualityInputs { inspections: InspectionRow[]; punchItems: PunchRow[] }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const OPEN_PUNCH = new Set(['open', 'in_progress'])
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'inspection', 'item', 'punch', 'general', 'area', 'check'])

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}
function keyword(title: string | null | undefined): string {
  if (!title) return 'general'
  const w = title.toLowerCase().split(/[^a-z0-9]+/).find(t => t.length >= 4 && !STOPWORDS.has(t))
  return w ?? 'general'
}
const disc = (d: string | null | undefined) => (d && d.trim()) ? d.trim() : 'Unassigned'
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

// ─── Pure analysis ────────────────────────────────────────────────────────────

export function analyzeQuality(inputs: QualityInputs, now: Date = new Date()): QualityIntelligence {
  const failedInspections = inputs.inspections.filter(i => (i.overall_result ?? '').toLowerCase() === 'fail')
  const openPunch = inputs.punchItems.filter(p => OPEN_PUNCH.has((p.status ?? '').toLowerCase()))

  // ── Recurring issues: cluster failures + punch by discipline + keyword ──
  const clusters = new Map<string, { discipline: string; category: string; count: number; examples: string[] }>()
  const addCluster = (d: string | null | undefined, title: string | null | undefined) => {
    const discipline = disc(d)
    const category = keyword(title)
    const key = `${discipline}|${category}`
    const c = clusters.get(key) ?? { discipline, category, count: 0, examples: [] }
    c.count++
    if (title && c.examples.length < 3 && !c.examples.includes(title)) c.examples.push(title)
    clusters.set(key, c)
  }
  for (const i of failedInspections) addCluster(i.discipline, i.title)
  for (const p of openPunch) addCluster(p.discipline, p.title)
  const recurringIssues: RecurringIssue[] = [...clusters.values()]
    .filter(c => c.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(c => ({ category: c.category, discipline: c.discipline, count: c.count, examples: c.examples }))

  // ── Discipline performance ──
  const byDisc = new Map<string, { insp: number; inspFail: number; punch: number; punchOpen: number; closeDays: number[] }>()
  const ensure = (d: string) => {
    const x = byDisc.get(d) ?? { insp: 0, inspFail: 0, punch: 0, punchOpen: 0, closeDays: [] }
    byDisc.set(d, x); return x
  }
  for (const i of inputs.inspections) {
    const x = ensure(disc(i.discipline)); x.insp++
    if ((i.overall_result ?? '').toLowerCase() === 'fail') x.inspFail++
  }
  for (const p of inputs.punchItems) {
    const x = ensure(disc(p.discipline)); x.punch++
    if (OPEN_PUNCH.has((p.status ?? '').toLowerCase())) x.punchOpen++
    const created = toDate(p.created_at), closed = toDate(p.closed_at)
    if (created && closed) x.closeDays.push(Math.max(0, (closed.getTime() - created.getTime()) / 86_400_000))
  }
  const disciplinePerformance: DisciplinePerf[] = [...byDisc.entries()].map(([discipline, x]) => {
    const failRatePct = x.insp > 0 ? Math.round((x.inspFail / x.insp) * 1000) / 10 : 0
    const avgDaysToClose = x.closeDays.length ? Math.round((x.closeDays.reduce((s, d) => s + d, 0) / x.closeDays.length) * 10) / 10 : null
    // Quality score: start 100, penalise fail rate, open-punch density, slow closeout.
    let score = 100
    score -= Math.min(45, failRatePct * 1.5)
    score -= Math.min(30, x.punchOpen * 4)
    if (avgDaysToClose != null) score -= Math.min(15, avgDaysToClose / 7 * 3)
    return { discipline, inspections: x.insp, inspectionsFailed: x.inspFail, failRatePct, punchTotal: x.punch, punchOpen: x.punchOpen, avgDaysToClose, qualityScore: clamp(score) }
  }).sort((a, b) => a.qualityScore - b.qualityScore)  // worst first

  // ── Hotspots: locations with most open quality issues ──
  const byLoc = new Map<string, number>()
  for (const p of openPunch) { const l = (p.location && p.location.trim()) || null; if (l) byLoc.set(l, (byLoc.get(l) ?? 0) + 1) }
  for (const i of failedInspections) { const l = (i.location && i.location.trim()) || null; if (l) byLoc.set(l, (byLoc.get(l) ?? 0) + 1) }
  const hotspots: Hotspot[] = [...byLoc.entries()].map(([location, openIssues]) => ({ location, openIssues }))
    .sort((a, b) => b.openIssues - a.openIssues).slice(0, 8)

  const headline = (inputs.inspections.length === 0 && inputs.punchItems.length === 0)
    ? 'No inspection or punch data yet for quality analysis.'
    : `${failedInspections.length} failed inspection${failedInspections.length === 1 ? '' : 's'} and ${openPunch.length} open defect${openPunch.length === 1 ? '' : 's'}; ${recurringIssues.length} recurring issue pattern${recurringIssues.length === 1 ? '' : 's'} detected.`

  return {
    generatedAt: now.toISOString(),
    headline,
    summary: {
      inspections: inputs.inspections.length,
      failedInspections: failedInspections.length,
      punchTotal: inputs.punchItems.length,
      punchOpen: openPunch.length,
      recurringIssues: recurringIssues.length,
    },
    recurringIssues, disciplinePerformance, hotspots,
  }
}

// ─── DB-backed builder ────────────────────────────────────────────────────────

export async function buildQualityIntelligence(tenantId: string, projectId: string, now: Date = new Date()): Promise<QualityIntelligence | null> {
  const projRes = await tenantQuery(tenantId, `SELECT id FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  if (!projRes.rows[0]) return null

  const [inspections, punch] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT discipline, location, title, status, overall_result
         FROM inspections WHERE tenant_id=$1 AND project_id=$2 LIMIT 3000`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT discipline, location, title, status, created_at, closed_at
         FROM punch_items WHERE tenant_id=$1 AND project_id=$2 LIMIT 5000`, [tenantId, projectId]),
  ])

  return analyzeQuality({ inspections: inspections.rows as InspectionRow[], punchItems: punch.rows as PunchRow[] }, now)
}
