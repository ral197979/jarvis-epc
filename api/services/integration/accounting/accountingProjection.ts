/**
 * Denver Engineering — projecting commercial facts onto the accounting contract
 * ─────────────────────────────────────────────────────────────────────────────
 * Each builder reads ONE Denver table and returns the neutral document for it.
 * Nothing here computes an accounting figure: the amounts are the columns
 * Denver already persists, passed through as decimal STRINGS so no float
 * rounding is introduced on the way out, and `sourceState` is Denver's own
 * lifecycle value rather than a mapped accounting status.
 *
 * Every query carries the tenant predicate, and the caller is responsible for
 * having proved project reach first — the route does that with
 * `authorizeRecordScope` against the resource named in DOCUMENT_SOURCE_RESOURCE,
 * so a commercial document cannot be projected out of a project the caller
 * cannot open.
 */
import { tenantQuery } from '../../../db/pool'
import {
  ACCOUNTING_CONTRACT_VERSION, buildIdempotencyKey, isMoneyBearing, TAX_UNKNOWN,
  type AccountingDocument, type AccountingDocumentType,
} from './accountingContract'
import { resolveDeclaredCurrency } from './accountingCurrency'

/** Amounts cross the boundary as strings; a float here is a rounding bug later. */
const money = (v: unknown): string => v == null ? '0' : String(v)

interface VendorRow {
  id: string; name: string; code: string | null; email: string | null
  country: string | null; status: string
}
interface PayableRow {
  id: string; inv_number: number; status: string
  gross_amount: string; retention_held: string; net_amount: string
  period_start: string; period_end: string; submitted_at: string | null
  subcontract_id: string; sc_title: string | null
  project_id: string; project_code: string | null
  vendor_id: string | null; vendor_name: string | null; vendor_code: string | null
  vendor_email: string | null; vendor_country: string | null
}
interface ReceivableRow {
  id: string; application_number: number; status: string
  period_start: string; period_end: string; invoice_date: string | null
  retention_pct: string | null; submitted_at: string | null; paid_at: string | null
  project_id: string; project_code: string | null; client_name: string | null
}
interface CommitmentRow {
  id: string; po_number: string; status: string; title: string | null
  total_amount: string
  project_id: string; project_code: string | null
  vendor_id: string; vendor_name: string | null; vendor_code: string | null
  vendor_email: string | null; vendor_country: string | null
}

/**
 * Compose the envelope, resolving the GOVERNED currency for money-bearing types.
 *
 * The currency is looked up here rather than read off the source row, because
 * every currency column Denver has is `DEFAULT 'USD'` — `projects.currency`,
 * `contracts.currency`, `purchase_orders.currency` alike. A stored 'USD' in any
 * of them is indistinguishable from a value nobody ever set, so using one would
 * be inferring a fallback while reporting it as a fact. Only an explicit
 * declaration (migration 089) counts, and its absence is reported as
 * `undeclared` rather than filled in.
 *
 * `detail` is passed a `currencyOf` helper so the amounts a builder constructs
 * carry the same governed value as the envelope. There is deliberately no way
 * for a builder to supply its own: a document whose envelope says EUR and whose
 * line says USD would be a document nobody could act on.
 */
async function envelope(
  type: AccountingDocumentType,
  o: {
    denverId: string; tenantId: string; projectId: string | null; projectCode: string | null
    sourceState: string; occurredAt: string | null
    party: AccountingDocument['party']
    detail: (currency: string | null) => Record<string, unknown>
  },
): Promise<AccountingDocument> {
  const moneyBearing = isMoneyBearing(type)
  const declared = moneyBearing && o.projectId
    ? await resolveDeclaredCurrency(o.tenantId, o.projectId)
    : null

  return {
    contractVersion: ACCOUNTING_CONTRACT_VERSION,
    type,
    denverId: o.denverId,
    tenantId: o.tenantId,
    projectId: o.projectId,
    projectCode: o.projectCode,
    sourceState: o.sourceState,
    idempotencyKey: buildIdempotencyKey(type, o.denverId, o.sourceState),
    occurredAt: o.occurredAt,
    party: o.party,
    currency: declared?.currency ?? null,
    currencyBasis: declared ? 'declared' : 'undeclared',
    // The subject is always present on a money-bearing document, and the answer
    // is always UNKNOWN. Omitting it would invite a provider to read silence as
    // "no tax applies", which Denver has no basis to assert. A vendor master
    // moves no money, so it carries no tax position at all.
    tax: moneyBearing ? TAX_UNKNOWN : null,
    detail: o.detail(declared?.currency ?? null),
  }
}

