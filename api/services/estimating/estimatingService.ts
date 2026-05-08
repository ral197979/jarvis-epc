/**
 * Denver Engineering — Estimating Service (v10.0.0)
 * ──────────────────────────────────────────────────
 * Quantity takeoff → cost lookup → estimate assembly.
 *
 * Three takeoff paths:
 *   1. BIM-driven:  auto-extracted from bim_elements.quantities
 *   2. Manual:      caller-supplied takeoff_items rows
 *   3. Ava-driven:  AI agent posts elements → this service resolves costs
 *
 * Cost lookup priority:
 *   tenant custom → platform RSMeans library → AI-estimated fallback
 */
import { pool, tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TakeoffInput {
  element_id?:    string
  csi_section?:   string
  description:    string
  quantity_type:  'count' | 'length' | 'area' | 'volume' | 'weight' | 'duration'
  quantity:       number
  unit:           string
  source?:        'bim' | 'manual' | 'ai'
  confidence?:    number
  notes?:         string
}

export interface EstimateCreateInput {
  project_id?:     string
  model_id?:       string
  name:            string
  description?:    string
  estimate_type?:  string
  currency?:       string
  contingency_pct?: number
  region?:         string
  generated_by?:   string
  notes?:          string
}

export interface CostItem {
  id:            string
  csi_section:   string
  csi_code:      string
  description:   string
  unit:          string
  material_cost: number
  labor_cost:    number
  equipment_cost: number
  total_cost:    number
  overhead_pct:  number
  source:        string
}

export interface EstimateLineDraft {
  takeoff_id?:     string
  cost_item_id?:   string
  csi_section?:    string
  description:     string
  quantity:        number
  unit:            string
  unit_material:   number
  unit_labor:      number
  unit_equipment:  number
}

// ─── Cost lookup ──────────────────────────────────────────────────────────────

export async function findCostItem(
  tenantId:   string,
  csiSection: string,
  unit:       string,
  region?:    string,
): Promise<CostItem | null> {
  // 1. Tenant-specific override first
  // 2. Fall back to platform library (tenant_id IS NULL)
  const res = await pool.query(
    `SELECT * FROM cost_items
     WHERE csi_section = $1
       AND unit = $2
       AND is_active = true
       AND (tenant_id = $3 OR tenant_id IS NULL)
       AND ($4::text IS NULL OR region = $4 OR region IS NULL)
     ORDER BY
       (tenant_id = $3) DESC,         -- tenant override first
       (region = $4) DESC NULLS LAST, -- regional match preferred
       source DESC                     -- rsmeans > custom > ai_estimated
     LIMIT 1`,
    [csiSection, unit, tenantId, region ?? null],
  )
  return (res.rows[0] as CostItem) ?? null
}

export async function searchCostItems(
  tenantId:  string,
  query:     string,
  region?:   string,
  limit = 20,
): Promise<CostItem[]> {
  const res = await pool.query(
    `SELECT * FROM cost_items
     WHERE is_active = true
       AND (tenant_id = $1 OR tenant_id IS NULL)
       AND ($3::text IS NULL OR region = $3 OR region IS NULL)
       AND to_tsvector('english', description) @@ plainto_tsquery('english', $2)
     ORDER BY (tenant_id = $1) DESC, ts_rank(to_tsvector('english', description), plainto_tsquery('english', $2)) DESC
     LIMIT $4`,
    [tenantId, query, region ?? null, limit],
  )
  return res.rows as CostItem[]
}

// ─── Takeoff ──────────────────────────────────────────────────────────────────

export async function createTakeoffItems(
  tenantId:  string,
  modelId:   string,
  items:     TakeoffInput[],
  createdBy: string,
): Promise<string[]> {
  if (!items.length) return []
  const ids: string[] = []
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`)
    for (const item of items) {
      const res = await client.query(
        `INSERT INTO takeoff_items
           (tenant_id, model_id, element_id, csi_section, description,
            quantity_type, quantity, unit, source, confidence, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [
          tenantId, modelId, item.element_id ?? null,
          item.csi_section ?? null, item.description,
          item.quantity_type, item.quantity, item.unit,
          item.source ?? 'manual', item.confidence ?? null,
          item.notes ?? null, createdBy,
        ],
      )
      ids.push(res.rows[0].id as string)
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return ids
}

export async function getTakeoffItems(
  tenantId: string,
  modelId:  string,
): Promise<TakeoffInput & { id: string; element_id: string | null; created_at: string }[]> {
  const res = await tenantQuery(tenantId,
    `SELECT * FROM takeoff_items WHERE tenant_id=$1 AND model_id=$2 ORDER BY created_at`,
    [tenantId, modelId])
  return res.rows as never
}

// ─── Auto-takeoff from BIM elements ──────────────────────────────────────────
// Reads quantity data already stored on bim_elements and converts to takeoff_items.

const IFC_TO_CSI: Record<string, { csi: string; qty: 'area' | 'volume' | 'length' | 'count'; unit: string }> = {
  IfcWall:            { csi: '04 20 00', qty: 'area',   unit: 'SF' },
  IfcWallStandardCase:{ csi: '04 20 00', qty: 'area',   unit: 'SF' },
  IfcSlab:            { csi: '03 30 00', qty: 'area',   unit: 'SF' },
  IfcBeam:            { csi: '05 12 00', qty: 'length', unit: 'LF' },
  IfcColumn:          { csi: '05 12 00', qty: 'length', unit: 'LF' },
  IfcDoor:            { csi: '08 14 00', qty: 'count',  unit: 'EA' },
  IfcWindow:          { csi: '08 51 00', qty: 'count',  unit: 'EA' },
  IfcRoof:            { csi: '07 31 00', qty: 'area',   unit: 'SF' },
  IfcFoundation:      { csi: '03 30 00', qty: 'volume', unit: 'CY' },
  IfcPipeSegment:     { csi: '22 10 00', qty: 'length', unit: 'LF' },
  IfcDuctSegment:     { csi: '23 31 00', qty: 'length', unit: 'LF' },
  IfcCableSegment:    { csi: '26 05 00', qty: 'length', unit: 'LF' },
  IfcFlowTerminal:    { csi: '22 40 00', qty: 'count',  unit: 'EA' },
  IfcLightFixture:    { csi: '26 51 00', qty: 'count',  unit: 'EA' },
  IfcOutlet:          { csi: '26 27 00', qty: 'count',  unit: 'EA' },
}

const QTY_KEY: Record<string, string> = {
  area:   'GrossArea',
  volume: 'GrossVolume',
  length: 'Length',
  count:  '', // count = 1 per element
}

export async function autoTakeoffFromBim(
  tenantId:  string,
  modelId:   string,
  createdBy: string,
): Promise<{ items_created: number }> {
  const res = await tenantQuery(tenantId,
    `SELECT id, ifc_type, name, quantities FROM bim_elements
     WHERE tenant_id=$1 AND model_id=$2`,
    [tenantId, modelId])

  const items: (TakeoffInput & { element_id: string })[] = []

  for (const el of res.rows) {
    const mapping = IFC_TO_CSI[el.ifc_type as string]
    if (!mapping) continue

    const qtyKey = QTY_KEY[mapping.qty]
    const qty: number = mapping.qty === 'count'
      ? 1
      : parseFloat((el.quantities as Record<string, string>)[qtyKey] ?? '0')

    if (qty <= 0) continue

    // Convert SI units from IFC to imperial (SF, LF, CY, EA)
    const converted = convertIfcUnits(qty, mapping.qty)

    items.push({
      element_id:    el.id as string,
      csi_section:   mapping.csi,
      description:   `${el.ifc_type}: ${el.name ?? 'unnamed'}`,
      quantity_type: mapping.qty,
      quantity:      converted,
      unit:          mapping.unit,
      source:        'bim',
      confidence:    0.85,
    })
  }

  // Upsert: delete existing BIM-sourced takeoff for this model, re-insert
  await tenantQuery(tenantId,
    `DELETE FROM takeoff_items WHERE tenant_id=$1 AND model_id=$2 AND source='bim'`,
    [tenantId, modelId])

  await createTakeoffItems(tenantId, modelId, items, createdBy)
  return { items_created: items.length }
}

function convertIfcUnits(value: number, type: 'area' | 'volume' | 'length' | 'count'): number {
  // IFC stores SI: m², m³, m → convert to SF, CY, LF
  switch (type) {
    case 'area':   return parseFloat((value * 10.7639).toFixed(2)) // m² → SF
    case 'volume': return parseFloat((value * 1.30795).toFixed(4)) // m³ → CY
    case 'length': return parseFloat((value * 3.28084).toFixed(2)) // m  → LF
    default:       return value
  }
}

// ─── Estimate CRUD ────────────────────────────────────────────────────────────

export async function createEstimate(
  tenantId:  string,
  input:     EstimateCreateInput,
  createdBy: string,
): Promise<{ id: string }> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO estimates
       (tenant_id, project_id, model_id, name, description, estimate_type,
        currency, contingency_pct, region, generated_by, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      tenantId,
      input.project_id   ?? null,
      input.model_id     ?? null,
      input.name,
      input.description  ?? null,
      input.estimate_type ?? 'construction',
      input.currency     ?? 'USD',
      input.contingency_pct ?? 10,
      input.region       ?? null,
      input.generated_by ?? 'manual',
      input.notes        ?? null,
      createdBy,
    ])
  return { id: res.rows[0].id as string }
}

