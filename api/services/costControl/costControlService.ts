/**
 * Denver Engineering — Cost Control Service (v10.10.0)
 *
 * Single aggregation: getCostControlSnapshot(tenantId, projectId)
 * Reads from existing tables — no new migration needed.
 */
import { tenantQuery } from '../../db/pool'

export interface MonthlyTrend {
  month:  string   // YYYY-MM
  acwp:   number
  eac:    number
  bcwp:   number
  bcws:   number
}

export interface TopSubcontractor {
  subcontractId: string
  vendorName:    string
  scNumber:      string
  contractValue: number
  invoicedTotal: number
  approvedTotal: number
  percentBilled: number
  status:        string
}

export interface ChangeOrderSummary {
  id:          string
  coNumber:    number
  title:       string
  costImpact:  number
  status:      string
  submittedAt: string | null
}

export interface CostControlSnapshot {
  projectId:      string
  originalBac:    number
  approvedCo:     number
  pendingCo:      number
  revisedBudget:  number
  committedSubs:  number
  invoicedToDate: number
  approvedInv:    number
  acwp:           number
  eac:            number | null
  cpi:            number | null
  spi:            number | null
  bcwp:           number | null
  bcws:           number | null
  vac:            number | null
  pctSpent:       number
  trend:          MonthlyTrend[]
  topSubs:        TopSubcontractor[]
  recentCOs:      ChangeOrderSummary[]
}

