/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Denver Engineering — Drawings API Route
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.31.0 — Autodesk/Procore-parity plans register with revisions and markups.
 *
 * Endpoints:
 *   GET    /api/v1/projects/:projectId/drawings
 *   POST   /api/v1/projects/:projectId/drawings
 *   GET    /api/v1/drawings/:id
 *   PATCH  /api/v1/drawings/:id
 *   DELETE /api/v1/drawings/:id
 *   GET    /api/v1/drawings/:id/revisions
 *   POST   /api/v1/drawings/:id/revisions
 *   GET    /api/v1/drawings/:id/markups
 *   POST   /api/v1/drawings/:id/markups
 *   PATCH  /api/v1/markups/:markupId
 *   DELETE /api/v1/markups/:markupId
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'

import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope, requireRecordScope } from '../authz/recordScope'
type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth   as any)
router.use(requireTenant() as any)

router.get('/projects/:projectId/drawings', requireCapability('engineering.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { projectId } = req.params
  const { discipline, set_name, limit = '200', offset = '0' } = req.query
  const params: unknown[] = [r.tenantId!, projectId]
  const filters: string[] = []
  if (discipline) { params.push(discipline); filters.push(`discipline = $${params.length}`) }
  if (set_name)   { params.push(set_name);   filters.push(`set_name  = $${params.length}`) }
  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''
  params.push(parseInt(limit as string), parseInt(offset as string))
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT id, sheet_number, title, discipline, current_rev, set_name, issue_date,
              document_id, scale, page_count, metadata, created_at, updated_at
         FROM drawings
        WHERE tenant_id=$1 AND project_id=$2 ${where}
        ORDER BY sheet_number
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ drawings: result.rows, total: result.rowCount })
  } catch (e) {
    console.error('[drawings] list error', e)
    res.status(500).json({ error: 'Failed to list drawings' })
  }
})

router.post('/projects/:projectId/drawings', requireCapability('engineering.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { projectId } = req.params
  const b = req.body ?? {}
  if (!b.sheet_number || !b.title) return res.status(400).json({ error: 'sheet_number and title required' })
  try {
    const result = await tenantQuery(r.tenantId!,
      `INSERT INTO drawings
        (tenant_id, project_id, sheet_number, title, discipline, current_rev, set_name,
         issue_date, document_id, scale, page_count, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [r.tenantId!, projectId, b.sheet_number, b.title,
       b.discipline ?? null, b.current_rev ?? 'A', b.set_name ?? null,
       b.issue_date ?? null, b.document_id ?? null, b.scale ?? null,
       b.page_count ?? 1, b.metadata ? JSON.stringify(b.metadata) : '{}', (r as any).auth?.sub ?? null]
    )
    res.status(201).json({ drawing: result.rows[0] })
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Duplicate sheet_number + rev' })
    console.error('[drawings] create error', e)
    res.status(500).json({ error: 'Failed to create drawing' })
  }
})

router.get('/drawings/:id', requireCapability('engineering.view') as never, requireRecordScope('drawing') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT * FROM drawings WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, r.tenantId!])
    if (!result.rows[0]) return res.status(404).json({ error: 'Drawing not found' })
    res.json({ drawing: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch drawing' })
  }
})

router.patch('/drawings/:id', requireCapability('engineering.write') as never, requireRecordScope('drawing') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['sheet_number','title','discipline','current_rev','set_name',
                   'issue_date','document_id','scale','page_count','metadata']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  const values = updates.map(([k, v]) => k === 'metadata' ? JSON.stringify(v ?? {}) : v as any)
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(r.tenantId!,
      `UPDATE drawings SET ${setClauses.join(', ')} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, ...values])
    if (!result.rows[0]) return res.status(404).json({ error: 'Drawing not found' })
    res.json({ drawing: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Failed to update drawing' })
  }
})

router.delete('/drawings/:id', requireCapability('engineering.write') as never, requireRecordScope('drawing') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    await tenantQuery(r.tenantId!,
      'DELETE FROM drawings WHERE id=$1 AND tenant_id=$2',
      [req.params.id, r.tenantId!])
    res.json({ deleted: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete drawing' })
  }
})

// ─── Revisions ───────────────────────────────────────────────────────────────
router.get('/drawings/:id/revisions', requireCapability('engineering.view') as never, requireRecordScope('drawing') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT * FROM drawing_revisions WHERE drawing_id=$1 AND tenant_id=$2
        ORDER BY issued_date DESC`,
      [req.params.id, r.tenantId!])
    res.json({ revisions: result.rows })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list revisions' })
  }
})

router.post('/drawings/:id/revisions', requireCapability('engineering.write') as never, requireRecordScope('drawing') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body ?? {}
  if (!b.rev || !b.issued_date) return res.status(400).json({ error: 'rev and issued_date required' })
  try {
    const result = await tenantQuery(r.tenantId!,
      `INSERT INTO drawing_revisions
        (tenant_id, drawing_id, rev, issued_date, reason, document_id, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [r.tenantId!, req.params.id, b.rev, b.issued_date,
       b.reason ?? null, b.document_id ?? null, (r as any).auth?.sub ?? null])
    // Update current_rev on the parent drawing
    await tenantQuery(r.tenantId!,
      `UPDATE drawings SET current_rev=$3, document_id=COALESCE($4, document_id), updated_at=NOW()
        WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, r.tenantId!, b.rev, b.document_id ?? null])
    res.status(201).json({ revision: result.rows[0] })
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Revision already exists' })
    res.status(500).json({ error: 'Failed to create revision' })
  }
})

// ─── Markups ─────────────────────────────────────────────────────────────────
router.get('/drawings/:id/markups', requireCapability('engineering.view') as never, requireRecordScope('drawing') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { rev, resolved } = req.query
  const params: unknown[] = [req.params.id, r.tenantId!]
  const filters: string[] = []
  if (rev)      { params.push(rev);      filters.push(`rev=$${params.length}`) }
  if (resolved != null) { params.push(resolved === 'true'); filters.push(`resolved=$${params.length}`) }
  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT * FROM drawing_markups WHERE drawing_id=$1 AND tenant_id=$2 ${where}
        ORDER BY created_at DESC`,
      params)
    res.json({ markups: result.rows })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list markups' })
  }
})

