/**
 * Denver Engineering — NCR / CAPA (v4.55.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 9 — the NCR → CAPA → root-cause quality workflow. Non-conformance reports
 * with tracked corrective/preventive actions, plus a deterministic summary:
 *   • status / severity breakdown of open NCRs
 *   • overdue corrective actions
 *   • recurring root-cause patterns
 *   • aging (avg open age, avg days-to-close) + CAPA verification rate
 *
 * `analyzeNcr` is a PURE function over fetched rows — testable, no LLM.
 */
import { tenantQuery, tenantTransaction } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NcrRow { id?: string; severity?: string; status?: string; root_cause?: string | null; raised_at?: string | Date | null; closed_at?: string | Date | null }
export interface CapaRow { status?: string; due_date?: string | Date | null; description?: string | null }

export interface NcrSummary {
  generatedAt: string
  headline: string
  totals: { ncrs: number; open: number; closed: number; openCritical: number; openMajor: number }
  byStatus: Record<string, number>
  overdueCapas: number
  capaVerificationRatePct: number | null
  recurringRootCauses: { cause: string; count: number }[]
  aging: { avgOpenAgeDays: number | null; avgDaysToClose: number | null }
}

const CLOSED = 'closed'
const CAPA_DONE = new Set(['completed', 'verified'])
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'was', 'were', 'due', 'lack', 'not', 'from', 'caused', 'failure'])

function toDate(v: string | Date | null | undefined): Date | null { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : d }
function ageDays(a: Date, b: Date): number { return Math.floor((a.getTime() - b.getTime()) / 86_400_000) }
/** Significant tokens (deduped) for a root-cause string — used to find recurring themes. */
function tokenSet(text: string | null | undefined): Set<string> {
  if (!text) return new Set()
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !STOPWORDS.has(t)))
}
function avg(xs: number[]): number | null { return xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null }

// ─── Pure analysis ────────────────────────────────────────────────────────────

