/**
 * Denver Engineering — Cost Entry Service (v10.11.0)
 *
 * Manages actual cost entries (labor, material, equipment, etc.)
 * Posting an entry writes to evm_actuals and locks the record.
 */
import { tenantQuery, tenantTransaction } from '../../db/pool'

export type CostEntryType   = 'labor' | 'material' | 'equipment' | 'subcontract' | 'other'
export type CostEntryStatus = 'draft' | 'posted' | 'void'

export interface CostEntry {
  id:           string
  tenantId:     string
  projectId:    string
  entryDate:    string
  entryType:    CostEntryType
  wbsCode:      string | null
  description:  string
  amount:       number
  quantity:     number | null
  unit:         string | null
  unitCost:     number | null
  status:       CostEntryStatus
  postedAt:     string | null
  postedBy:     string | null
  evmActualId:  string | null
  createdBy:    string | null
  createdAt:    string
  updatedAt:    string
}

export interface CostEntrySummary {
  totalPosted:   number
  byType:        Record<CostEntryType, number>
  draftCount:    number
  postedCount:   number
}

function rowToEntry(r: Record<string, unknown>): CostEntry {
  return {
    id:           r['id'] as string,
    tenantId:     r['tenant_id'] as string,
    projectId:    r['project_id'] as string,
    entryDate:    r['entry_date'] as string,
    entryType:    r['entry_type'] as CostEntryType,
    wbsCode:      r['wbs_code'] as string | null,
    description:  r['description'] as string,
    amount:       Number(r['amount']),
    quantity:     r['quantity'] !== null ? Number(r['quantity']) : null,
    unit:         r['unit'] as string | null,
    unitCost:     r['unit_cost'] !== null ? Number(r['unit_cost']) : null,
    status:       r['status'] as CostEntryStatus,
    postedAt:     r['posted_at'] as string | null,
    postedBy:     r['posted_by'] as string | null,
    evmActualId:  r['evm_actual_id'] as string | null,
    createdBy:    r['created_by'] as string | null,
    createdAt:    r['created_at'] as string,
    updatedAt:    r['updated_at'] as string,
  }
}

// ─── Create ───────────────────────────────────────────────────────────────────

export interface CreateCostEntryInput {
  projectId:   string
  entryDate:   string
  entryType:   CostEntryType
  wbsCode?:    string
  description: string
  amount:      number
  quantity?:   number
  unit?:       string
  unitCost?:   number
  createdBy?:  string
}

