/**
 * Denver Engineering — Commitment Rollup (v4.57.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Rolls the project's subcontracts + approved subcontract invoices into a
 * commitment picture for Cost Intelligence:
 *   • total committed (subcontract contract values, excluding terminated)
 *   • billed-to-date (approved invoices) + net paid + retention held
 *   • remaining-to-bill, and a per-subcontract breakdown
 *
 * `analyzeCommitments` is a PURE function over fetched rows — testable, no LLM.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SubcontractRow { id: string; sc_number?: number; title?: string; vendor_name?: string | null; status?: string; contract_value?: unknown; retention_pct?: unknown }
export interface ScInvoiceRow { subcontract_id: string; gross_amount?: unknown; net_amount?: unknown; status?: string }

export interface CommitmentLine {
  id: string; scNumber: number | null; title: string; vendor: string | null; status: string
  contractValue: number; billed: number; paidNet: number; retentionHeld: number; pctBilled: number; remaining: number
}
export interface CommitmentRollup {
  generatedAt: string
  headline: string
  totals: {
    subcontracts: number; activeSubcontracts: number
    committed: number; billed: number; paidNet: number; retentionHeld: number; remainingToBill: number; pctBilled: number
  }
  lines: CommitmentLine[]
}

const TERMINATED = 'terminated'
const APPROVED = 'approved'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(v: unknown): number { if (v == null) return 0; const n = typeof v === 'number' ? v : Number(v); return isNaN(n) ? 0 : n }
const r2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

// ─── Pure analysis ────────────────────────────────────────────────────────────

export function analyzeCommitments(subcontracts: SubcontractRow[], invoices: ScInvoiceRow[]): CommitmentRollup {
  // Approved billing per subcontract.
  const billedBySc = new Map<string, { gross: number; net: number }>()
  for (const inv of invoices) {
    if ((inv.status ?? '').toLowerCase() !== APPROVED) continue
    const e = billedBySc.get(inv.subcontract_id) ?? { gross: 0, net: 0 }
    e.gross += num(inv.gross_amount); e.net += num(inv.net_amount)
    billedBySc.set(inv.subcontract_id, e)
  }

  const lines: CommitmentLine[] = subcontracts.map(sc => {
    const contractValue = num(sc.contract_value)
    const b = billedBySc.get(sc.id) ?? { gross: 0, net: 0 }
    const billed = b.gross
    const paidNet = b.net
    const retentionHeld = Math.max(0, billed - paidNet)
    return {
      id: sc.id, scNumber: sc.sc_number ?? null, title: sc.title ?? '', vendor: sc.vendor_name ?? null, status: sc.status ?? 'active',
      contractValue: r2(contractValue), billed: r2(billed), paidNet: r2(paidNet), retentionHeld: r2(retentionHeld),
      pctBilled: contractValue > 0 ? r2((billed / contractValue) * 100) : 0,
      remaining: r2(contractValue - billed),
    }
  }).sort((a, b) => b.contractValue - a.contractValue)

  const live = subcontracts.filter(s => (s.status ?? '').toLowerCase() !== TERMINATED)
  const committed = r2(live.reduce((s, sc) => s + num(sc.contract_value), 0))
  const billed = r2(lines.reduce((s, l) => s + l.billed, 0))
  const paidNet = r2(lines.reduce((s, l) => s + l.paidNet, 0))
  const retentionHeld = r2(Math.max(0, billed - paidNet))
  const remainingToBill = r2(committed - billed)
  const pctBilled = committed > 0 ? r2((billed / committed) * 100) : 0

  const headline = subcontracts.length === 0
    ? 'No subcontracts committed on this project.'
    : `${money(committed)} committed across ${live.length} active subcontract${live.length === 1 ? '' : 's'}; ${money(billed)} billed (${pctBilled}%), ${money(retentionHeld)} retention held.`

  return {
    generatedAt: new Date().toISOString(),
    headline,
    totals: { subcontracts: subcontracts.length, activeSubcontracts: live.length, committed, billed, paidNet, retentionHeld, remainingToBill, pctBilled },
    lines: lines.slice(0, 50),
  }
}

// ─── DB-backed builder ────────────────────────────────────────────────────────

export async function buildCommitmentRollup(tenantId: string, projectId: string): Promise<CommitmentRollup | null> {
  const projRes = await tenantQuery(tenantId, `SELECT id FROM projects WHERE tenant_id=$1 AND id=$2`, [tenantId, projectId])
  if (!projRes.rows[0]) return null

  const subs = await tenantQuery(tenantId,
    `SELECT s.id, s.sc_number, s.title, s.status, s.contract_value, s.retention_pct, v.name AS vendor_name
       FROM subcontracts s
       LEFT JOIN vendors v ON v.id = s.vendor_id AND v.tenant_id = s.tenant_id
      WHERE s.tenant_id=$1 AND s.project_id=$2 LIMIT 2000`, [tenantId, projectId])
  const subRows = subs.rows as SubcontractRow[]
  if (subRows.length === 0) return analyzeCommitments([], [])

  const ids = subRows.map(s => s.id)
  const inv = await tenantQuery(tenantId,
    `SELECT subcontract_id, gross_amount, net_amount, status
       FROM subcontract_invoices WHERE tenant_id=$1 AND subcontract_id = ANY($2) LIMIT 10000`, [tenantId, ids])

  return analyzeCommitments(subRows, inv.rows as ScInvoiceRow[])
}
