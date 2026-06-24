/**
 * Denver Engineering — Procurement Risk Engine (v4.52.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Predict procurement blockers (vision Phase 7 — "predict late equipment, supply
 * chain risks, procurement blockers"). Over the project's purchase orders it
 * scores, deterministically and grounded in real data:
 *   • per-PO delivery risk — overdue / arriving-late / not-issued / partial
 *   • vendor (supply-chain) rollup — vendors carrying the most at-risk value
 *
 * `analyzeProcurementRisk` is a PURE function over fetched rows — testable,
 * explainable, no LLM.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskType = 'overdue' | 'arriving_late' | 'not_issued' | 'need_approaching' | 'partial'

export interface PoRow {
  id: string; po_number?: string; title?: string; vendor_id?: string | null; vendor_name?: string | null
  status?: string; required_date?: string | Date | null; delivery_date?: string | Date | null
  total_amount?: unknown; received_amount?: unknown
}
export interface ProcurementRiskItem {
  poId: string; poNumber: string; title: string; vendor: string | null
  riskType: RiskType; severity: 'critical' | 'high' | 'medium' | 'low'; score: number
  daysToNeed: number | null; amountAtRisk: number; reason: string; recommendedAction: string
}
export interface VendorRisk { vendor: string; atRiskPOs: number; amountAtRisk: number; worstSeverity: 'critical' | 'high' | 'medium' | 'low' }
export interface ProcurementRisk {
  generatedAt: string
  headline: string
  summary: { openPOs: number; atRisk: number; critical: number; high: number; amountAtRisk: number }
  items: ProcurementRiskItem[]
  vendorRisk: VendorRisk[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DELIVERED = new Set(['delivered', 'invoiced', 'closed', 'cancelled'])
const NOT_ISSUED = new Set(['draft', 'pending_approval', 'approved'])
const SEV_RANK = { critical: 3, high: 2, medium: 1, low: 0 } as const

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
function daysBetween(target: Date | null, now: Date): number | null {
  if (!target) return null
  return Math.floor((target.getTime() - now.getTime()) / 86_400_000)  // >0 = future need, <0 = overdue
}
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
function severityOf(score: number): ProcurementRiskItem['severity'] {
  if (score >= 75) return 'critical'
  if (score >= 55) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

// ─── Pure analysis ────────────────────────────────────────────────────────────

function poRisk(po: PoRow, now: Date, horizonDays: number): ProcurementRiskItem | null {
  const status = (po.status ?? '').toLowerCase()
  if (DELIVERED.has(status)) return null

  const required = toDate(po.required_date)
  const delivery = toDate(po.delivery_date)
  const daysToNeed = daysBetween(required, now)
  const notIssued = NOT_ISSUED.has(status)
  const partial = status === 'partial_delivery'
  const total = num(po.total_amount)
  const received = num(po.received_amount)
  const amountAtRisk = Math.max(0, total - received)

  let score = 0
  let riskType: RiskType = 'need_approaching'
  const reasons: string[] = []

  if (daysToNeed != null && daysToNeed < 0) {
    // Required date has passed and it isn't delivered.
    score = 62 + Math.min(28, Math.abs(daysToNeed) / 2)
    riskType = 'overdue'
    reasons.push(`required date passed ${Math.abs(daysToNeed)} day${Math.abs(daysToNeed) === 1 ? '' : 's'} ago`)
  } else if (daysToNeed != null && daysToNeed <= horizonDays) {
    // Need date approaching.
    score = 50 - (daysToNeed / horizonDays) * 35
    riskType = notIssued ? 'not_issued' : 'need_approaching'
    reasons.push(`needed in ${daysToNeed} day${daysToNeed === 1 ? '' : 's'}`)
  } else if (daysToNeed == null) {
    // No required date — mild risk only if not issued.
    if (!notIssued) return null
    score = 30
    riskType = 'not_issued'
    reasons.push('no required date set')
  } else {
    // Need far out and on track.
    if (delivery && required && delivery.getTime() > required.getTime() && !partial) {
      // still flag a promised-late delivery
    } else {
      return null
    }
  }

  if (notIssued) { score += 15; reasons.push('PO not yet issued to the vendor') }
  if (delivery && required && delivery.getTime() > required.getTime()) {
    const lateDays = Math.floor((delivery.getTime() - required.getTime()) / 86_400_000)
    score += 15; if (riskType === 'need_approaching') riskType = 'arriving_late'
    reasons.push(`promised delivery is ${lateDays} day${lateDays === 1 ? '' : 's'} after the need date`)
  }
  if (partial) { score -= 8; reasons.push('partially delivered') }

  score = clamp(score)
  if (score < 40) return null  // only surface material risk

  const recommendedAction = notIssued
    ? 'Issue the PO now — lead time is at risk; consider expediting or an alternate source.'
    : riskType === 'overdue'
      ? 'Escalate with the vendor for an immediate delivery commitment; assess schedule impact.'
      : riskType === 'arriving_late'
        ? 'Push the vendor to the need date or re-sequence the work that depends on it.'
        : 'Confirm the delivery commitment and track against the need date.'

  return {
    poId: po.id, poNumber: po.po_number ?? po.id.slice(0, 8), title: po.title ?? '', vendor: po.vendor_name ?? null,
    riskType, severity: severityOf(score), score, daysToNeed, amountAtRisk,
    reason: reasons.join('; ') + '.', recommendedAction,
  }
}

export function analyzeProcurementRisk(pos: PoRow[], now: Date = new Date(), horizonDays = 45): ProcurementRisk {
  const open = pos.filter(p => !DELIVERED.has((p.status ?? '').toLowerCase()))
  const items = open.map(p => poRisk(p, now, horizonDays)).filter((x): x is ProcurementRiskItem => x !== null)
    .sort((a, b) => b.score - a.score || b.amountAtRisk - a.amountAtRisk)

  // Vendor rollup.
  const byVendor = new Map<string, { atRiskPOs: number; amountAtRisk: number; worst: ProcurementRiskItem['severity'] }>()
  for (const it of items) {
    const v = it.vendor ?? 'Unknown vendor'
    const e = byVendor.get(v) ?? { atRiskPOs: 0, amountAtRisk: 0, worst: 'low' as ProcurementRiskItem['severity'] }
    e.atRiskPOs++; e.amountAtRisk += it.amountAtRisk
    if (SEV_RANK[it.severity] > SEV_RANK[e.worst]) e.worst = it.severity
    byVendor.set(v, e)
  }
  const vendorRisk: VendorRisk[] = [...byVendor.entries()]
    .map(([vendor, e]) => ({ vendor, atRiskPOs: e.atRiskPOs, amountAtRisk: Math.round(e.amountAtRisk), worstSeverity: e.worst }))
    .sort((a, b) => b.amountAtRisk - a.amountAtRisk)

  const critical = items.filter(i => i.severity === 'critical').length
  const high = items.filter(i => i.severity === 'high').length
  const amountAtRisk = Math.round(items.reduce((s, i) => s + i.amountAtRisk, 0))
  const headline = open.length === 0
    ? 'No open purchase orders to assess.'
    : items.length === 0
      ? `${open.length} open PO${open.length === 1 ? '' : 's'}, all tracking to their need dates.`
      : `${items.length} of ${open.length} open POs at risk (${critical} critical, ${high} high) — ${money(amountAtRisk)} of deliveries exposed.`

  return {
    generatedAt: now.toISOString(),
    headline,
    summary: { openPOs: open.length, atRisk: items.length, critical, high, amountAtRisk },
    items, vendorRisk,
  }
}

// ─── DB-backed builder ────────────────────────────────────────────────────────

export async function buildProcurementRisk(tenantId: string, projectId: string, now: Date = new Date()): Promise<ProcurementRisk | null> {
  const projRes = await tenantQuery(tenantId, `SELECT id FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  if (!projRes.rows[0]) return null

  const res = await tenantQuery(tenantId,
    `SELECT po.id, po.po_number, po.title, po.vendor_id, v.name AS vendor_name, po.status,
            po.required_date, po.delivery_date, po.total_amount, po.received_amount
       FROM purchase_orders po
       LEFT JOIN vendors v ON v.id = po.vendor_id AND v.tenant_id = po.tenant_id
      WHERE po.tenant_id=$1 AND po.project_id=$2
        AND po.status NOT IN ('delivered','invoiced','closed','cancelled')
      LIMIT 3000`, [tenantId, projectId])

  return analyzeProcurementRisk(res.rows as PoRow[], now)
}