router.post('/drawings/:id/markups', requireCapability('engineering.write') as never, requireRecordScope('drawing') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body ?? {}
  if (!b.rev) return res.status(400).json({ error: 'rev required' })
  try {
    const result = await tenantQuery(r.tenantId!,
      `INSERT INTO drawing_markups
        (tenant_id, drawing_id, rev, page, title, annotations, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [r.tenantId!, req.params.id, b.rev, b.page ?? 1,
       b.title ?? null, JSON.stringify(b.annotations ?? []), (r as any).auth?.sub ?? null])
    res.status(201).json({ markup: result.rows[0] })
  } catch (e) {
    console.error('[markups] create error', e)
    res.status(500).json({ error: 'Failed to create markup' })
  }
})

router.patch('/markups/:markupId', requireCapability('engineering.write') as never, requireRecordScope('drawingmarkup', 'markupId') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['title','annotations','page','resolved']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  const values = updates.map(([k, v]) => k === 'annotations' ? JSON.stringify(v ?? []) : v as any)
  if (updates.some(([k, v]) => k === 'resolved' && v === true)) {
    setClauses.push(`resolved_by = '${(r as any).auth?.sub ?? ''}'::uuid`, `resolved_at = NOW()`)
  }
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(r.tenantId!,
      `UPDATE drawing_markups SET ${setClauses.join(', ')}
        WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.markupId, r.tenantId!, ...values])
    if (!result.rows[0]) return res.status(404).json({ error: 'Markup not found' })
    res.json({ markup: result.rows[0] })
  } catch (e) {
    console.error('[markups] patch error', e)
    res.status(500).json({ error: 'Failed to update markup' })
  }
})

router.delete('/markups/:markupId', requireCapability('engineering.write') as never, requireRecordScope('drawingmarkup', 'markupId') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    await tenantQuery(r.tenantId!,
      'DELETE FROM drawing_markups WHERE id=$1 AND tenant_id=$2',
      [req.params.markupId, r.tenantId!])
    res.json({ deleted: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete markup' })
  }
})

export { router as drawingsRouter }