export async function addEstimateLines(
  tenantId:   string,
  estimateId: string,
  lines:      EstimateLineDraft[],
): Promise<void> {
  if (!lines.length) return
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantId}'`)

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!
      await client.query(
        `INSERT INTO estimate_lines
           (tenant_id, estimate_id, takeoff_id, cost_item_id, csi_section,
            description, quantity, unit, unit_material, unit_labor, unit_equipment, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          tenantId, estimateId,
          l.takeoff_id    ?? null,
          l.cost_item_id  ?? null,
          l.csi_section   ?? null,
          l.description,
          l.quantity, l.unit,
          l.unit_material, l.unit_labor, l.unit_equipment,
          i,
        ],
      )
    }

    // Roll up totals onto estimate
    await client.query(
      `UPDATE estimates SET
         subtotal_material  = (SELECT coalesce(sum(extended_material),0)  FROM estimate_lines WHERE estimate_id=$1),
         subtotal_labor     = (SELECT coalesce(sum(extended_labor),0)     FROM estimate_lines WHERE estimate_id=$1),
         subtotal_equipment = (SELECT coalesce(sum(extended_equipment),0) FROM estimate_lines WHERE estimate_id=$1),
         subtotal_cost      = (SELECT coalesce(sum(line_total),0)         FROM estimate_lines WHERE estimate_id=$1),
         contingency_amount = (SELECT coalesce(sum(line_total),0) * (contingency_pct/100) FROM estimate_lines WHERE estimate_id=$1),
         total_cost         = (SELECT coalesce(sum(line_total),0) * (1 + contingency_pct/100) FROM estimates e2
                               JOIN estimate_lines el ON el.estimate_id = e2.id
                               WHERE e2.id=$1 GROUP BY e2.contingency_pct),
         updated_at = now()
       WHERE id=$1 AND tenant_id=$2`,
      [estimateId, tenantId],
    )

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function getEstimate(
  tenantId:   string,
  estimateId: string,
): Promise<{ estimate: Record<string, unknown>; lines: Record<string, unknown>[] } | null> {
  const [estRes, linesRes] = await Promise.all([
    tenantQuery(tenantId,
      'SELECT * FROM estimates WHERE id=$1 AND tenant_id=$2',
      [estimateId, tenantId]),
    tenantQuery(tenantId,
      'SELECT * FROM estimate_lines WHERE estimate_id=$1 ORDER BY sort_order',
      [estimateId]),
  ])
  if (!estRes.rows[0]) return null
  return { estimate: estRes.rows[0] as Record<string, unknown>, lines: linesRes.rows }
}

export async function listEstimates(
  tenantId:  string,
  projectId?: string,
): Promise<Record<string, unknown>[]> {
  const params: unknown[] = [tenantId]
  const filter = projectId ? `AND project_id=$2` : ''
  if (projectId) params.push(projectId)
  const res = await tenantQuery(tenantId,
    `SELECT id, name, status, estimate_type, total_cost, currency,
            generated_by, created_at, updated_at
     FROM estimates WHERE tenant_id=$1 ${filter}
     ORDER BY created_at DESC`,
    params)
  return res.rows
}