export async function createCostEntry(
  tenantId: string,
  input: CreateCostEntryInput,
): Promise<CostEntry> {
  const res = await tenantQuery(tenantId, `
    INSERT INTO cost_entries
      (tenant_id, project_id, entry_date, entry_type, wbs_code, description,
       amount, quantity, unit, unit_cost, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
  `, [
    tenantId,
    input.projectId,
    input.entryDate,
    input.entryType ?? 'labor',
    input.wbsCode   ?? null,
    input.description,
    input.amount,
    input.quantity  ?? null,
    input.unit      ?? null,
    input.unitCost  ?? null,
    input.createdBy ?? null,
  ])
  return rowToEntry(res.rows[0] as Record<string, unknown>)
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface ListCostEntriesOptions {
  entryType?: CostEntryType
  status?:    CostEntryStatus
  dateFrom?:  string
  dateTo?:    string
  limit?:     number
}

export async function listCostEntries(
  tenantId:  string,
  projectId: string,
  opts:      ListCostEntriesOptions = {},
): Promise<CostEntry[]> {
  const conditions: string[] = ['tenant_id = $1', 'project_id = $2']
  const params: unknown[]    = [tenantId, projectId]
  let   idx = 3

  if (opts.entryType) { conditions.push(`entry_type = $${idx++}`); params.push(opts.entryType) }
  if (opts.status)    { conditions.push(`status = $${idx++}`);      params.push(opts.status) }
  if (opts.dateFrom)  { conditions.push(`entry_date >= $${idx++}`); params.push(opts.dateFrom) }
  if (opts.dateTo)    { conditions.push(`entry_date <= $${idx++}`); params.push(opts.dateTo) }

  const limit = opts.limit ?? 200
  const res = await tenantQuery(tenantId, `
    SELECT * FROM cost_entries
    WHERE ${conditions.join(' AND ')}
    ORDER BY entry_date DESC, created_at DESC
    LIMIT ${limit}
  `, params)
  return res.rows.map(r => rowToEntry(r as Record<string, unknown>))
}

// ─── Get ──────────────────────────────────────────────────────────────────────

export async function getCostEntry(
  tenantId: string,
  id:       string,
): Promise<CostEntry | null> {
  const res = await tenantQuery(tenantId, `
    SELECT * FROM cost_entries WHERE tenant_id = $1 AND id = $2
  `, [tenantId, id])
  return res.rows.length ? rowToEntry(res.rows[0] as Record<string, unknown>) : null
}

// ─── Update (draft only) ──────────────────────────────────────────────────────

export async function updateCostEntry(
  tenantId: string,
  id:       string,
  patch:    Partial<Pick<CreateCostEntryInput, 'entryDate' | 'entryType' | 'wbsCode' | 'description' | 'amount' | 'quantity' | 'unit' | 'unitCost'>>,
): Promise<CostEntry | null> {
  const res = await tenantQuery(tenantId, `
    UPDATE cost_entries SET
      entry_date  = COALESCE($3, entry_date),
      entry_type  = COALESCE($4::cost_entry_type, entry_type),
      wbs_code    = COALESCE($5, wbs_code),
      description = COALESCE($6, description),
      amount      = COALESCE($7, amount),
      quantity    = COALESCE($8, quantity),
      unit        = COALESCE($9, unit),
      unit_cost   = COALESCE($10, unit_cost),
      updated_at  = NOW()
    WHERE tenant_id = $1 AND id = $2 AND status = 'draft'
    RETURNING *
  `, [tenantId, id, patch.entryDate ?? null, patch.entryType ?? null, patch.wbsCode ?? null,
      patch.description ?? null, patch.amount ?? null, patch.quantity ?? null,
      patch.unit ?? null, patch.unitCost ?? null])
  return res.rows.length ? rowToEntry(res.rows[0] as Record<string, unknown>) : null
}

// ─── Delete (draft only) ──────────────────────────────────────────────────────

export async function deleteCostEntry(
  tenantId: string,
  id:       string,
): Promise<boolean> {
  const res = await tenantQuery(tenantId, `
    DELETE FROM cost_entries
    WHERE tenant_id = $1 AND id = $2 AND status = 'draft'
  `, [tenantId, id])
  return (res.rowCount ?? 0) > 0
}

// ─── Post (draft → posted, inserts into evm_actuals) ─────────────────────────

export async function postCostEntry(
  tenantId: string,
  id:       string,
  postedBy: string,
): Promise<CostEntry | null> {
  return tenantTransaction(tenantId, async (client) => {
    // Lock and fetch the entry
    const entryRes = await client.query(
      `SELECT * FROM cost_entries WHERE tenant_id = $1 AND id = $2 AND status = 'draft' FOR UPDATE`,
      [tenantId, id],
    )
    if (!entryRes.rows.length) return null

    const entry = entryRes.rows[0] as Record<string, unknown>

    // Resolve wbs_entry_id from wbs_code if provided
    let wbsEntryId: string | null = null
    if (entry['wbs_code']) {
      const wbsRes = await client.query(
        `SELECT id FROM evm_wbs_entries
         WHERE tenant_id = $1 AND project_id = $2 AND wbs_code = $3
         LIMIT 1`,
        [tenantId, entry['project_id'], entry['wbs_code']],
      )
      wbsEntryId = wbsRes.rows[0]?.['id'] as string | null ?? null
    }

    // Insert into evm_actuals (matches 053_evm.sql schema)
    const actualRes = await client.query(
      `INSERT INTO evm_actuals
         (tenant_id, project_id, wbs_entry_id, amount, period_date, description)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [
        tenantId,
        entry['project_id'],
        wbsEntryId,
        entry['amount'],
        entry['entry_date'],
        entry['description'],
      ],
    )
    const evmActualId = actualRes.rows[0]?.['id'] as string | undefined

    // Lock the entry
    const updatedRes = await client.query(
      `UPDATE cost_entries SET
         status        = 'posted',
         posted_at     = NOW(),
         posted_by     = $3,
         evm_actual_id = $4,
         updated_at    = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, postedBy, evmActualId ?? null],
    )
    return rowToEntry(updatedRes.rows[0] as Record<string, unknown>)
  })
}

// ─── Void ─────────────────────────────────────────────────────────────────────

export async function voidCostEntry(
  tenantId: string,
  id:       string,
): Promise<CostEntry | null> {
  const res = await tenantQuery(tenantId, `
    UPDATE cost_entries SET status = 'void', updated_at = NOW()
    WHERE tenant_id = $1 AND id = $2 AND status = 'draft'
    RETURNING *
  `, [tenantId, id])
  return res.rows.length ? rowToEntry(res.rows[0] as Record<string, unknown>) : null
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export async function getCostEntrySummary(
  tenantId:  string,
  projectId: string,
): Promise<CostEntrySummary> {
  const res = await tenantQuery(tenantId, `
    SELECT
      entry_type,
      status,
      COALESCE(SUM(amount), 0) AS total
    FROM cost_entries
    WHERE tenant_id = $1 AND project_id = $2 AND status != 'void'
    GROUP BY entry_type, status
  `, [tenantId, projectId])

  const byType: Record<string, number> = {
    labor: 0, material: 0, equipment: 0, subcontract: 0, other: 0,
  }
  let totalPosted = 0
  let draftCount  = 0
  let postedCount = 0

  for (const row of res.rows as Record<string, unknown>[]) {
    const t = row['entry_type'] as string
    const s = row['status']     as string
    const v = Number(row['total'])
    if (s === 'posted') {
      byType[t] = (byType[t] ?? 0) + v
      totalPosted += v
      postedCount++
    } else {
      draftCount++
    }
  }

  return {
    totalPosted,
    byType: byType as Record<CostEntryType, number>,
    draftCount,
    postedCount,
  }
}