export async function buildVendorDocument(tenantId: string, id: string): Promise<AccountingDocument | null> {
  const res = await tenantQuery<VendorRow>(tenantId, `
    SELECT id, name, code, email, country, status::text AS status
      FROM vendors
     WHERE id = $1 AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [id])
  const r = res.rows[0]
  if (!r) return null

  return await envelope('vendor', {
    denverId: r.id, tenantId, projectId: null, projectCode: null,
    // A vendor's `status` is Denver's approval lifecycle, not an accounting
    // one. A provider decides whether `prospect` may be transacted with.
    sourceState: r.status, occurredAt: null,
    party: {
      denverId: r.id, name: r.name, externalCode: r.code,
      email: r.email, country: r.country,
    },
    detail: () => ({}),
  })
}

export async function buildPayableInvoiceDocument(tenantId: string, id: string): Promise<AccountingDocument | null> {
  const res = await tenantQuery<PayableRow>(tenantId, `
    SELECT si.id, si.inv_number, si.status::text AS status,
           si.gross_amount::text, si.retention_held::text, si.net_amount::text,
           si.period_start::text, si.period_end::text, si.submitted_at::text,
           si.subcontract_id, sc.title AS sc_title,
           sc.project_id, p.code AS project_code,
           sc.vendor_id, v.name AS vendor_name, v.code AS vendor_code,
           v.email AS vendor_email, v.country AS vendor_country
      FROM subcontract_invoices si
      JOIN subcontracts sc ON sc.id = si.subcontract_id
      LEFT JOIN projects p ON p.id = sc.project_id
      LEFT JOIN vendors  v ON v.id = sc.vendor_id
     WHERE si.id = $1
       AND si.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [id])
  const r = res.rows[0]
  if (!r) return null

  return await envelope('payable_invoice', {
    denverId: r.id, tenantId, projectId: r.project_id, projectCode: r.project_code,
    sourceState: r.status, occurredAt: r.submitted_at,
    party: r.vendor_id ? {
      denverId: r.vendor_id, name: r.vendor_name ?? '', externalCode: r.vendor_code,
      email: r.vendor_email, country: r.vendor_country,
    } : null,
    detail: (currency) => ({
      documentNumber: String(r.inv_number),
      subcontractId: r.subcontract_id,
      subcontractTitle: r.sc_title,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      // Gross, retention and net exactly as Denver holds them, denominated in
      // the project's GOVERNED currency. Denver applies no tax model, and the
      // envelope's `tax` block says so explicitly rather than staying silent —
      // see ACCOUNTING_SETTLED_DECISIONS.tax-treatment.
      gross:     { amount: money(r.gross_amount),    currency },
      retention: { amount: money(r.retention_held),  currency },
      net:       { amount: money(r.net_amount),      currency },
    }),
  })
}

export async function buildReceivableApplicationDocument(tenantId: string, id: string): Promise<AccountingDocument | null> {
  const res = await tenantQuery<ReceivableRow>(tenantId, `
    SELECT pa.id, pa.application_number, pa.status::text AS status,
           pa.period_start::text, pa.period_end::text, pa.invoice_date::text,
           pa.retention_pct::text, pa.submitted_at::text, pa.paid_at::text,
           pa.project_id, p.code AS project_code, p.client_name
      FROM pay_applications pa
      LEFT JOIN projects p ON p.id = pa.project_id
     WHERE pa.id = $1
       AND pa.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [id])
  const r = res.rows[0]
  if (!r) return null

  return await envelope('receivable_application', {
    denverId: r.id, tenantId, projectId: r.project_id, projectCode: r.project_code,
    sourceState: r.status, occurredAt: r.submitted_at,
    // No party. `projects.client_name` is free text and Denver has no customer
    // entity, so there is nothing here that an accounting system could match to
    // a customer record. Sending the string as if it were a party would invent
    // a master-data relationship Denver does not have — see
    // ACCOUNTING_OPEN_DECISIONS.customer-entity.
    party: null,
    detail: () => ({
      documentNumber: String(r.application_number),
      periodStart: r.period_start,
      periodEnd: r.period_end,
      invoiceDate: r.invoice_date,
      retentionPct: r.retention_pct,
      paidAt: r.paid_at,
      /** Free text, and labelled as such so nobody treats it as a customer id. */
      clientNameUnverified: r.client_name,
      customerResolution: 'unresolved',
    }),
  })
}

export async function buildCommitmentDocument(tenantId: string, id: string): Promise<AccountingDocument | null> {
  const res = await tenantQuery<CommitmentRow>(tenantId, `
    SELECT po.id, po.po_number, po.status::text AS status, po.title,
           po.total_amount::text,
           po.project_id, p.code AS project_code,
           po.vendor_id, v.name AS vendor_name, v.code AS vendor_code,
           v.email AS vendor_email, v.country AS vendor_country
      FROM purchase_orders po
      LEFT JOIN projects p ON p.id = po.project_id
      LEFT JOIN vendors  v ON v.id = po.vendor_id
     WHERE po.id = $1
       AND po.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [id])
  const r = res.rows[0]
  if (!r) return null

  return await envelope('commitment', {
    denverId: r.id, tenantId, projectId: r.project_id, projectCode: r.project_code,
    sourceState: r.status, occurredAt: null,
    party: r.vendor_id ? {
      denverId: r.vendor_id, name: r.vendor_name ?? '', externalCode: r.vendor_code,
      email: r.vendor_email, country: r.vendor_country,
    } : null,
    detail: (currency) => ({
      documentNumber: r.po_number,
      title: r.title,
      // `purchase_orders.currency` is DEFAULT 'USD' and is deliberately NOT
      // read: a stored 'USD' there cannot be told apart from a value nobody set.
      // The governed declaration is the only source.
      total: { amount: money(r.total_amount), currency },
    }),
  })
}

const BUILDERS: Record<AccountingDocumentType, (t: string, id: string) => Promise<AccountingDocument | null>> = {
  vendor:                 buildVendorDocument,
  payable_invoice:        buildPayableInvoiceDocument,
  receivable_application: buildReceivableApplicationDocument,
  commitment:             buildCommitmentDocument,
}

export async function buildAccountingDocument(
  type: AccountingDocumentType, tenantId: string, id: string,
): Promise<AccountingDocument | null> {
  return BUILDERS[type](tenantId, id)
}
