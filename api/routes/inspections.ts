/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Denver Engineering — Inspections API Route
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.31.0 — Inspection templates and records with checklist evaluation and results.
 *
 * Endpoints:
 *   GET    /api/v1/projects/:projectId/inspection-templates
 *   POST   /api/v1/inspection-templates
 *   PATCH  /api/v1/inspection-templates/:id
 *   GET    /api/v1/projects/:projectId/inspections
 *   POST   /api/v1/projects/:projectId/inspections
 *   GET    /api/v1/inspections/:id
 *   PATCH  /api/v1/inspections/:id
 *   POST   /api/v1/inspections/:id/complete
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import { requireCapability } from '../authz/requireCapability'
import { createAction } from '../services/actionService'  // v4.33.0 Ava

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as any)
router.use(requireTenant() as any)

// ─── Inspection Templates ────────────────────────────────────────────────────

router.get('/projects/:projectId/inspection-templates', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { category, discipline } = req.query
  const params: unknown[] = [r.tenantId!]
  const filters: string[] = ["is_active = true"]
  if (category) {
    params.push(category)
    filters.push(`category = $${params.length}`)
  }
  if (discipline) {
    params.push(discipline)
    filters.push(`discipline = $${params.length}`)
  }
  const where = filters.join(' AND ')
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `SELECT id, name, category, discipline, checklist, version, is_active, created_by, created_at, updated_at
         FROM inspection_templates
        WHERE tenant_id=$1 AND ${where}
        ORDER BY name ASC`,
      params
    )
    res.json({ templates: result.rows })
  } catch (e) {
    console.error('[inspection-templates] list error', e)
    res.status(500).json({ error: 'Failed to list inspection templates' })
  }
})

router.post('/inspection-templates', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body ?? {}
  if (!b.name) return res.status(400).json({ error: 'name required' })
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `INSERT INTO inspection_templates
        (tenant_id, name, category, discipline, checklist, version, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        r.tenantId!,
        b.name,
        b.category ?? null,
        b.discipline ?? null,
        JSON.stringify(b.checklist ?? []),
        1,
        b.is_active !== false,
        (r as any).auth?.sub ?? null
      ]
    )
    res.status(201).json({ template: result.rows[0] })
  } catch (e) {
    console.error('[inspection-templates] create error', e)
    res.status(500).json({ error: 'Failed to create inspection template' })
  }
})

router.patch('/inspection-templates/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['name', 'category', 'discipline', 'checklist', 'is_active', 'version']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  const values = updates.map(([k, v]) => (k === 'checklist' ? JSON.stringify(v ?? []) : v) as any)
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `UPDATE inspection_templates SET ${setClauses.join(', ')} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, ...values]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Inspection template not found' })
    res.json({ template: result.rows[0] })
  } catch (e) {
    console.error('[inspection-templates] patch error', e)
    res.status(500).json({ error: 'Failed to update inspection template' })
  }
})

// ─── Inspections ────────────────────────────────────────────────────────────

router.get('/projects/:projectId/inspections', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { projectId } = req.params
  const { status, type, discipline, limit = '100', offset = '0' } = req.query
  const params: unknown[] = [r.tenantId!, projectId]
  const filters: string[] = []
  if (status) {
    params.push(status)
    filters.push(`status = $${params.length}`)
  }
  if (type) {
    params.push(type)
    filters.push(`type = $${params.length}`)
  }
  if (discipline) {
    params.push(discipline)
    filters.push(`discipline = $${params.length}`)
  }
  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''
  params.push(parseInt(limit as string), parseInt(offset as string))
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `SELECT id, project_id, template_id, inspection_number, title, type, location, discipline,
              status, scheduled_date, completed_date, inspector_id,
              pass_count, fail_count, na_count, overall_result,
              notes, photos, signatures, created_by, created_at, updated_at
         FROM inspections
        WHERE tenant_id=$1 AND project_id=$2 ${where}
        ORDER BY inspection_number DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ inspections: result.rows, total: result.rowCount })
  } catch (e) {
    console.error('[inspections] list error', e)
    res.status(500).json({ error: 'Failed to list inspections' })
  }
})

router.post('/projects/:projectId/inspections', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const projectId = req.params.projectId as string
  const b = req.body ?? {}
  if (!b.title) return res.status(400).json({ error: 'title required' })

  // Auto-generate inspection_number like INS-001
  const numResult = await tenantQuery(
    r.tenantId!,
    `SELECT COUNT(*) as cnt FROM inspections WHERE tenant_id=$1 AND project_id=$2`,
    [r.tenantId!, projectId]
  )
  const nextNum = (numResult.rows[0]?.cnt ?? 0) + 1
  const inspectionNumber = `INS-${String(nextNum).padStart(3, '0')}`

  try {
    const result = await tenantQuery(
      r.tenantId!,
      `INSERT INTO inspections
        (tenant_id, project_id, template_id, inspection_number, title, type, location, discipline,
         status, scheduled_date, inspector_id, results, pass_count, fail_count, na_count,
         overall_result, notes, photos, signatures, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [
        r.tenantId!,
        projectId,
        b.template_id ?? null,
        inspectionNumber,
        b.title,
        b.type ?? null,
        b.location ?? null,
        b.discipline ?? null,
        b.status ?? 'scheduled',
        b.scheduled_date ?? null,
        b.inspector_id ?? null,
        JSON.stringify(b.results ?? []),
        0,
        0,
        0,
        null,
        b.notes ?? null,
        JSON.stringify(b.photos ?? []),
        JSON.stringify(b.signatures ?? []),
        (r as any).auth?.sub ?? null
      ]
    )
    const row = result.rows[0]
    void createAction(r.tenantId!, {
      title:               `Inspection ${row.inspection_number}: ${row.title}`,
      action_type:         'INSPECTION',
      source_module:       'inspections',
      source_id:           row.id,
      project_id:          projectId ?? null,
      priority:            'medium',
      assigned_to_user_id: row.inspector_id ?? null,
      created_by:          (r as any).auth?.sub ?? null,
    })
    res.status(201).json({ inspection: row })
  } catch (e) {
    console.error('[inspections] create error', e)
    res.status(500).json({ error: 'Failed to create inspection' })
  }
})

