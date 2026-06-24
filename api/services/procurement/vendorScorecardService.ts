/**
 * Denver Engineering — Vendor Scorecard (v4.59.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * The vendor is the one entity that links across modules, so this synthesizes a
 * per-vendor standing from real data:
 *   • commitments — subcontract count + committed value, approved billing
 *   • delivery     — purchase-order on-time rate + open at-risk POs
 *   • a 0–100 score and a strong/fair/weak standing
 *
 * `analyzeVendorScorecard` is a PURE function over fetched rows — testable, no LLM.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubRow { id: string; vendor_id?: string | null; vendor_name?: string | null; status?: string; contract_value?: unknown }
export interface PoRow { vendor_id?: string | null; vendor_name?: string | null; status?: string; total_amount?: unknown; required_date?: string | Date | null; delivery_date?: string | Date | null }
export interface InvRow { subcontract_id: string; gross_amount?: unknown; status?: string }

export interface VendorScore {
  vendorId: string; vendor: string | null; standing: 'strong' | 'fair' | 'weak'; score: number
  subcontracts: number; committedValue: number; billedValue: number; pctBilled: number
  pos: number; poOnTimeRatePct: number | null; atRiskOpenPos: number
}
export interface VendorScorecard {
  generatedAt: string
  headline: string
  summary: { vendors: number; weak: number }
  vendors: VendorScore[]
}

const PO_TERMINAL = new Set(['delivered', 'invoiced', 'closed'])
const PO_OPEN_EXCLUDE = new Set(['delivered', 'invoiced', 'closed', 'cancelled'])
const SC_TERMINATED = 'terminated'

function num(v: unknown): number { if (v == null) return 0; const n = typeof v === 'number' ? v : Number(v); return isNaN(n) ? 0 : n }
function toDate(v: string | Date | null | undefined): Date | null { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return isNaN(d.getTime()) ? null : d }
const r2 = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

// ─── Pure analysis ────────────────────────────────────────────────────────────

export function analyzeVendorScorecard(subs: SubRow[], pos: PoRow[], invoices: InvRow[], now: Date = new Date()): VendorScorecard {
  // subcontract → vendor, and approved billing per subcontract.
  const subVendor = new Map<string, string>()
  for (const s of subs) if (s.vendor_id) subVendor.set(s.id, s.vendor_id)
  const billedBySub = new Map<string, number>()
  for (const inv of invoices) {
    if ((inv.status ?? '').toLowerCase() !== 'approved') continue
    billedBySub.set(inv.subcontract_id, (billedBySub.get(inv.subcontract_id) ?? 0) + num(inv.gross_amount))
  }

  interface Acc { name: string | null; subs: number; committed: number; billed: number; pos: number; delivered: number; late: number; atRisk: number }
  const byVendor = new Map<string, Acc>()
  const ensure = (id: string, name: string | null): Acc => {
    const a = byVendor.get(id) ?? { name, subs: 0, committed: 0, billed: 0, pos: 0, delivered: 0, late: 0, atRisk: 0 }
    if (!a.name && name) a.name = name
    byVendor.set(id, a); return a
  }

  for (const s of subs) {
    if (!s.vendor_id) continue
    const a = ensure(s.vendor_id, s.vendor_name ?? null)
    a.subs++
    if ((s.status ?? '').toLowerCase() !== SC_TERMINATED) a.committed += num(s.contract_value)
    a.billed += billedBySub.get(s.id) ?? 0
  }

  for (const po of pos) {
    if (!po.vendor_id) continue
    const a = ensure(po.vendor_id, po.vendor_name ?? null)
    a.pos++
    const status = (po.status ?? '').toLowerCase()
    const reqd = toDate(po.required_date), deliv = toDate(po.delivery_date)
    if (PO_TERMINAL.has(status) && reqd && deliv) { a.delivered++; if (deliv.getTime() > reqd.getTime()) a.late++ }
    if (!PO_OPEN_EXCLUDE.has(status)) {
      const overdue = reqd != null && reqd.getTime() < now.getTime()
      const forecastLate = reqd != null && deliv != null && deliv.getTime() > reqd.getTime()
      if (overdue || forecastLate) a.atRisk++
    }
  }

  const vendors: VendorScore[] = [...byVendor.entries()].map(([vendorId, a]) => {
    const onTime = a.delivered > 0 ? r2(((a.delivered - a.late) / a.delivered) * 100) : null
    let score = 100
    if (onTime != null) score -= (100 - onTime) * 0.6
    score -= Math.min(30, a.atRisk * 10)
    const s = clamp(score)
    return {
      vendorId, vendor: a.name, score: s, standing: (s >= 75 ? 'strong' : s >= 50 ? 'fair' : 'weak') as VendorScore['standing'],
      subcontracts: a.subs, committedValue: r2(a.committed), billedValue: r2(a.billed),
      pctBilled: a.committed > 0 ? r2((a.billed / a.committed) * 100) : 0,
      pos: a.pos, poOnTimeRatePct: onTime, atRiskOpenPos: a.atRisk,
    }
  }).sort((x, y) => x.score - y.score || y.committedValue - x.committedValue)  // weakest first

  const weak = vendors.filter(v => v.standing === 'weak').length
  const headline = vendors.length === 0
    ? 'No vendors with subcontracts or purchase orders on this project.'
    : `${vendors.length} vendor${vendors.length === 1 ? '' : 's'} scored — ${weak} weak; ${money(vendors.reduce((s, v) => s + v.committedValue, 0))} committed.`

  return { generatedAt: now.toISOString(), headline, summary: { vendors: vendors.length, weak }, vendors }
}

// ─── DB-backed builder ────────────────────────────────────────────────────────

export async function buildVendorScorecard(tenantId: string, projectId: string, now: Date = new Date()): Promise<VendorScorecard | null> {
  const projRes = await tenantQuery(tenantId, `SELECT id FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  if (!projRes.rows[0]) return null

  const [subs, pos] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT s.id, s.vendor_id, s.status, s.contract_value, v.name AS vendor_name
         FROM subcontracts s LEFT JOIN vendors v ON v.id=s.vendor_id AND v.tenant_id=s.tenant_id
        WHERE s.tenant_id=$1 AND s.project_id=$2 LIMIT 2000`, [tenantId, projectId]),
    tenantQuery(tenantId,
      `SELECT po.vendor_id, po.status, po.total_amount, po.required_date, po.delivery_date, v.name AS vendor_name
         FROM purchase_orders po LEFT JOIN vendors v ON v.id=po.vendor_id AND v.tenant_id=po.tenant_id
        WHERE po.tenant_id=$1 AND po.project_id=$2 LIMIT 5000`, [tenantId, projectId]),
  ])
  const subRows = subs.rows as SubRow[]
  const ids = subRows.map(s => s.id)
  const inv = ids.length
    ? await tenantQuery(tenantId, `SELECT subcontract_id, gross_amount, status FROM subcontract_invoices WHERE tenant_id=$1 AND subcontract_id = ANY($2) LIMIT 10000`, [tenantId, ids])
    : { rows: [] as InvRow[] }

  return analyzeVendorScorecard(subRows, pos.rows as PoRow[], inv.rows as InvRow[], now)
}
