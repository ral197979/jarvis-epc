/**
 * JARVIS EPC — BIM Models API Route
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.31.0 — Autodesk-parity 3D coordination model register + clash/issue tracker.
 *
 * Endpoints:
 *   GET    /api/v1/projects/:projectId/bim-models
 *   POST   /api/v1/projects/:projectId/bim-models
 *   GET    /api/v1/bim-models/:id
 *   PATCH  /api/v1/bim-models/:id
 *   DELETE /api/v1/bim-models/:id
 *   GET    /api/v1/projects/:projectId/bim-issues
 *   POST   /api/v1/projects/:projectId/bim-issues
 *   PATCH  /api/v1/bim-issues/:id
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth   as any)
router.use(requireTenant as any)

const FORMATS = new Set(['ifc','glb','gltf','nwd','rvt'])

router.get('/projects/:projectId/bim-models', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT * FROM bim_models WHERE tenant_id=$1 AND project_id=$2
        ORDER BY updated_at DESC`,
      [r.tenantId!, req.params.projectId])
    res.json({ models: result.rows, total: result.rowCount })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list BIM models' })
  }
})

router.post('/projects/:projectId/bim-models', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body ?? {}
  if (!b.name || !b.format) return res.status(400).json({ error: 'name and format required' })
  if (!FORMATS.has(b.format)) return res.status(400).json({ error: `format must be one of ${[...FORMATS].join(',')}` })
  try {
    const result = await tenantQuery(r.tenantId!,
      `INSERT INTO bim_models
        (tenant_id, project_id, name, discipline, format, document_id, size_bytes,
         element_count, coord_system, georef, metadata, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [r.tenantId!, req.params.projectId, b.name,
       b.discipline ?? null, b.format, b.document_id ?? null,
       b.size_bytes ?? 0, b.element_count ?? null, b.coord_system ?? null,
       JSON.stringify(b.georef ?? {}), JSON.stringify(b.metadata ?? {}),
       b.status ?? 'active', (r as any).auth?.sub ?? null])
    res.status(201).json({ model: result.rows[0] })
  } catch (e) {
    console.error('[bim] create model error', e)
    res.status(500).json({ error: 'Failed to create BIM model' })
  }
})

router.get('/bim-models/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT * FROM bim_models WHERE id=$1 AND tenant_id=$2`,
      [req.params.id, r.tenantId!])
    if (!result.rows[0]) return res.status(404).json({ error: 'Model not found' })
    res.json({ model: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch model' })
  }
})

router.patch('/bim-models/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['name','discipline','document_id','size_bytes','element_count',
                   'coord_system','georef','metadata','status']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  const values = updates.map(([k, v]) =>
    (k === 'georef' || k === 'metadata') ? JSON.stringify(v ?? {}) : v as any)
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(r.tenantId!,
      `UPDATE bim_models SET ${setClauses.join(', ')} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, ...values])
    if (!result.rows[0]) return res.status(404).json({ error: 'Model not found' })
    res.json({ model: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Failed to update model' })
  }
})

router.delete('/bim-models/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    await tenantQuery(r.tenantId!,
      'DELETE FROM bim_models WHERE id=$1 AND tenant_id=$2',
      [req.params.id, r.tenantId!])
    res.json({ deleted: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete model' })
  }
})

// ─── BIM Issues ──────────────────────────────────────────────────────────────
router.get('/projects/:projectId/bim-issues', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { status, severity, model_id } = req.query
  const params: unknown[] = [r.tenantId!, req.params.projectId]
  const filters: string[] = []
  if (status)   { params.push(status);   filters.push(`status=$${params.length}`) }
  if (severity) { params.push(severity); filters.push(`severity=$${params.length}`) }
  if (model_id) { params.push(model_id); filters.push(`model_id=$${params.length}`) }
  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT * FROM bim_issues WHERE tenant_id=$1 AND project_id=$2 ${where}
        ORDER BY created_at DESC`, params)
    res.json({ issues: result.rows })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list BIM issues' })
  }
})

router.post('/projects/:projectId/bim-issues', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body ?? {}
  if (!b.title) return res.status(400).json({ error: 'title required' })
  try {
    const result = await tenantQuery(r.tenantId!,
      `INSERT INTO bim_issues
        (tenant_id, project_id, model_id, title, description, severity, status,
         element_ids, viewpoint, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [r.tenantId!, req.params.projectId, b.model_id ?? null, b.title,
       b.description ?? null, b.severity ?? 'minor', b.status ?? 'open',
       JSON.stringify(b.element_ids ?? []), JSON.stringify(b.viewpoint ?? {}),
       b.assigned_to ?? null, (r as any).auth?.sub ?? null])
    res.status(201).json({ issue: result.rows[0] })
  } catch (e) {
    console.error('[bim-issues] create error', e)
    res.status(500).json({ error: 'Failed to create BIM issue' })
  }
})

router.patch('/bim-issues/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['title','description','severity','status','element_ids','viewpoint','assigned_to']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  const values = updates.map(([k, v]) =>
    (k === 'element_ids' || k === 'viewpoint') ? JSON.stringify(v ?? (k === 'element_ids' ? [] : {})) : v as any)
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(r.tenantId!,
      `UPDATE bim_issues SET ${setClauses.join(', ')} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, ...values])
    if (!result.rows[0]) return res.status(404).json({ error: 'Issue not found' })
    res.json({ issue: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Failed to update issue' })
  }
})

export { router as bimRouter }