router.get('/inspections/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `SELECT i.*,
              t.name as template_name, t.category as template_category, t.discipline as template_discipline, t.checklist
         FROM inspections i
         LEFT JOIN inspection_templates t ON i.template_id = t.id AND t.tenant_id=$1
        WHERE i.id=$2 AND i.tenant_id=$1`,
      [r.tenantId!, req.params.id]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Inspection not found' })
    res.json({ inspection: result.rows[0] })
  } catch (e) {
    console.error('[inspections] get error', e)
    res.status(500).json({ error: 'Failed to fetch inspection' })
  }
})

router.patch('/inspections/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['title', 'type', 'location', 'discipline', 'status', 'scheduled_date', 'completed_date', 'inspector_id', 'results', 'notes', 'photos', 'signatures']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  const values = updates.map(([k, v]) => {
    if (k === 'results' || k === 'photos' || k === 'signatures') {
      return JSON.stringify(v ?? [])
    }
    return v as any
  })
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `UPDATE inspections SET ${setClauses.join(', ')} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, ...values]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Inspection not found' })
    res.json({ inspection: result.rows[0] })
  } catch (e) {
    console.error('[inspections] patch error', e)
    res.status(500).json({ error: 'Failed to update inspection' })
  }
})

router.post('/inspections/:id/complete', requireCapability('quality.verify') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body ?? {}

  // RBAC: finalizing an inspection is a quality gate; restrict to qualified roles.
  const role = (r as any).auth?.role ?? ''
  if (!['owner','admin','project_manager','engineer','inspector'].includes(role)) {
    return res.status(403).json({ error: 'forbidden', message: 'Completing inspections requires inspector, engineer, project_manager, admin, or owner role' })
  }

  // Get current inspection to access results
  const getResult = await tenantQuery(
    r.tenantId!,
    `SELECT results FROM inspections WHERE id=$1 AND tenant_id=$2`,
    [req.params.id, r.tenantId!]
  )
  if (!getResult.rows[0]) return res.status(404).json({ error: 'Inspection not found' })

  // Calculate pass/fail/na counts from results array
  const results = getResult.rows[0].results || []
  let passCount = 0
  let failCount = 0
  let naCount = 0
  let overallResult = 'pass'

  if (Array.isArray(results)) {
    results.forEach((r: any) => {
      if (r.result === 'pass') passCount++
      else if (r.result === 'fail') failCount++
      else if (r.result === 'na') naCount++
    })
    // Determine overall result: fail if any fails, else pass
    overallResult = failCount > 0 ? 'fail' : 'pass'
  }

  try {
    const result = await tenantQuery(
      r.tenantId!,
      `UPDATE inspections
        SET status='completed', completed_date=COALESCE($3, NOW()), pass_count=$4, fail_count=$5,
            na_count=$6, overall_result=$7,
            signatures = CASE WHEN $8::jsonb IS NOT NULL THEN $8::jsonb ELSE signatures END,
            updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, b.completed_date ?? null, passCount, failCount, naCount, overallResult,
       b.signatures != null ? JSON.stringify(b.signatures) : null]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Inspection not found' })
    res.json({ inspection: result.rows[0] })
  } catch (e) {
    console.error('[inspections] complete error', e)
    res.status(500).json({ error: 'Failed to complete inspection' })
  }
})

export { router as inspectionsRouter }
