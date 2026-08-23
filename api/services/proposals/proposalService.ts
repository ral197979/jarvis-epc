/**
 * Denver Engineering — Proposal Service (v10.12.0)
 *
 * Full bid pipeline lifecycle: draft → submitted → won | lost | no_bid
 * Weighted pipeline value = SUM(estimated_value * probability_pct / 100) for open proposals.
 */
import { tenantQuery } from '../../db/pool'

export type ProposalStatus = 'draft' | 'submitted' | 'won' | 'lost' | 'no_bid'

export interface Proposal {
  id:              string
  tenantId:        string
  proposalNumber:  number
  title:           string
  clientName:      string
  clientContact:   string | null
  bidDueDate:      string | null
  submittedDate:   string | null
  decidedDate:     string | null
  status:          ProposalStatus
  estimatedValue:  number
  probabilityPct:  number
  notes:           string | null
  createdBy:       string | null
  createdAt:       string
  updatedAt:       string
  itemCount?:      number
  itemsTotal?:     number
}

export interface ProposalItem {
  id:          string
  tenantId:    string
  proposalId:  string
  sortOrder:   number
  description: string
  quantity:    number
  unit:        string | null
  unitCost:    number
  total:       number
  createdAt:   string
}

export interface PipelineSummary {
  totalProposals:  number
  byStatus:        Record<ProposalStatus, { count: number; value: number }>
  weightedPipeline: number   // SUM(value * prob%) for draft + submitted
  winRate:          number   // won / (won + lost)
  avgDealSize:      number
}

