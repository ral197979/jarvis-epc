/**
 * Denver Engineering — Earned Value Management Service (v10.3.0)
 * ──────────────────────────────────────────────────────────────
 * ANSI/EIA-748 compliant EVM engine.
 *
 * Planned Value (BCWS): linear spread of each WBS entry's BAC between
 * its planned_start and planned_finish dates.
 *
 * Earned Value (BCWP): BAC × latest recorded % complete for each entry.
 *
 * Actual Cost (ACWP): sum of evm_actuals entries up to the status date.
 */
import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvmBaseline {
  id: string
  projectId: string
  name: string
  bac: number
  startDate: string
  finishDate: string
  isActive: boolean
  approvedAt: string | null
  createdAt: string
}

export interface EvmWbsEntry {
  id: string
  baselineId: string
  wbsCode: string
  name: string
  bac: number
  scheduleTaskId: string | null
  plannedStart: string | null
  plannedFinish: string | null
  sortOrder: number
}

export interface EvmActual {
  id: string
  projectId: string
  wbsEntryId: string | null
  periodDate: string
  amount: number
  description: string | null
  reference: string | null
  recordedBy: string | null
  createdAt: string
}

export interface EvmProgress {
  id: string
  wbsEntryId: string
  periodDate: string
  percentComplete: number
  notes: string | null
}

export interface EvmMetrics {
  bac:  number
  bcws: number
  bcwp: number
  acwp: number
  cpi:  number | null
  spi:  number | null
  cv:   number
  sv:   number
  eac:  number | null
  etc:  number | null
  vac:  number | null
  tcpi: number | null
  statusDate: string
  health: 'green' | 'yellow' | 'red'
}

export interface EvmSnapshot {
  snapshotDate: string
  bac:  number
  bcws: number
  bcwp: number
  acwp: number
  cpi:  number | null
  spi:  number | null
  eac:  number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number { return Math.round(n * 100) / 100 }

/** Linear BCWS for one WBS entry at statusDate */
function plannedValue(
  bac: number,
  plannedStart: string | null,
  plannedFinish: string | null,
  statusDate: Date,
): number {
  if (!plannedStart || !plannedFinish) return 0
  const s = new Date(plannedStart).getTime()
  const f = new Date(plannedFinish).getTime()
  const t = statusDate.getTime()
  if (t <= s) return 0
  if (t >= f) return bac
  return bac * (t - s) / (f - s)
}

function deriveIndices(bac: number, bcws: number, bcwp: number, acwp: number): Omit<EvmMetrics, 'statusDate' | 'health'> {
  const cpi  = acwp > 0 ? round2(bcwp / acwp) : null
  const spi  = bcws > 0 ? round2(bcwp / bcws) : null
  const cv   = round2(bcwp - acwp)
  const sv   = round2(bcwp - bcws)
  const eac  = cpi != null && cpi > 0 ? round2(bac / cpi) : null
  const etc  = eac != null ? round2(eac - acwp) : null
  const vac  = eac != null ? round2(bac - eac) : null
  const tcpi = acwp < bac && bcwp < bac
    ? round2((bac - bcwp) / (bac - acwp))
    : null

  return { bac: round2(bac), bcws: round2(bcws), bcwp: round2(bcwp), acwp: round2(acwp), cpi, spi, cv, sv, eac, etc, vac, tcpi }
}

function healthStatus(cpi: number | null, spi: number | null): 'green' | 'yellow' | 'red' {
  const minIndex = Math.min(cpi ?? 1, spi ?? 1)
  if (minIndex >= 0.95) return 'green'
  if (minIndex >= 0.85) return 'yellow'
  return 'red'
}

// ─── Baseline CRUD ────────────────────────────────────────────────────────────

export async function createBaseline(
  tenantId: string,
  input: {
    projectId: string
    name?: string
    bac: number
    startDate: string
    finishDate: string
  },
): Promise<EvmBaseline> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO evm_baselines
       (tenant_id, project_id, name, bac, start_date, finish_date)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [tenantId, input.projectId, input.name ?? 'Performance Measurement Baseline',
     input.bac, input.startDate, input.finishDate],
  )
  return _mapBaseline(res.rows[0])
}