export function analyzeNcr(ncrs: NcrRow[], capas: CapaRow[], now: Date = new Date()): NcrSummary {
  const open = ncrs.filter(n => (n.status ?? '').toLowerCase() !== CLOSED)
  const closed = ncrs.filter(n => (n.status ?? '').toLowerCase() === CLOSED)

  const byStatus: Record<string, number> = {}
  for (const n of ncrs) { const s = (n.status ?? 'open').toLowerCase(); byStatus[s] = (byStatus[s] ?? 0) + 1 }

  const openCritical = open.filter(n => (n.severity ?? '').toLowerCase() === 'critical').length
  const openMajor = open.filter(n => (n.severity ?? '').toLowerCase() === 'major').length

  const overdueCapas = capas.filter(c => {
    if (CAPA_DONE.has((c.status ?? '').toLowerCase())) return false
    const due = toDate(c.due_date)
    return due != null && ageDays(now, due) > 0
  }).length

  const verifiedCapas = capas.filter(c => (c.status ?? '').toLowerCase() === 'verified').length
  const capaVerificationRatePct = capas.length ? Math.round((verifiedCapas / capas.length) * 1000) / 10 : null

  // Recurring root causes: tally significant tokens across NCRs and surface any
  // theme appearing in 2+ NCRs (token-set per NCR, so a word counts once each).
  const tally = new Map<string, number>()
  for (const n of ncrs) { for (const t of tokenSet(n.root_cause)) tally.set(t, (tally.get(t) ?? 0) + 1) }
  const recurringRootCauses = [...tally.entries()]
    .filter(([, c]) => c >= 2)
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count).slice(0, 8)

  const avgOpenAgeDays = avg(open.map(n => { const r = toDate(n.raised_at); return r ? Math.max(0, ageDays(now, r)) : null }).filter((x): x is number => x != null))
  const avgDaysToClose = avg(closed.map(n => { const r = toDate(n.raised_at), c = toDate(n.closed_at); return r && c ? Math.max(0, ageDays(c, r)) : null }).filter((x): x is number => x != null))

  const headline = ncrs.length === 0
    ? 'No NCRs raised yet on this project.'
    : `${open.length} open NCR${open.length === 1 ? '' : 's'} (${openCritical} critical, ${openMajor} major); ${overdueCapas} overdue corrective action${overdueCapas === 1 ? '' : 's'}.`

  return {
    generatedAt: now.toISOString(),
    headline,
    totals: { ncrs: ncrs.length, open: open.length, closed: closed.length, openCritical, openMajor },
    byStatus,
    overdueCapas,
    capaVerificationRatePct,
    recurringRootCauses,
    aging: { avgOpenAgeDays, avgDaysToClose },
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listNcrs(tenantId: string, projectId: string) {
  const res = await tenantQuery(tenantId,
    `SELECT n.id, n.ncr_number, n.title, n.severity, n.status, n.disposition, n.discipline, n.location,
            n.source, n.source_ref, n.root_cause, n.raised_at, n.closed_at,
            COUNT(c.id)::int AS capa_count,
            SUM(CASE WHEN c.status IN ('open','in_progress') THEN 1 ELSE 0 END)::int AS open_capas
       FROM ncrs n
       LEFT JOIN corrective_actions c ON c.ncr_id = n.id AND c.tenant_id = n.tenant_id
      WHERE n.tenant_id=$1 AND n.project_id=$2
      GROUP BY n.id
      ORDER BY n.ncr_number DESC LIMIT 1000`, [tenantId, projectId])
  return res.rows
}

export async function createNcr(
  tenantId: string, projectId: string,
  b: { title: string; description?: string; severity?: string; discipline?: string; location?: string; source?: string; source_ref?: string },
  userId: string | null,
) {
  return tenantTransaction(tenantId, async (client) => {
    const n = await client.query(`SELECT COALESCE(MAX(ncr_number),0)+1 AS next FROM ncrs WHERE tenant_id=$1 AND project_id=$2`, [tenantId, projectId])
    const next = n.rows[0].next as number
    const res = await client.query(
      `INSERT INTO ncrs (tenant_id, project_id, ncr_number, title, description, severity, discipline, location, source, source_ref, raised_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'minor')::ncr_severity,$7,$8,$9,$10,$11)
       RETURNING id, ncr_number, title, severity, status, disposition, source, source_ref, raised_at`,
      [tenantId, projectId, next, b.title, b.description ?? null, b.severity ?? null, b.discipline ?? null, b.location ?? null, b.source ?? null, b.source_ref ?? null, userId])
    return res.rows[0]
  })
}

export async function updateNcr(
  tenantId: string, id: string, b: { status?: string; disposition?: string; root_cause?: string },
) {
  const sets: string[] = ['updated_at=NOW()']
  const vals: unknown[] = [tenantId, id]
  if (b.status) { vals.push(b.status); sets.push(`status=$${vals.length}::ncr_status`); if (b.status === 'closed') sets.push('closed_at=CURRENT_DATE') }
  if (b.disposition) { vals.push(b.disposition); sets.push(`disposition=$${vals.length}::ncr_disposition`) }
  if (b.root_cause != null) { vals.push(b.root_cause); sets.push(`root_cause=$${vals.length}`) }
  const res = await tenantQuery(tenantId,
    `UPDATE ncrs SET ${sets.join(',')} WHERE tenant_id=$1 AND id=$2
      RETURNING id, ncr_number, status, disposition, root_cause, closed_at`, vals)
  return res.rows[0] ?? null
}

export async function listCorrectiveActions(tenantId: string, ncrId: string) {
  const res = await tenantQuery(tenantId,
    `SELECT id, ncr_id, type, description, status, assigned_to, due_date, completed_at, verified_at
       FROM corrective_actions WHERE tenant_id=$1 AND ncr_id=$2 ORDER BY created_at LIMIT 500`, [tenantId, ncrId])
  return res.rows
}

export async function createCorrectiveAction(
  tenantId: string, ncrId: string,
  b: { description: string; type?: string; assigned_to?: string; due_date?: string },
) {
  // Derive project_id from the parent NCR so the FK + RLS stay consistent.
  const proj = await tenantQuery(tenantId, `SELECT project_id FROM ncrs WHERE tenant_id=$1 AND id=$2`, [tenantId, ncrId])
  if (!proj.rows[0]) return null
  const res = await tenantQuery(tenantId,
    `INSERT INTO corrective_actions (tenant_id, ncr_id, project_id, type, description, assigned_to, due_date)
     VALUES ($1,$2,$3,COALESCE($4,'corrective')::capa_type,$5,$6,$7::date)
     RETURNING id, ncr_id, type, description, status, due_date`,
    [tenantId, ncrId, proj.rows[0].project_id, b.type ?? null, b.description, b.assigned_to ?? null, b.due_date ?? null])
  return res.rows[0]
}

export async function updateCorrectiveActionStatus(tenantId: string, id: string, status: string) {
  const stamp = status === 'completed' ? ', completed_at=CURRENT_DATE' : status === 'verified' ? ', verified_at=CURRENT_DATE' : ''
  const res = await tenantQuery(tenantId,
    `UPDATE corrective_actions SET status=$3::capa_status, updated_at=NOW()${stamp}
      WHERE tenant_id=$1 AND id=$2 RETURNING id, status`, [tenantId, id, status])
  return res.rows[0] ?? null
}

export async function buildNcrSummary(tenantId: string, projectId: string, now: Date = new Date()): Promise<NcrSummary | null> {
  const projRes = await tenantQuery(tenantId, `SELECT id FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  if (!projRes.rows[0]) return null
  const [ncrs, capas] = await Promise.all([
    tenantQuery(tenantId, `SELECT severity, status, root_cause, raised_at, closed_at FROM ncrs WHERE tenant_id=$1 AND project_id=$2 LIMIT 5000`, [tenantId, projectId]),
    tenantQuery(tenantId, `SELECT status, due_date, description FROM corrective_actions WHERE tenant_id=$1 AND project_id=$2 LIMIT 5000`, [tenantId, projectId]),
  ])
  return analyzeNcr(ncrs.rows as NcrRow[], capas.rows as CapaRow[], now)
}