export async function getCostControlSnapshot(
  tenantId: string,
  projectId: string,
): Promise<CostControlSnapshot> {
  // ── 1. EVM baseline BAC ────────────────────────────────────────────────────
  const bacResult = await tenantQuery(tenantId, `
    SELECT bac
    FROM   evm_baselines
    WHERE  tenant_id = $1
      AND  project_id = $2
      AND  status = 'active'
    ORDER  BY created_at DESC
    LIMIT  1
  `, [tenantId, projectId])

  const originalBac = Number(bacResult.rows[0]?.bac ?? 0)

  // ── 2. Change order totals ─────────────────────────────────────────────────
  const coResult = await tenantQuery(tenantId, `
    SELECT
      COALESCE(SUM(CASE WHEN status = 'approved'  THEN cost_impact ELSE 0 END), 0) AS approved_co,
      COALESCE(SUM(CASE WHEN status = 'submitted' THEN cost_impact ELSE 0 END), 0) AS pending_co
    FROM  change_orders
    WHERE tenant_id = $1
      AND project_id = $2
      AND status NOT IN ('void', 'rejected')
  `, [tenantId, projectId])

  const approvedCo = Number(coResult.rows[0]?.approved_co ?? 0)
  const pendingCo  = Number(coResult.rows[0]?.pending_co  ?? 0)

  // ── 3. Subcontract + invoice totals ────────────────────────────────────────
  const subResult = await tenantQuery(tenantId, `
    SELECT
      COALESCE(SUM(s.contract_value) FILTER (WHERE s.status IN ('active','complete')), 0) AS committed_subs,
      COALESCE(SUM(i.gross_amount),  0)                                                    AS invoiced_total,
      COALESCE(SUM(i.gross_amount) FILTER (WHERE i.status = 'approved'), 0)                AS approved_inv
    FROM       subcontracts s
    LEFT JOIN  subcontract_invoices i ON i.subcontract_id = s.id AND i.tenant_id = s.tenant_id
    WHERE      s.tenant_id  = $1
      AND      s.project_id = $2
  `, [tenantId, projectId])

  const committedSubs  = Number(subResult.rows[0]?.committed_subs  ?? 0)
  const invoicedToDate = Number(subResult.rows[0]?.invoiced_total   ?? 0)
  const approvedInv    = Number(subResult.rows[0]?.approved_inv     ?? 0)

  // ── 4. EVM actuals (ACWP) ─────────────────────────────────────────────────
  const acwpResult = await tenantQuery(tenantId, `
    SELECT COALESCE(SUM(amount), 0) AS acwp
    FROM   evm_actuals
    WHERE  tenant_id  = $1
      AND  project_id = $2
  `, [tenantId, projectId])

  const acwp = Number(acwpResult.rows[0]?.acwp ?? 0)

  // ── 5. Latest EVM snapshot ────────────────────────────────────────────────
  const snapResult = await tenantQuery(tenantId, `
    SELECT eac, cpi, spi, bcwp, bcws
    FROM   evm_snapshots
    WHERE  tenant_id  = $1
      AND  project_id = $2
    ORDER  BY snapshot_date DESC
    LIMIT  1
  `, [tenantId, projectId])

  const snap = snapResult.rows[0] ?? null
  const eac  = snap ? Number(snap.eac)  : null
  const cpi  = snap ? Number(snap.cpi)  : null
  const spi  = snap ? Number(snap.spi)  : null
  const bcwp = snap ? Number(snap.bcwp) : null
  const bcws = snap ? Number(snap.bcws) : null

  // ── 6. Monthly trend (last 12 snapshots grouped by month) ─────────────────
  const trendResult = await tenantQuery(tenantId, `
    SELECT
      TO_CHAR(snapshot_date, 'YYYY-MM') AS month,
      AVG(acwp)::numeric(14,2) AS acwp,
      AVG(eac)::numeric(14,2)  AS eac,
      AVG(bcwp)::numeric(14,2) AS bcwp,
      AVG(bcws)::numeric(14,2) AS bcws
    FROM   evm_snapshots
    WHERE  tenant_id  = $1
      AND  project_id = $2
    GROUP  BY month
    ORDER  BY month DESC
    LIMIT  12
  `, [tenantId, projectId])

  const trend: MonthlyTrend[] = trendResult.rows.reverse().map(r => ({
    month: r.month,
    acwp:  Number(r.acwp),
    eac:   Number(r.eac),
    bcwp:  Number(r.bcwp),
    bcws:  Number(r.bcws),
  }))

  // ── 7. Top subcontractors ─────────────────────────────────────────────────
  const topSubResult = await tenantQuery(tenantId, `
    SELECT
      s.id                                                          AS subcontract_id,
      v.name                                                        AS vendor_name,
      s.sc_number,
      s.contract_value,
      s.status,
      COALESCE(SUM(i.gross_amount), 0)                             AS invoiced_total,
      COALESCE(SUM(i.gross_amount) FILTER (WHERE i.status='approved'), 0) AS approved_total
    FROM       subcontracts s
    LEFT JOIN  vendors v ON v.id = s.vendor_id AND v.tenant_id = s.tenant_id
    LEFT JOIN  subcontract_invoices i ON i.subcontract_id = s.id AND i.tenant_id = s.tenant_id
    WHERE      s.tenant_id  = $1
      AND      s.project_id = $2
    GROUP BY   s.id, v.name, s.sc_number, s.contract_value, s.status
    ORDER BY   s.contract_value DESC
    LIMIT      10
  `, [tenantId, projectId])

  const topSubs: TopSubcontractor[] = topSubResult.rows.map(r => {
    const cv = Number(r.contract_value)
    const inv = Number(r.invoiced_total)
    return {
      subcontractId: r.subcontract_id,
      vendorName:    r.vendor_name ?? 'Unknown',
      scNumber:      String(r.sc_number),
      contractValue: cv,
      invoicedTotal: inv,
      approvedTotal: Number(r.approved_total),
      percentBilled: cv > 0 ? Math.round((inv / cv) * 100) : 0,
      status:        r.status,
    }
  })

  // ── 8. Recent change orders ───────────────────────────────────────────────
  const coListResult = await tenantQuery(tenantId, `
    SELECT id, co_number, title, cost_impact, status, submitted_at
    FROM   change_orders
    WHERE  tenant_id  = $1
      AND  project_id = $2
    ORDER  BY co_number DESC
    LIMIT  10
  `, [tenantId, projectId])

  const recentCOs: ChangeOrderSummary[] = coListResult.rows.map(r => ({
    id:          r.id,
    coNumber:    Number(r.co_number),
    title:       r.title,
    costImpact:  Number(r.cost_impact ?? 0),
    status:      r.status,
    submittedAt: r.submitted_at ?? null,
  }))

  // ── 9. Derived metrics ────────────────────────────────────────────────────
  const revisedBudget = originalBac + approvedCo
  const vac = eac !== null ? revisedBudget - eac : null
  const pctSpent = revisedBudget > 0 ? Math.round((acwp / revisedBudget) * 100) : 0

  return {
    projectId,
    originalBac,
    approvedCo,
    pendingCo,
    revisedBudget,
    committedSubs,
    invoicedToDate,
    approvedInv,
    acwp,
    eac,
    cpi,
    spi,
    bcwp,
    bcws,
    vac,
    pctSpent,
    trend,
    topSubs,
    recentCOs,
  }
}