export async function getActiveBaseline(tenantId: string, projectId: string): Promise<EvmBaseline | null> {
  const res = await tenantQuery(tenantId,
    `SELECT * FROM evm_baselines WHERE tenant_id=$1 AND project_id=$2 AND is_active=TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, projectId],
  )
  return res.rows[0] ? _mapBaseline(res.rows[0]) : null
}

export async function listBaselines(tenantId: string, projectId: string): Promise<EvmBaseline[]> {
  const res = await tenantQuery(tenantId,
    `SELECT * FROM evm_baselines WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at DESC`,
    [tenantId, projectId],
  )
  return res.rows.map(_mapBaseline)
}

// ─── WBS entries ──────────────────────────────────────────────────────────────

export async function upsertWbsEntries(
  tenantId: string,
  baselineId: string,
  projectId: string,
  entries: Array<{
    wbsCode: string
    name: string
    bac: number
    scheduleTaskId?: string
    plannedStart?: string
    plannedFinish?: string
    sortOrder?: number
  }>,
): Promise<EvmWbsEntry[]> {
  // Validate baseline belongs to the stated project (EVM-001)
  const blCheck = await tenantQuery(tenantId,
    `SELECT project_id FROM evm_baselines WHERE id=$1 AND tenant_id=$2`,
    [baselineId, tenantId],
  )
  if (!blCheck.rows[0]) throw new Error('Baseline not found')
  if (blCheck.rows[0].project_id !== projectId) throw new Error('projectId does not match baseline project')

  const results: EvmWbsEntry[] = []
  for (const e of entries) {
    const res = await tenantQuery(tenantId,
      `INSERT INTO evm_wbs_entries
         (tenant_id, baseline_id, project_id, wbs_code, name, bac,
          schedule_task_id, planned_start, planned_finish, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, baseline_id, wbs_code) DO UPDATE SET
         name=EXCLUDED.name, bac=EXCLUDED.bac,
         schedule_task_id=EXCLUDED.schedule_task_id,
         planned_start=EXCLUDED.planned_start, planned_finish=EXCLUDED.planned_finish,
         sort_order=EXCLUDED.sort_order, updated_at=now()
       RETURNING *`,
      [tenantId, baselineId, projectId, e.wbsCode, e.name, e.bac,
       e.scheduleTaskId ?? null, e.plannedStart ?? null,
       e.plannedFinish ?? null, e.sortOrder ?? 0],
    )
    if (res.rows[0]) results.push(_mapWbs(res.rows[0]))
  }
  return results
}

export async function listWbsEntries(tenantId: string, baselineId: string): Promise<EvmWbsEntry[]> {
  const res = await tenantQuery(tenantId,
    `SELECT * FROM evm_wbs_entries WHERE tenant_id=$1 AND baseline_id=$2 ORDER BY sort_order, wbs_code`,
    [tenantId, baselineId],
  )
  return res.rows.map(_mapWbs)
}

// ─── Actuals (ACWP) ───────────────────────────────────────────────────────────

export async function recordActual(
  tenantId: string,
  input: {
    projectId: string
    wbsEntryId?: string
    periodDate: string
    amount: number
    description?: string
    reference?: string
    recordedBy?: string
  },
): Promise<EvmActual> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO evm_actuals
       (tenant_id, project_id, wbs_entry_id, period_date, amount, description, reference, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [tenantId, input.projectId, input.wbsEntryId ?? null, input.periodDate,
     input.amount, input.description ?? null, input.reference ?? null, input.recordedBy ?? null],
  )
  return _mapActual(res.rows[0])
}

export async function listActuals(tenantId: string, projectId: string): Promise<EvmActual[]> {
  const res = await tenantQuery(tenantId,
    `SELECT * FROM evm_actuals WHERE tenant_id=$1 AND project_id=$2 ORDER BY period_date DESC`,
    [tenantId, projectId],
  )
  return res.rows.map(_mapActual)
}

// ─── Progress (BCWP) ──────────────────────────────────────────────────────────

export async function recordProgress(
  tenantId: string,
  input: {
    projectId: string
    wbsEntryId: string
    periodDate: string
    percentComplete: number
    notes?: string
    recordedBy?: string
  },
): Promise<EvmProgress> {
  const res = await tenantQuery(tenantId,
    `INSERT INTO evm_progress
       (tenant_id, project_id, wbs_entry_id, period_date, percent_complete, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, wbs_entry_id, period_date)
     DO UPDATE SET percent_complete = EXCLUDED.percent_complete, notes = EXCLUDED.notes
     RETURNING *`,
    [tenantId, input.projectId, input.wbsEntryId, input.periodDate,
     input.percentComplete, input.notes ?? null, input.recordedBy ?? null],
  )
  return _mapProgress(res.rows[0])
}

// ─── EVM computation ──────────────────────────────────────────────────────────

export async function computeEvmMetrics(
  tenantId: string,
  projectId: string,
  statusDate?: string,
): Promise<EvmMetrics | null> {
  const baseline = await getActiveBaseline(tenantId, projectId)
  if (!baseline) return null

  const date = statusDate ? new Date(statusDate) : new Date()
  const dateStr = date.toISOString().slice(0, 10)

  // WBS entries for this baseline
  const wbsRes = await tenantQuery(tenantId,
    `SELECT * FROM evm_wbs_entries WHERE tenant_id=$1 AND baseline_id=$2`,
    [tenantId, baseline.id],
  )
  const wbsEntries = wbsRes.rows

  // Latest % complete per WBS entry up to statusDate
  const progressRes = await tenantQuery(tenantId,
    `SELECT DISTINCT ON (wbs_entry_id) wbs_entry_id, percent_complete
     FROM evm_progress
     WHERE tenant_id=$1 AND project_id=$2 AND period_date <= $3
     ORDER BY wbs_entry_id, period_date DESC`,
    [tenantId, projectId, dateStr],
  )
  const progressMap = new Map<string, number>(
    progressRes.rows.map(r => [r.wbs_entry_id as string, Number(r.percent_complete)])
  )

  // Cumulative actuals up to statusDate
  const actualsRes = await tenantQuery(tenantId,
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM evm_actuals WHERE tenant_id=$1 AND project_id=$2 AND period_date <= $3`,
    [tenantId, projectId, dateStr],
  )
  const acwp = Number(actualsRes.rows[0].total)

  // Compute BCWS and BCWP by summing across all WBS entries
  let bcws = 0
  let bcwp = 0
  for (const row of wbsEntries) {
    const bac = Number(row.bac)
    const ps = row.planned_start as string | null
    const pf = row.planned_finish as string | null
    bcws += plannedValue(bac, ps, pf, date)
    const pct = progressMap.get(row.id as string) ?? 0
    bcwp += bac * pct / 100
  }

  const bac = baseline.bac
  const indices = deriveIndices(bac, bcws, bcwp, acwp)

  return {
    ...indices,
    statusDate: dateStr,
    health: healthStatus(indices.cpi, indices.spi),
  }
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

export async function takeSnapshot(
  tenantId: string,
  projectId: string,
  statusDate?: string,
): Promise<EvmMetrics | null> {
  const metrics = await computeEvmMetrics(tenantId, projectId, statusDate)
  if (!metrics) return null

  await tenantQuery(tenantId,
    `INSERT INTO evm_snapshots
       (tenant_id, project_id, snapshot_date,
        bac, bcws, bcwp, acwp, cpi, spi, cv, sv, eac, etc, vac, tcpi)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (tenant_id, project_id, snapshot_date)
     DO UPDATE SET
       bac=$4, bcws=$5, bcwp=$6, acwp=$7, cpi=$8, spi=$9,
       cv=$10, sv=$11, eac=$12, etc=$13, vac=$14, tcpi=$15`,
    [tenantId, projectId, metrics.statusDate,
     metrics.bac, metrics.bcws, metrics.bcwp, metrics.acwp,
     metrics.cpi, metrics.spi, metrics.cv, metrics.sv,
     metrics.eac, metrics.etc, metrics.vac, metrics.tcpi],
  )
  return metrics
}

export async function getScurveData(tenantId: string, projectId: string): Promise<EvmSnapshot[]> {
  const res = await tenantQuery(tenantId,
    `SELECT snapshot_date, bac, bcws, bcwp, acwp, cpi, spi, eac
     FROM evm_snapshots WHERE tenant_id=$1 AND project_id=$2
     ORDER BY snapshot_date ASC`,
    [tenantId, projectId],
  )
  return res.rows.map(r => ({
    snapshotDate: (r.snapshot_date as Date).toISOString().slice(0, 10),
    bac:  Number(r.bac),
    bcws: Number(r.bcws),
    bcwp: Number(r.bcwp),
    acwp: Number(r.acwp),
    cpi:  r.cpi != null ? Number(r.cpi) : null,
    spi:  r.spi != null ? Number(r.spi) : null,
    eac:  r.eac != null ? Number(r.eac) : null,
  }))
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function _mapBaseline(r: Record<string, unknown>): EvmBaseline {
  return {
    id:         r['id'] as string,
    projectId:  r['project_id'] as string,
    name:       r['name'] as string,
    bac:        Number(r['bac']),
    startDate:  (r['start_date'] as Date).toISOString().slice(0, 10),
    finishDate: (r['finish_date'] as Date).toISOString().slice(0, 10),
    isActive:   Boolean(r['is_active']),
    approvedAt: r['approved_at'] ? new Date(r['approved_at'] as string).toISOString() : null,
    createdAt:  new Date(r['created_at'] as string).toISOString(),
  }
}

function _mapWbs(r: Record<string, unknown>): EvmWbsEntry {
  return {
    id:             r['id'] as string,
    baselineId:     r['baseline_id'] as string,
    wbsCode:        r['wbs_code'] as string,
    name:           r['name'] as string,
    bac:            Number(r['bac']),
    scheduleTaskId: (r['schedule_task_id'] as string) ?? null,
    plannedStart:   r['planned_start'] ? (r['planned_start'] as Date).toISOString().slice(0, 10) : null,
    plannedFinish:  r['planned_finish'] ? (r['planned_finish'] as Date).toISOString().slice(0, 10) : null,
    sortOrder:      Number(r['sort_order'] ?? 0),
  }
}

function _mapActual(r: Record<string, unknown>): EvmActual {
  return {
    id:          r['id'] as string,
    projectId:   r['project_id'] as string,
    wbsEntryId:  (r['wbs_entry_id'] as string) ?? null,
    periodDate:  (r['period_date'] as Date).toISOString().slice(0, 10),
    amount:      Number(r['amount']),
    description: (r['description'] as string) ?? null,
    reference:   (r['reference'] as string) ?? null,
    recordedBy:  (r['recorded_by'] as string) ?? null,
    createdAt:   new Date(r['created_at'] as string).toISOString(),
  }
}

function _mapProgress(r: Record<string, unknown>): EvmProgress {
  return {
    id:              r['id'] as string,
    wbsEntryId:      r['wbs_entry_id'] as string,
    periodDate:      (r['period_date'] as Date).toISOString().slice(0, 10),
    percentComplete: Number(r['percent_complete']),
    notes:           (r['notes'] as string) ?? null,
  }
}


