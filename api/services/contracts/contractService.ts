/**
 * Denver Engineering — Contracts (vendor commitments)
 * ─────────────────────────────────────────────────────────────────────────────
 * What the audit found, before any of this was written
 * ────────────────────────────────────────────────────
 * `contracts` (migration 002) is a real table with a real lifecycle:
 *
 *     contract_status = draft | negotiation | active | variation | closed | disputed
 *
 * It carries `vendor_id NOT NULL` and `project_id NOT NULL`, so a contract is a
 * commitment to a VENDOR, delivered on a project. It is not a project, and a
 * project is not one — `/api/v1/projects` was never a substitute for this, and
 * the dashboard tile that counted projects as contracts is the defect this
 * closes.
 *
 * Two audit findings that shape what is built here:
 *
 *   NO WRITER EXISTS. Nothing in the API inserts or updates a `contracts` row —
 *   the only reference anywhere is a LEFT JOIN in the purchase-order detail
 *   (procurement.ts), through `purchase_orders.contract_id`. So the count this
 *   module returns is genuinely zero until a create surface exists. Zero rows
 *   is a truthful answer about the DATA; it is not a truthful answer about the
 *   SYSTEM, so `writable: false` is reported alongside it and the dashboard
 *   says so rather than implying an empty order book.
 *
 *   `subcontracts` (migration 059) IS written, by subcontractService, and has
 *   its own lifecycle (active|suspended|complete|terminated). It is a DIFFERENT
 *   table with a different enum, and it is deliberately NOT counted here.
 *   Folding it in would be the same substitution error as counting projects,
 *   just less obvious.
 *
 * The governed definition of active
 * ─────────────────────────────────
 * ACTIVE means `status = 'active'`, the literal member of the persisted enum.
 * Nothing is inferred from dates, projects, purchase orders or amounts.
 *
 * `variation` and `disputed` are deliberately EXCLUDED. Both describe live
 * commercial relationships, and an argument could be made for either — which is
 * exactly why neither is folded in silently. The enum's author made them
 * distinct from `active`, so this module honours that, and every status count
 * is returned beside the active one so an excluded state is visible rather than
 * buried. Widening the definition is an owner decision, not a code change.
 */
import { tenantQuery } from '../../db/pool'

/**
 * The caller's authorization predicate, built at the ROUTE.
 *
 * ADR-014 requires `collectionScopeSql` to appear on the route declaration
 * rather than a level below it, and the collection ratchet enforces exactly
 * that: a predicate hidden inside a service is a predicate nobody auditing the
 * route can see. So the route builds it and hands it here, and this module
 * composes it into the statement — ANDed outside the caller's filters and
 * before LIMIT, so a filter can only narrow the authorized set.
 */
export interface CollectionScope {
  /** SQL fragment, already parameter-indexed by the caller. */
  sql: string
  /** Values the fragment binds. */
  params: unknown[]
  /** Index the next parameter should use. */
  nextIndex: number
}

/**
 * The governed definition of an active contract: the persisted enum member.
 * Exported so tests pin the definition itself rather than a copy of it.
 */
export const ACTIVE_CONTRACT_STATUS = 'active' as const

/** Every state the persisted enum can hold (migration 002). */
export const CONTRACT_STATUSES = [
  'draft', 'negotiation', 'active', 'variation', 'closed', 'disputed',
] as const
export type ContractStatus = typeof CONTRACT_STATUSES[number]

export interface ContractRow {
  id: string
  contract_number: string
  title: string
  type: string
  status: ContractStatus
  vendor_id: string
  vendor_name: string | null
  project_id: string
  project_code: string | null
  currency: string | null
  original_value: string
  approved_value: string
  invoiced_amount: string
  paid_amount: string
  start_date: string | null
  end_date: string | null
  executed_date: string | null
  created_at: string
}

export interface ContractSummary {
  /** Contracts whose persisted status is exactly `active`. */
  active: number
  /** Total value of those contracts, from `approved_value`. */
  activeValue: number
  /** Every contract the caller can reach, in any state. */
  total: number
  /** Count per persisted status, so an excluded state is visible not hidden. */
  byStatus: Record<string, number>
  /**
   * Whether the application can create a contract at all.
   *
   * False today: the audit found no INSERT anywhere in the API. A reader
   * seeing `active: 0` is otherwise entitled to conclude their organisation has
   * no active contracts, when the truth is that none can be recorded yet.
   */
  writable: boolean
}