function rowToProposal(r: Record<string, unknown>): Proposal {
  return {
    id:             r['id']             as string,
    tenantId:       r['tenant_id']      as string,
    proposalNumber: Number(r['proposal_number']),
    title:          r['title']          as string,
    clientName:     r['client_name']    as string,
    clientContact:  r['client_contact'] as string | null,
    bidDueDate:     r['bid_due_date']   as string | null,
    submittedDate:  r['submitted_date'] as string | null,
    decidedDate:    r['decided_date']   as string | null,
    status:         r['status']         as ProposalStatus,
    estimatedValue: Number(r['estimated_value']),
    probabilityPct: Number(r['probability_pct']),
    notes:          r['notes']          as string | null,
    createdBy:      r['created_by']     as string | null,
    createdAt:      r['created_at']     as string,
    updatedAt:      r['updated_at']     as string,
    itemCount:      r['item_count']  !== undefined ? Number(r['item_count'])  : undefined,
    itemsTotal:     r['items_total'] !== undefined ? Number(r['items_total']) : undefined,
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateProposalInput {
  title:          string
  clientName:     string
  clientContact?: string
  bidDueDate?:    string
  estimatedValue?: number
  probabilityPct?: number
  notes?:         string
  createdBy?:     string
}

export async function createProposal(
  tenantId: string,
  input:    CreateProposalInput,
): Promise<Proposal> {
  const res = await tenantQuery(tenantId, `
    INSERT INTO proposals
      (tenant_id, proposal_number, title, client_name, client_contact,
       bid_due_date, estimated_value, probability_pct, notes, created_by)
    VALUES (
      $1,
      COALESCE((SELECT MAX(proposal_number) FROM proposals WHERE tenant_id=$1), 0) + 1,
      $2,$3,$4,$5,$6,$7,$8,$9
    )
    RETURNING *
  `, [
    tenantId,
    input.title,
    input.clientName,
    input.clientContact  ?? null,
    input.bidDueDate     ?? null,
    input.estimatedValue ?? 0,
    input.probabilityPct ?? 50,
    input.notes          ?? null,
    input.createdBy      ?? null,
  ])
  return rowToProposal(res.rows[0] as Record<string, unknown>)
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listProposals(
  tenantId: string,
  opts:     { status?: ProposalStatus; limit?: number } = {},
): Promise<Proposal[]> {
  const conditions = ['p.tenant_id = $1']
  const params: unknown[] = [tenantId]
  let idx = 2

  if (opts.status) { conditions.push(`p.status = $${idx++}`); params.push(opts.status) }

  const res = await tenantQuery(tenantId, `
    SELECT
      p.*,
      COUNT(pi.id)::int            AS item_count,
      COALESCE(SUM(pi.total), 0)   AS items_total
    FROM proposals p
    LEFT JOIN proposal_items pi ON pi.proposal_id = p.id AND pi.tenant_id = p.tenant_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY p.id
    ORDER BY p.bid_due_date ASC NULLS LAST, p.created_at DESC
    LIMIT ${opts.limit ?? 200}
  `, params)
  return res.rows.map(r => rowToProposal(r as Record<string, unknown>))
}

// ─── Get ──────────────────────────────────────────────────────────────────────

export async function getProposal(
  tenantId: string,
  id:       string,
): Promise<Proposal | null> {
  const res = await tenantQuery(tenantId, `
    SELECT
      p.*,
      COUNT(pi.id)::int            AS item_count,
      COALESCE(SUM(pi.total), 0)   AS items_total
    FROM proposals p
    LEFT JOIN proposal_items pi ON pi.proposal_id = p.id AND pi.tenant_id = p.tenant_id
    WHERE p.tenant_id = $1 AND p.id = $2
    GROUP BY p.id
  `, [tenantId, id])
  return res.rows.length ? rowToProposal(res.rows[0] as Record<string, unknown>) : null
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateProposal(
  tenantId: string,
  id:       string,
  patch:    Partial<Omit<CreateProposalInput, 'createdBy'>>,
): Promise<Proposal | null> {
  const res = await tenantQuery(tenantId, `
    UPDATE proposals SET
      title           = COALESCE($3, title),
      client_name     = COALESCE($4, client_name),
      client_contact  = COALESCE($5, client_contact),
      bid_due_date    = COALESCE($6, bid_due_date),
      estimated_value = COALESCE($7, estimated_value),
      probability_pct = COALESCE($8, probability_pct),
      notes           = COALESCE($9, notes),
      updated_at      = NOW()
    WHERE tenant_id = $1 AND id = $2 AND status IN ('draft','submitted')
    RETURNING *
  `, [tenantId, id,
      patch.title          ?? null,
      patch.clientName     ?? null,
      patch.clientContact  ?? null,
      patch.bidDueDate     ?? null,
      patch.estimatedValue ?? null,
      patch.probabilityPct ?? null,
      patch.notes          ?? null])
  return res.rows.length ? rowToProposal(res.rows[0] as Record<string, unknown>) : null
}

// ─── Status transitions ───────────────────────────────────────────────────────

async function transitionStatus(
  tenantId:   string,
  id:         string,
  toStatus:   ProposalStatus,
  fromStatus: ProposalStatus[],
  extraSet?:  string,
  extraParams?: unknown[],
): Promise<Proposal | null> {
  const fromList = fromStatus.map((_, i) => `$${i + 4}`).join(',')
  const base = [tenantId, id, toStatus, ...fromStatus]
  const extra = extraParams ?? []
  const res = await tenantQuery(tenantId, `
    UPDATE proposals SET
      status     = $3,
      updated_at = NOW()
      ${extraSet ? `, ${extraSet}` : ''}
    WHERE tenant_id = $1 AND id = $2 AND status IN (${fromList})
    RETURNING *
  `, [...base, ...extra])
  return res.rows.length ? rowToProposal(res.rows[0] as Record<string, unknown>) : null
}

export const submitProposal = (tenantId: string, id: string) =>
  transitionStatus(tenantId, id, 'submitted', ['draft'],
    `submitted_date = CURRENT_DATE`)

export const markWon = (tenantId: string, id: string) =>
  transitionStatus(tenantId, id, 'won', ['submitted', 'draft'],
    `decided_date = CURRENT_DATE, probability_pct = 100`)

export const markLost = (tenantId: string, id: string) =>
  transitionStatus(tenantId, id, 'lost', ['submitted', 'draft'],
    `decided_date = CURRENT_DATE, probability_pct = 0`)

export const markNoBid = (tenantId: string, id: string) =>
  transitionStatus(tenantId, id, 'no_bid', ['draft'])

// ─── Items ────────────────────────────────────────────────────────────────────

function rowToItem(r: Record<string, unknown>): ProposalItem {
  return {
    id:          r['id']          as string,
    tenantId:    r['tenant_id']   as string,
    proposalId:  r['proposal_id'] as string,
    sortOrder:   Number(r['sort_order']),
    description: r['description'] as string,
    quantity:    Number(r['quantity']),
    unit:        r['unit']        as string | null,
    unitCost:    Number(r['unit_cost']),
    total:       Number(r['total']),
    createdAt:   r['created_at']  as string,
  }
}

export async function listProposalItems(tenantId: string, proposalId: string): Promise<ProposalItem[]> {
  const res = await tenantQuery(tenantId, `
    SELECT * FROM proposal_items
    WHERE tenant_id = $1 AND proposal_id = $2
    ORDER BY sort_order ASC, created_at ASC
  `, [tenantId, proposalId])
  return res.rows.map(r => rowToItem(r as Record<string, unknown>))
}

export async function addProposalItem(
  tenantId:   string,
  proposalId: string,
  input:      { description: string; quantity?: number; unit?: string; unitCost: number },
): Promise<ProposalItem> {
  const res = await tenantQuery(tenantId, `
    INSERT INTO proposal_items
      (tenant_id, proposal_id, sort_order, description, quantity, unit, unit_cost)
    VALUES (
      $1, $2,
      COALESCE((SELECT MAX(sort_order) FROM proposal_items WHERE tenant_id=$1 AND proposal_id=$2), 0) + 10,
      $3, $4, $5, $6
    )
    RETURNING *
  `, [tenantId, proposalId, input.description, input.quantity ?? 1, input.unit ?? null, input.unitCost])
  // Sync estimated_value with items total
  await tenantQuery(tenantId, `
    UPDATE proposals SET
      estimated_value = (SELECT COALESCE(SUM(total),0) FROM proposal_items WHERE tenant_id=$1 AND proposal_id=$2),
      updated_at = NOW()
    WHERE tenant_id=$1 AND id=$2
  `, [tenantId, proposalId])
  return rowToItem(res.rows[0] as Record<string, unknown>)
}

/**
 * Patch one line item, bound to the proposal whose path addressed it.
 *
 * ADR-014 Phase 3J §22/D27: `PATCH /proposals/:id/items/:itemId` previously
 * located the item by id and tenant alone — `:id` was never read, so the parent
 * segment was decoration and any proposal id in the path reached any item in
 * the tenant. Proposals are tenant-level CRM records, so no caller crossed an
 * authorization boundary today; the binding exists so the route means what its
 * path says, and so it stays correct if proposals ever gain a project parent.
 */
export async function updateProposalItem(
  tenantId:   string,
  itemId:     string,
  patch:      Partial<{ description: string; quantity: number; unit: string; unitCost: number }>,
  proposalId: string,
): Promise<ProposalItem | null> {
  const res = await tenantQuery(tenantId, `
    UPDATE proposal_items SET
      description = COALESCE($3, description),
      quantity    = COALESCE($4, quantity),
      unit        = COALESCE($5, unit),
      unit_cost   = COALESCE($6, unit_cost)
    WHERE tenant_id = $1 AND id = $2 AND proposal_id = $7
    RETURNING *
  `, [tenantId, itemId,
      patch.description ?? null,
      patch.quantity    ?? null,
      patch.unit        ?? null,
      patch.unitCost    ?? null,
      proposalId])
  if (!res.rows.length) return null
  const item = rowToItem(res.rows[0] as Record<string, unknown>)
  await tenantQuery(tenantId, `
    UPDATE proposals SET
      estimated_value = (SELECT COALESCE(SUM(total),0) FROM proposal_items WHERE tenant_id=$1 AND proposal_id=$2),
      updated_at = NOW()
    WHERE tenant_id=$1 AND id=$2
  `, [tenantId, item.proposalId])
  return item
}

/** Delete one line item, bound to its parent proposal — see `updateProposalItem`. */
export async function deleteProposalItem(
  tenantId: string, itemId: string, proposalId: string,
): Promise<boolean> {
  const res = await tenantQuery(tenantId, `
    DELETE FROM proposal_items
     WHERE tenant_id=$1 AND id=$2 AND proposal_id=$3 RETURNING proposal_id
  `, [tenantId, itemId, proposalId])
  // Recompute the parent total only when a row was actually removed.
  if ((res.rowCount ?? 0) > 0) {
    await tenantQuery(tenantId, `
      UPDATE proposals SET
        estimated_value = (SELECT COALESCE(SUM(total),0) FROM proposal_items WHERE tenant_id=$1 AND proposal_id=$2),
        updated_at = NOW()
      WHERE tenant_id=$1 AND id=$2
    `, [tenantId, proposalId])
  }
  return (res.rowCount ?? 0) > 0
}

// ─── Pipeline summary ─────────────────────────────────────────────────────────

export async function getPipelineSummary(tenantId: string): Promise<PipelineSummary> {
  const res = await tenantQuery(tenantId, `
    SELECT
      status,
      COUNT(*)::int          AS cnt,
      COALESCE(SUM(estimated_value), 0) AS val
    FROM proposals
    WHERE tenant_id = $1
    GROUP BY status
  `, [tenantId])

  const statuses: ProposalStatus[] = ['draft', 'submitted', 'won', 'lost', 'no_bid']
  const byStatus = Object.fromEntries(
    statuses.map(s => [s, { count: 0, value: 0 }]),
  ) as Record<ProposalStatus, { count: number; value: number }>

  let totalProposals = 0
  for (const row of res.rows as Record<string, unknown>[]) {
    const s = row['status'] as ProposalStatus
    byStatus[s] = { count: Number(row['cnt']), value: Number(row['val']) }
    totalProposals += Number(row['cnt'])
  }

  // Weighted pipeline: draft (prob%) + submitted (prob%)
  const wpRes = await tenantQuery(tenantId, `
    SELECT COALESCE(SUM(estimated_value * probability_pct / 100.0), 0) AS weighted
    FROM proposals
    WHERE tenant_id=$1 AND status IN ('draft','submitted')
  `, [tenantId])
  const weightedPipeline = Number(wpRes.rows[0]?.['weighted'] ?? 0)

  const won  = byStatus['won'].count
  const lost = byStatus['lost'].count
  const winRate = (won + lost) > 0 ? Math.round((won / (won + lost)) * 100) : 0

  const totalValue = byStatus['won'].value
  const avgDealSize = won > 0 ? totalValue / won : 0

  return { totalProposals, byStatus, weightedPipeline, winRate, avgDealSize }
}
