/**
 * JARVIS EPC — Plant Engineering Import Route (G3)
 * POST /api/v1/import/plant  — accepts CSV or JSON tag list (P&ID, equipment, instruments)
 * Supports dry-run + commit phases.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import { slog } from '../../src/modules/observability/index'

type Req = Request & AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as any)
router.use(requireTenant() as any)

const REQUIRED_FIELDS = ['tag', 'service']

function parseRows(raw: unknown): { rows: Record<string, string>[]; errors: string[] } {
  const errors: string[] = []
  let rows: Record<string, string>[] = []

  if (Array.isArray(raw)) {
    rows = raw.map((r, i) => {
      if (typeof r !== 'object' || r === null) { errors.push(`Row ${i}: not an object`); return {} as Record<string, string> }
      return r as Record<string, string>
    }).filter(r => Object.keys(r).length > 0)
  } else {
    errors.push('Expected array of tag objects')
  }

  rows.forEach((r, i) => {
    for (const f of REQUIRED_FIELDS) {
      if (!r[f]) errors.push(`Row ${i}: missing required field "${f}"`)
    }
  })

  return { rows, errors }
}

// POST /api/v1/import/plant
router.post('/import/plant', async (req: Request, res: Response) => {
  const r = req as Req
  const { dry_run = true, source_system = 'unknown', data } = req.body ?? {}

  if (!data) return res.status(400).json({ error: 'data required (array of tag records)' })

  const { rows, errors } = parseRows(data)
  if (errors.length > 0) return res.status(422).json({ error: 'Validation failed', details: errors, parsed: rows.length })

  if (dry_run) {
    return res.json({
      dry_run: true,
      parsed: rows.length,
      sample: rows.slice(0, 3),
      fields_found: rows.length > 0 ? Object.keys(rows[0]) : [],
      message: `Dry run OK — ${rows.length} tags would be imported from ${source_system}. Set dry_run=false to commit.`,
    })
  }

  try {
    let inserted = 0
    for (const row of rows) {
      await tenantQuery(r.tenantId!, `
        INSERT INTO plant_tags (tenant_id, tag, service, unit, line_size, pid_ref,
          from_equipment, to_equipment, rev, discipline, source_system, raw)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (tenant_id, tag) DO UPDATE SET
          service=$3, unit=$4, line_size=$5, pid_ref=$6,
          from_equipment=$7, to_equipment=$8, rev=$9, discipline=$10,
          source_system=$11, raw=$12, updated_at=NOW()`,
        [r.tenantId!, row['tag'], row['service'] ?? '',
         row['unit'] ?? null, row['line_size'] ?? null, row['pid_ref'] ?? null,
         row['from_equipment'] ?? null, row['to_equipment'] ?? null,
         row['rev'] ?? null, row['discipline'] ?? null,
         source_system, JSON.stringify(row)])
      inserted++
    }
    slog('INFO', 'plant-import', 'Plant tags imported', { count: inserted, source_system, tenantId: r.tenantId })
    res.status(201).json({ imported: inserted, source_system, message: `${inserted} tags imported from ${source_system}` })
  } catch (e) {
    console.error('[plant] import error', e)
    res.status(500).json({ error: 'Import failed' })
  }
})

// GET /api/v1/import/plant — list imported tags
router.get('/import/plant', async (req: Request, res: Response) => {
  const r = req as Req
  try {
    const { source_system, search } = req.query as Record<string, string>
    const conditions: string[] = []
    const values: unknown[] = [r.tenantId!]
    if (source_system) { conditions.push(`source_system = $${values.length + 1}`); values.push(source_system) }
    if (search) { conditions.push(`(tag ILIKE $${values.length + 1} OR service ILIKE $${values.length + 1})`); values.push(`%${search}%`) }
    const where = conditions.length ? 'AND ' + conditions.join(' AND ') : ''
    const result = await tenantQuery(r.tenantId!, `SELECT * FROM plant_tags WHERE tenant_id=$1 ${where} ORDER BY tag LIMIT 200`, values)
    res.json({ tags: result.rows, total: result.rowCount })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list plant tags' })
  }
})

export { router as plantRouter }
