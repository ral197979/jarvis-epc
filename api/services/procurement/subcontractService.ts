/**
 * Denver Engineering — Subcontract Service (v10.8.0)
 * ────────────────────────────────────────────────────
 * Bid Package → Bid Submission → Award → Subcontract → Invoice pipeline.
 *
 * All queries go through tenantQuery for RLS enforcement.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export type BidPkgStatus  = 'draft' | 'issued' | 'closed' | 'awarded' | 'cancelled'
export type BidSubStatus  = 'pending' | 'accepted' | 'declined' | 'withdrawn'
export type ScStatus      = 'active' | 'suspended' | 'complete' | 'terminated'
export type ScInvStatus   = 'draft' | 'submitted' | 'approved' | 'rejected'

export interface BidPackage {
  id:              string
  projectId:       string
  changeOrderId:   string | null
  pkgNumber:       number
  title:           string
  scope:           string | null
  csiCode:         string | null
  status:          BidPkgStatus
  budgetAmount:    number | null
  bidDueDate:      string | null
  issuedAt:        string | null
  closedAt:        string | null
  awardedAt:       string | null
  createdBy:       string | null
  createdAt:       string
  submissionCount?: number
}

export interface BidSubmission {
  id:            string
  bidPackageId:  string
  vendorId:      string
  vendorName?:   string
  status:        BidSubStatus
  bidAmount:     number | null
  notes:         string | null
  submittedAt:   string
  reviewedAt:    string | null
  reviewedBy:    string | null
}

export interface Subcontract {
  id:               string
  projectId:        string
  bidPackageId:     string | null
  bidSubmissionId:  string | null
  vendorId:         string
  vendorName?:      string
  scNumber:         number
  title:            string
  scope:            string | null
  status:           ScStatus
  contractValue:    number
  retentionPct:     number
  startDate:        string | null
  endDate:          string | null
  executedAt:       string | null
  createdAt:        string
  invoicedTotal?:   number
  approvedTotal?:   number
}

export interface ScInvoice {
  id:             string
  subcontractId:  string
  invNumber:      number
  periodStart:    string
  periodEnd:      string
  grossAmount:    number
  retentionHeld:  number
  netAmount:      number
  status:         ScInvStatus
  submittedAt:    string | null
  reviewedBy:     string | null
  reviewedAt:     string | null
  reviewNotes:    string | null
  createdAt:      string
}

// ─── Bid packages ─────────────────────────────────────────────────────────────

export async function createBidPackage(
  tenantId: string,
  input: {
    projectId:      string
    title:          string
    scope?:         string
    csiCode?:       string
    budgetAmount?:  number
    bidDueDate?:    string
    changeOrderId?: string
    createdBy?:     string
  },
): Promise<BidPackage> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO bid_packages
       (tenant_id, project_id, change_order_id, pkg_number, title, scope,
        csi_code, budget_amount, bid_due_date, created_by)
     VALUES (
       $1, $2, $3,
       COALESCE((SELECT MAX(pkg_number) FROM bid_packages WHERE tenant_id=$1 AND project_id=$2), 0) + 1,
       $4, $5, $6, $7, $8, $9
     ) RETURNING *`,
    [tenantId, input.projectId, input.changeOrderId ?? null,
     input.title, input.scope ?? null, input.csiCode ?? null,
     input.budgetAmount ?? null, input.bidDueDate ?? null, input.createdBy ?? null],
  )
  return _mapPkg(res.rows[0])
}

export async function listBidPackages(
  tenantId: string,
  projectId: string,
  status?: BidPkgStatus,
): Promise<BidPackage[]> {
  const res = await tenantQuery(tenantId,
    `SELECT bp.*,
            (SELECT COUNT(*) FROM bid_submissions bs WHERE bs.bid_package_id=bp.id) AS submission_count
     FROM bid_packages bp
     WHERE bp.tenant_id=$1 AND bp.project_id=$2
       AND ($3::bid_pkg_status IS NULL OR bp.status=$3)
     ORDER BY bp.created_at DESC`,
    [tenantId, projectId, status ?? null],
  )
  return res.rows.map(_mapPkg)
}

export async function getBidPackage(tenantId: string, id: string): Promise<BidPackage | null> {
  const res = await tenantQuery(tenantId,
    `SELECT bp.*,
            (SELECT COUNT(*) FROM bid_submissions bs WHERE bs.bid_package_id=bp.id) AS submission_count
     FROM bid_packages bp WHERE bp.id=$1 AND bp.tenant_id=$2`,
    [id, tenantId],
  )
  return res.rows[0] ? _mapPkg(res.rows[0]) : null
}

// ─── Bid package workflow ─────────────────────────────────────────────────────

export async function issueBidPackage(tenantId: string, id: string): Promise<BidPackage | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE bid_packages SET status='issued', issued_at=now(), updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status='draft' RETURNING *`,
    [id, tenantId],
  )
  return res.rows[0] ? _mapPkg(res.rows[0]) : null
}

export async function closeBidPackage(tenantId: string, id: string): Promise<BidPackage | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE bid_packages SET status='closed', closed_at=now(), updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status='issued' RETURNING *`,
    [id, tenantId],
  )
  return res.rows[0] ? _mapPkg(res.rows[0]) : null
}

export async function cancelBidPackage(tenantId: string, id: string): Promise<BidPackage | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE bid_packages SET status='cancelled', updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status IN ('draft','issued','closed') RETURNING *`,
    [id, tenantId],
  )
  return res.rows[0] ? _mapPkg(res.rows[0]) : null
}

// ─── Bid submissions ──────────────────────────────────────────────────────────

export async function submitBid(
  tenantId: string,
  input: {
    bidPackageId: string
    vendorId:     string
    bidAmount?:   number
    notes?:       string
  },
): Promise<BidSubmission> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO bid_submissions
       (tenant_id, bid_package_id, vendor_id, bid_amount, notes)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (bid_package_id, vendor_id)
     DO UPDATE SET bid_amount=$4, notes=$5, submitted_at=now()
     RETURNING *`,
    [tenantId, input.bidPackageId, input.vendorId,
     input.bidAmount ?? null, input.notes ?? null],
  )
  return _mapSub(res.rows[0])
}

export async function listBidSubmissions(
  tenantId: string,
  bidPackageId: string,
): Promise<BidSubmission[]> {
  const res = await tenantQuery(tenantId,
    `SELECT bs.*, v.name AS vendor_name
     FROM bid_submissions bs
     LEFT JOIN vendors v ON v.id=bs.vendor_id
     WHERE bs.tenant_id=$1 AND bs.bid_package_id=$2
     ORDER BY bs.bid_amount ASC NULLS LAST`,
    [tenantId, bidPackageId],
  )
  return res.rows.map(_mapSub)
}

export async function awardBid(
  tenantId: string,
  submissionId: string,
  userId: string,
  awardInput: {
    contractValue?: number
    retentionPct?:  number
    startDate?:     string
    endDate?:       string
  },
): Promise<Subcontract | null> {
  // Mark submission accepted
  const subRes = await tenantQuery(tenantId,
    `UPDATE bid_submissions SET status='accepted', reviewed_by=$2, reviewed_at=now()
     WHERE id=$1 AND tenant_id=$3 RETURNING *`,
    [submissionId, userId, tenantId],
  )
  if (!subRes.rows[0]) return null
  const sub = _mapSub(subRes.rows[0])

  // Mark bid package awarded
  const pkgRes = await tenantQuery(tenantId,
    `UPDATE bid_packages SET status='awarded', awarded_at=now(), updated_at=now()
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [sub.bidPackageId, tenantId],
  )
  const pkg = pkgRes.rows[0]

  // Create the subcontract
  const scRes = await tenantQuery(tenantId,
    `INSERT INTO subcontracts
       (tenant_id, project_id, bid_package_id, bid_submission_id, vendor_id,
        sc_number, title, scope, contract_value, retention_pct, start_date, end_date, created_by)
     VALUES (
       $1,
       $2,
       $3, $4, $5,
       COALESCE((SELECT MAX(sc_number) FROM subcontracts WHERE tenant_id=$1 AND project_id=$2), 0) + 1,
       $6, $7, $8, $9, $10, $11, $12
     ) RETURNING *`,
    [
      tenantId,
      pkg?.project_id as string,
      sub.bidPackageId, submissionId, sub.vendorId,
      pkg?.title as string ?? 'Subcontract',
      pkg?.scope as string ?? null,
      awardInput.contractValue ?? sub.bidAmount ?? 0,
      awardInput.retentionPct ?? 10,
      awardInput.startDate ?? null,
      awardInput.endDate ?? null,
      userId,
    ],
  )
  return _mapSc(scRes.rows[0])
}

// ─── Subcontracts ─────────────────────────────────────────────────────────────

export async function createSubcontract(
  tenantId: string,
  input: {
    projectId:     string
    vendorId:      string
    title:         string
    scope?:        string
    contractValue: number
    retentionPct?: number
    startDate?:    string
    endDate?:      string
    createdBy?:    string
  },
): Promise<Subcontract> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO subcontracts
       (tenant_id, project_id, vendor_id, sc_number, title, scope,
        contract_value, retention_pct, start_date, end_date, created_by)
     VALUES (
       $1, $2, $3,
       COALESCE((SELECT MAX(sc_number) FROM subcontracts WHERE tenant_id=$1 AND project_id=$2), 0) + 1,
       $4, $5, $6, $7, $8, $9, $10
     ) RETURNING *`,
    [tenantId, input.projectId, input.vendorId,
     input.title, input.scope ?? null,
     input.contractValue, input.retentionPct ?? 10,
     input.startDate ?? null, input.endDate ?? null,
     input.createdBy ?? null],
  )
  return _mapSc(res.rows[0])
}

export async function listSubcontracts(
  tenantId: string,
  projectId: string,
  status?: ScStatus,
): Promise<Subcontract[]> {
  const res = await tenantQuery(tenantId,
    `SELECT sc.*, v.name AS vendor_name,
            COALESCE(SUM(si.gross_amount), 0) AS invoiced_total,
            COALESCE(SUM(si.gross_amount) FILTER (WHERE si.status='approved'), 0) AS approved_total
     FROM subcontracts sc
     LEFT JOIN vendors v ON v.id=sc.vendor_id
     LEFT JOIN subcontract_invoices si ON si.subcontract_id=sc.id
     WHERE sc.tenant_id=$1 AND sc.project_id=$2
       AND ($3::subcontract_status IS NULL OR sc.status=$3)
     GROUP BY sc.id, v.name
     ORDER BY sc.created_at DESC`,
    [tenantId, projectId, status ?? null],
  )
  return res.rows.map(_mapSc)
}

export async function getSubcontract(tenantId: string, id: string): Promise<Subcontract | null> {
  const res = await tenantQuery(tenantId,
    `SELECT sc.*, v.name AS vendor_name,
            COALESCE(SUM(si.gross_amount), 0) AS invoiced_total,
            COALESCE(SUM(si.gross_amount) FILTER (WHERE si.status='approved'), 0) AS approved_total
     FROM subcontracts sc
     LEFT JOIN vendors v ON v.id=sc.vendor_id
     LEFT JOIN subcontract_invoices si ON si.subcontract_id=sc.id
     WHERE sc.id=$1 AND sc.tenant_id=$2
     GROUP BY sc.id, v.name`,
    [id, tenantId],
  )
  return res.rows[0] ? _mapSc(res.rows[0]) : null
}

export async function updateSubcontractStatus(
  tenantId: string,
  id: string,
  status: ScStatus,
): Promise<Subcontract | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE subcontracts SET status=$3, updated_at=now()
     WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [id, tenantId, status],
  )
  return res.rows[0] ? _mapSc(res.rows[0]) : null
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

export async function createInvoice(
  tenantId: string,
  input: {
    subcontractId: string
    periodStart:   string
    periodEnd:     string
    grossAmount:   number
    retentionPct?: number
  },
): Promise<ScInvoice> {
  // Fetch subcontract retention if not provided
  const scRes = await tenantQuery(tenantId,
    `SELECT retention_pct FROM subcontracts WHERE id=$1 AND tenant_id=$2`,
    [input.subcontractId, tenantId],
  )
  const retPct = input.retentionPct ?? (scRes.rows[0] ? Number(scRes.rows[0]['retention_pct']) : 10)
  const retentionHeld = Math.round(input.grossAmount * retPct) / 100
  const netAmount = input.grossAmount - retentionHeld

  const res = await tenantQuery(tenantId,
    `INSERT INTO subcontract_invoices
       (tenant_id, subcontract_id, inv_number, period_start, period_end,
        gross_amount, retention_held, net_amount)
     VALUES (
       $1, $2,
       COALESCE((SELECT MAX(inv_number) FROM subcontract_invoices WHERE subcontract_id=$2), 0) + 1,
       $3, $4, $5, $6, $7
     ) RETURNING *`,
    [tenantId, input.subcontractId, input.periodStart, input.periodEnd,
     input.grossAmount, retentionHeld, netAmount],
  )
  return _mapInv(res.rows[0])
}

export async function listInvoices(
  tenantId: string,
  subcontractId: string,
): Promise<ScInvoice[]> {
  const res = await tenantQuery(tenantId,
    `SELECT * FROM subcontract_invoices
     WHERE tenant_id=$1 AND subcontract_id=$2
     ORDER BY inv_number DESC`,
    [tenantId, subcontractId],
  )
  return res.rows.map(_mapInv)
}

export async function submitInvoice(tenantId: string, id: string): Promise<ScInvoice | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE subcontract_invoices
     SET status='submitted', submitted_at=now(), updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status='draft' RETURNING *`,
    [id, tenantId],
  )
  return res.rows[0] ? _mapInv(res.rows[0]) : null
}

export async function reviewInvoice(
  tenantId: string,
  id: string,
  approve: boolean,
  userId: string,
  reviewNotes?: string,
): Promise<ScInvoice | null> {
  const res = await tenantQuery(tenantId,
    `UPDATE subcontract_invoices
     SET status=$3, reviewed_by=$4, reviewed_at=now(), review_notes=$5, updated_at=now()
     WHERE id=$1 AND tenant_id=$2 AND status='submitted' RETURNING *`,
    [id, tenantId, approve ? 'approved' : 'rejected', userId, reviewNotes ?? null],
  )
  return res.rows[0] ? _mapInv(res.rows[0]) : null
}

// ─── Project summary ──────────────────────────────────────────────────────────

export interface SubcontractSummary {
  totalSubcontracts:    number
  totalContractValue:   number
  totalInvoiced:        number
  totalApproved:        number
  activeBidPackages:    number
}

export async function getSubcontractSummary(
  tenantId: string,
  projectId: string,
): Promise<SubcontractSummary> {
  const [scRes, pkgRes] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT
         COUNT(*)                                   AS total_subcontracts,
         COALESCE(SUM(contract_value), 0)           AS total_contract_value,
         COALESCE((
           SELECT SUM(gross_amount)
           FROM subcontract_invoices si
           JOIN subcontracts s2 ON s2.id=si.subcontract_id
           WHERE s2.project_id=$2 AND s2.tenant_id=$1
         ), 0)                                      AS total_invoiced,
         COALESCE((
           SELECT SUM(gross_amount)
           FROM subcontract_invoices si
           JOIN subcontracts s2 ON s2.id=si.subcontract_id
           WHERE s2.project_id=$2 AND s2.tenant_id=$1 AND si.status='approved'
         ), 0)                                      AS total_approved
       FROM subcontracts
       WHERE tenant_id=$1 AND project_id=$2 AND status='active'`,
      [tenantId, projectId],
    ),
    tenantQuery(tenantId,
      `SELECT COUNT(*) AS active_bid_packages
       FROM bid_packages
       WHERE tenant_id=$1 AND project_id=$2 AND status IN ('issued','closed')`,
      [tenantId, projectId],
    ),
  ])
  const r = scRes.rows[0]
  return {
    totalSubcontracts:  Number(r['total_subcontracts']),
    totalContractValue: Number(r['total_contract_value']),
    totalInvoiced:      Number(r['total_invoiced']),
    totalApproved:      Number(r['total_approved']),
    activeBidPackages:  Number(pkgRes.rows[0]['active_bid_packages']),
  }
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapPkg(r: Record<string, unknown>): BidPackage {
  return {
    id:            r['id'] as string,
    projectId:     r['project_id'] as string,
    changeOrderId: (r['change_order_id'] as string) ?? null,
    pkgNumber:     Number(r['pkg_number']),
    title:         r['title'] as string,
    scope:         (r['scope'] as string) ?? null,
    csiCode:       (r['csi_code'] as string) ?? null,
    status:        r['status'] as BidPkgStatus,
    budgetAmount:  r['budget_amount'] != null ? Number(r['budget_amount']) : null,
    bidDueDate:    r['bid_due_date'] ? String(r['bid_due_date']).slice(0, 10) : null,
    issuedAt:      r['issued_at']  ? new Date(r['issued_at'] as string).toISOString() : null,
    closedAt:      r['closed_at']  ? new Date(r['closed_at'] as string).toISOString() : null,
    awardedAt:     r['awarded_at'] ? new Date(r['awarded_at'] as string).toISOString() : null,
    createdBy:     (r['created_by'] as string) ?? null,
    createdAt:     new Date(r['created_at'] as string).toISOString(),
    submissionCount: r['submission_count'] != null ? Number(r['submission_count']) : undefined,
  }
}

function _mapSub(r: Record<string, unknown>): BidSubmission {
  return {
    id:           r['id'] as string,
    bidPackageId: r['bid_package_id'] as string,
    vendorId:     r['vendor_id'] as string,
    vendorName:   (r['vendor_name'] as string) ?? undefined,
    status:       r['status'] as BidSubStatus,
    bidAmount:    r['bid_amount'] != null ? Number(r['bid_amount']) : null,
    notes:        (r['notes'] as string) ?? null,
    submittedAt:  new Date(r['submitted_at'] as string).toISOString(),
    reviewedAt:   r['reviewed_at'] ? new Date(r['reviewed_at'] as string).toISOString() : null,
    reviewedBy:   (r['reviewed_by'] as string) ?? null,
  }
}

function _mapSc(r: Record<string, unknown>): Subcontract {
  return {
    id:              r['id'] as string,
    projectId:       r['project_id'] as string,
    bidPackageId:    (r['bid_package_id'] as string) ?? null,
    bidSubmissionId: (r['bid_submission_id'] as string) ?? null,
    vendorId:        r['vendor_id'] as string,
    vendorName:      (r['vendor_name'] as string) ?? undefined,
    scNumber:        Number(r['sc_number']),
    title:           r['title'] as string,
    scope:           (r['scope'] as string) ?? null,
    status:          r['status'] as ScStatus,
    contractValue:   Number(r['contract_value']),
    retentionPct:    Number(r['retention_pct']),
    startDate:       r['start_date'] ? String(r['start_date']).slice(0, 10) : null,
    endDate:         r['end_date']   ? String(r['end_date']).slice(0, 10)   : null,
    executedAt:      r['executed_at'] ? new Date(r['executed_at'] as string).toISOString() : null,
    createdAt:       new Date(r['created_at'] as string).toISOString(),
    invoicedTotal:   r['invoiced_total'] != null ? Number(r['invoiced_total']) : undefined,
    approvedTotal:   r['approved_total'] != null ? Number(r['approved_total']) : undefined,
  }
}

function _mapInv(r: Record<string, unknown>): ScInvoice {
  return {
    id:            r['id'] as string,
    subcontractId: r['subcontract_id'] as string,
    invNumber:     Number(r['inv_number']),
    periodStart:   String(r['period_start']).slice(0, 10),
    periodEnd:     String(r['period_end']).slice(0, 10),
    grossAmount:   Number(r['gross_amount']),
    retentionHeld: Number(r['retention_held']),
    netAmount:     Number(r['net_amount']),
    status:        r['status'] as ScInvStatus,
    submittedAt:   r['submitted_at'] ? new Date(r['submitted_at'] as string).toISOString() : null,
    reviewedBy:    (r['reviewed_by'] as string) ?? null,
    reviewedAt:    r['reviewed_at'] ? new Date(r['reviewed_at'] as string).toISOString() : null,
    reviewNotes:   (r['review_notes'] as string) ?? null,
    createdAt:     new Date(r['created_at'] as string).toISOString(),
  }
}