/** No route creates or updates a `contracts` row. Verified across api/ 2026-08-25. */
export const CONTRACTS_WRITABLE = false

/**
 * Rows the caller may reach.
 *
 * `contracts.project_id` is NOT NULL, so every contract belongs to a project and
 * the collection predicate is the ordinary project-membership one — ANDed
 * outside any caller filter and applied before LIMIT, so a filter can only
 * narrow the authorized set (ADR-014 §9, §14).
 */
export async function listContracts(
  tenantId: string,
  scope: CollectionScope,
  opts: { status?: string; projectId?: string; limit?: number } = {},
): Promise<ContractRow[]> {
  const conds: string[] = []
  const vals: unknown[] = []
  let i = scope.nextIndex

  if (opts.status)    { conds.push(`c.status = $${i++}::contract_status`); vals.push(opts.status) }
  if (opts.projectId) { conds.push(`c.project_id = $${i++}`);              vals.push(opts.projectId) }
  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''
  const j = i

  const res = await tenantQuery<ContractRow>(tenantId, `
    SELECT c.id, c.contract_number, c.title, c.type::text AS type, c.status::text AS status,
           c.vendor_id, v.name AS vendor_name,
           c.project_id, p.code AS project_code,
           c.currency, c.original_value::text, c.approved_value::text,
           c.invoiced_amount::text, c.paid_amount::text,
           c.start_date::text, c.end_date::text, c.executed_date::text,
           c.created_at::text
      FROM contracts c
      LEFT JOIN vendors  v ON v.id = c.vendor_id
      LEFT JOIN projects p ON p.id = c.project_id
     WHERE c.tenant_id = current_setting('app.current_tenant_id', true)::uuid ${where}
     ${scope.sql}
     ORDER BY c.created_at DESC
     LIMIT $${j}
  `, [...scope.params, ...vals, Math.min(500, Math.max(1, opts.limit ?? 200))])

  return res.rows
}

export async function getContract(tenantId: string, id: string): Promise<ContractRow | null> {
  const res = await tenantQuery<ContractRow>(tenantId, `
    SELECT c.id, c.contract_number, c.title, c.type::text AS type, c.status::text AS status,
           c.vendor_id, v.name AS vendor_name,
           c.project_id, p.code AS project_code,
           c.currency, c.original_value::text, c.approved_value::text,
           c.invoiced_amount::text, c.paid_amount::text,
           c.start_date::text, c.end_date::text, c.executed_date::text,
           c.created_at::text
      FROM contracts c
      LEFT JOIN vendors  v ON v.id = c.vendor_id
      LEFT JOIN projects p ON p.id = c.project_id
     WHERE c.id = $1
       AND c.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [id])
  return res.rows[0] ?? null
}

/**
 * The dashboard's source for Active Contracts.
 *
 * One grouped pass over `contracts` and nothing else. It does not read
 * `projects`, `purchase_orders` or `subcontracts` — the active count comes from
 * the contract's own persisted status or it does not exist.
 */
export async function contractSummary(tenantId: string, scope: CollectionScope): Promise<ContractSummary> {
  const res = await tenantQuery<{ status: string; n: string; approved: string }>(tenantId, `
    SELECT c.status::text AS status, COUNT(*)::text AS n,
           COALESCE(SUM(c.approved_value), 0)::text AS approved
      FROM contracts c
     WHERE c.tenant_id = current_setting('app.current_tenant_id', true)::uuid
     ${scope.sql}
     GROUP BY c.status
  `, scope.params)

  const byStatus: Record<string, number> = {}
  let total = 0
  let active = 0
  let activeValue = 0

  for (const row of res.rows) {
    const n = Number(row.n)
    byStatus[row.status] = n
    total += n
    if (row.status === ACTIVE_CONTRACT_STATUS) {
      active = n
      activeValue = Number(row.approved)
    }
  }

  return { active, activeValue, total, byStatus, writable: CONTRACTS_WRITABLE }
}
