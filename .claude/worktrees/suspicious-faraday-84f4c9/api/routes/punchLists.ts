/**
 * JARVIS EPC — Punch Lists API Route
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.31.0 — Quality closeout punch lists with item tracking, verification, and closure.
 *
 * Endpoints:
 *   GET    /api/v1/projects/:projectId/punch-lists
 *   POST   /api/v1/projects/:projectId/punch-lists
 *   GET    /api/v1/punch-lists/:id
 *   PATCH  /api/v1/punch-lists/:id
 *   DELETE /api/v1/punch-lists/:id
 *   GET    /api/v1/punch-lists/:id/items
 *   POST   /api/v1/punch-lists/:id/items
 *   PATCH  /api/v1/punch-items/:id
 *   POST   /api/v1/punch-items/:id/verify
 *   POST   /api/v1/punch-items/:id/close
 *   DELETE /api/v1/punch-items/:id
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as any)
router.use(requireTenant() as any)

// ─── Punch Lists ─────────────────────────────────────────────────────────────

router.get('/projects/:projectId/punch-lists', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { projectId } = req.params
  const { status, limit = '100', offset = '0' } = req.query
  const params: unknown[] = [r.tenantId!, projectId]
  const filters: string[] = []
  if (status) {
    params.push(status)
    filters.push(`status = $${params.length}`)
  }
  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''
  params.push(parseInt(limit as string), parseInt(offset as string))
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `SELECT pl.id, pl.project_id, pl.title, pl.description, pl.status,
              COUNT(pi.id) as item_count,
              SUM(CASE WHEN pi.status='open' THEN 1 ELSE 0 END) as open_count,
              SUM(CASE WHEN pi.status='in_progress' THEN 1 ELSE 0 END) as in_progress_count,
              SUM(CASE WHEN pi.status='verified' THEN 1 ELSE 0 END) as verified_count,
              SUM(CASE WHEN pi.status='closed' THEN 1 ELSE 0 END) as closed_count,
              pl.created_by, pl.created_at, pl.updated_at
         FROM punch_lists pl
         LEFT JOIN punch_items pi ON pl.id = pi.punch_list_id AND pi.tenant_id=$1
        WHERE pl.tenant_id=$1 AND pl.project_id=$2 ${where}
        GROUP BY pl.id
        ORDER BY pl.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ punchLists: result.rows, total: result.rowCount })
  } catch (e) {
    console.error('[punch-lists] list error', e)
    res.status(500).json({ error: 'Failed to list punch lists' })
  }
})

router.post('/projects/:projectId/punch-lists', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { projectId } = req.params
  const b = req.body ?? {}
  if (!b.title) return res.status(400).json({ error: 'title required' })
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `INSERT INTO punch_lists
        (tenant_id, project_id, title, description, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [r.tenantId!, projectId, b.title, b.description ?? null, b.status ?? 'open', (r as any).auth?.sub ?? null]
    )
    res.status(201).json({ punchList: result.rows[0] })
  } catch (e) {
    console.error('[punch-lists] create error', e)
    res.status(500).json({ error: 'Failed to create punch list' })
  }
})

router.get('/punch-lists/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `SELECT pl.*,
              COUNT(pi.id) as item_count,
              SUM(CASE WHEN pi.status='open' THEN 1 ELSE 0 END) as open_count,
              SUM(CASE WHEN pi.status='in_progress' THEN 1 ELSE 0 END) as in_progress_count,
              SUM(CASE WHEN pi.status='verified' THEN 1 ELSE 0 END) as verified_count,
              SUM(CASE WHEN pi.status='closed' THEN 1 ELSE 0 END) as closed_count
         FROM punch_lists pl
         LEFT JOIN punch_items pi ON pl.id = pi.punch_list_id AND pi.tenant_id=$1
        WHERE pl.id=$2 AND pl.tenant_id=$1
        GROUP BY pl.id`,
      [r.tenantId!, req.params.id]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Punch list not found' })
    res.json({ punchList: result.rows[0] })
  } catch (e) {
    console.error('[punch-lists] get error', e)
    res.status(500).json({ error: 'Failed to fetch punch list' })
  }
})

router.patch('/punch-lists/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['title', 'description', 'status']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  const values = updates.map(([, v]) => v as any)
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `UPDATE punch_lists SET ${setClauses.join(', ')} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, ...values]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Punch list not found' })
    res.json({ punchList: result.rows[0] })
  } catch (e) {
    console.error('[punch-lists] patch error', e)
    res.status(500).json({ error: 'Failed to update punch list' })
  }
})

router.delete('/punch-lists/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    await tenantQuery(r.tenantId!, 'DELETE FROM punch_lists WHERE id=$1 AND tenant_id=$2', [req.params.id, r.tenantId!])
    res.json({ deleted: true })
  } catch (e) {
    console.error('[punch-lists] delete error', e)
    res.status(500).json({ error: 'Failed to delete punch list' })
  }
})

// ─── Punch Items ─────────────────────────────────────────────────────────────

router.get('/punch-lists/:id/items', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { status, priority, assigned_to } = req.query
  const params: unknown[] = [req.params.id, r.tenantId!]
  const filters: string[] = []
  if (status) {
    params.push(status)
    filters.push(`status = $${params.length}`)
  }
  if (priority) {
    params.push(priority)
    filters.push(`priority = $${params.length}`)
  }
  if (assigned_to) {
    params.push(assigned_to)
    filters.push(`assigned_to = $${params.length}::uuid`)
  }
  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `SELECT * FROM punch_items
        WHERE punch_list_id=$1 AND tenant_id=$2 ${where}
        ORDER BY item_number ASC`,
      params
    )
    res.json({ items: result.rows })
  } catch (e) {
    console.error('[punch-items] list error', e)
    res.status(500).json({ error: 'Failed to list punch items' })
  }
})

router.post('/punch-lists/:id/items', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body ?? {}
  if (!b.title) return res.status(400).json({ error: 'title required' })

  // Get the punch list to ensure it exists and get project_id
  const plResult = await tenantQuery(
    r.tenantId!,
    'SELECT project_id FROM punch_lists WHERE id=$1 AND tenant_id=$2',
    [req.params.id, r.tenantId!]
  )
  if (!plResult.rows[0]) return res.status(404).json({ error: 'Punch list not found' })

  // Auto-generate item_number via MAX+1
  const numResult = await tenantQuery(
    r.tenantId!,
    'SELECT COALESCE(MAX(item_number), 0) + 1 as next_number FROM punch_items WHERE punch_list_id=$1 AND tenant_id=$2',
    [req.params.id, r.tenantId!]
  )
  const nextNumber = numResult.rows[0]?.next_number ?? 1

  try {
    const result = await tenantQuery(
      r.tenantId!,
      `INSERT INTO punch_items
        (tenant_id, punch_list_id, project_id, item_number, title, description, location, discipline,
         priority, status, assigned_to, due_date, drawing_id, pin_x, pin_y, photos, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        r.tenantId!,
        req.params.id,
        plResult.rows[0].project_id,
        nextNumber,
        b.title,
        b.description ?? null,
        b.location ?? null,
        b.discipline ?? null,
        b.priority ?? 'medium',
        b.status ?? 'open',
        b.assigned_to ?? null,
        b.due_date ?? null,
        b.drawing_id ?? null,
        b.pin_x ?? null,
        b.pin_y ?? null,
        JSON.stringify(b.photos ?? []),
        (r as any).auth?.sub ?? null
      ]
    )
    res.status(201).json({ item: result.rows[0] })
  } catch (e) {
    console.error('[punch-items] create error', e)
    res.status(500).json({ error: 'Failed to create punch item' })
  }
})

router.patch('/punch-items/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['title', 'description', 'location', 'discipline', 'priority', 'status', 'assigned_to', 'due_date', 'drawing_id', 'pin_x', 'pin_y', 'photos']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  const values = updates.map(([k, v]) => (k === 'photos' ? JSON.stringify(v ?? []) : v) as any)
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `UPDATE punch_items SET ${setClauses.join(', ')} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, ...values]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Punch item not found' })
    res.json({ item: result.rows[0] })
  } catch (e) {
    console.error('[punch-items] patch error', e)
    res.status(500).json({ error: 'Failed to update punch item' })
  }
})

router.post('/punch-items/:id/verify', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `UPDATE punch_items
        SET status='verified', verified_by=$3, verified_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, (r as any).auth?.sub ?? null]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Punch item not found' })
    res.json({ item: result.rows[0] })
  } catch (e) {
    console.error('[punch-items] verify error', e)
    res.status(500).json({ error: 'Failed to verify punch item' })
  }
})

router.post('/punch-items/:id/close', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(
      r.tenantId!,
      `UPDATE punch_items
        SET status='closed', closed_by=$3, closed_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, (r as any).auth?.sub ?? null]
    )
    if (!result.rows[0]) return res.status(404).json({ error: 'Punch item not found' })
    res.json({ item: result.rows[0] })
  } catch (e) {
    console.error('[punch-items] close error', e)
    res.status(500).json({ error: 'Failed to close punch item' })
  }
})

router.delete('/punch-items/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    await tenantQuery(r.tenantId!, 'DELETE FROM punch_items WHERE id=$1 AND tenant_id=$2', [req.params.id, r.tenantId!])
    res.json({ deleted: true })
  } catch (e) {
    console.error('[punch-items] delete error', e)
    res.status(500).json({ error: 'Failed to delete punch item' })
  }
})

export { router as punchListsRouter }
