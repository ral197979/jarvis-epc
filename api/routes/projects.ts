/**
 * JARVIS EPC — Projects Routes
 * ──────────────────────────────
 * v4.26.0 | GET/POST/PATCH/DELETE /api/v1/projects
 *
 * All routes require:
 *   - requireAuth    (sets req.auth)
 *   - requireTenant  (sets req.tenantId / req.tenant)
 *
 * Pagination: ?page=1&limit=25
 * Filtering:  ?status=active&phase=procurement&search=keyword
 * Sorting:    ?sort=name&dir=asc
 */

import { Router, Response } from 'express'
import { tenantQuery, tenantTransaction } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { slog } from '../../src/modules/observability/index'
import { randomBytes } from 'node:crypto'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()

// ─── Middleware stack ─────────────────────────────────────────────────────────

router.use(requireAuth as never)
router.use(requireTenant() as never)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _paginationParams(query: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(query['page']  ?? '1'), 10))
  const limit = Math.min(100, Math.max(1, parseInt(String(query['limit'] ?? '25'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

// ─── GET /api/v1/projects ─────────────────────────────────────────────────────

router.get('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _paginationParams(req.query as Record<string, unknown>)
  const { status, phase, search, sort = 'created_at', dir = 'desc' } = req.query as Record<string, string>

  const allowed = ['name','code','status','current_phase','budget','progress_pct','created_at','planned_finish']
  const sortCol = allowed.includes(sort) ? sort : 'created_at'
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC'

  const conditions: string[] = []
  const values: unknown[]    = []
  let   paramIdx             = 1

  if (status) { conditions.push(`status = $${paramIdx++}`); values.push(status) }
  if (phase)  { conditions.push(`current_phase = $${paramIdx++}`); values.push(phase) }
  if (search) {
    conditions.push(`(name ILIKE $${paramIdx} OR code ILIKE $${paramIdx} OR client_name ILIKE $${paramIdx})`)
    values.push(`%${search}%`)
    paramIdx++
  }

  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  const [dataRes, countRes] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT p.*,
             pm.display_name AS pm_name,
             le.display_name AS lead_engineer_name
      FROM projects p
      LEFT JOIN users pm ON pm.id = p.project_manager
      LEFT JOIN users le ON le.id = p.lead_engineer
      WHERE p.tenant_id = current_setting('app.current_tenant_id', true)::uuid
      ${where}
      ORDER BY p.${sortCol} ${sortDir}
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, [...values, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM projects
      WHERE tenant_id = current_setting('app.current_tenant_id', true)::uuid ${where}
    `, values),
  ])

  const total = parseInt(countRes.rows[0]?.count ?? '0', 10)
  res.json({
    data:  dataRes.rows,
    meta:  { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

// ─── GET /api/v1/projects/:id ─────────────────────────────────────────────────

router.get('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery(tenantId, `
    SELECT p.*,
           pm.display_name AS pm_name, pm.email AS pm_email,
           le.display_name AS lead_engineer_name,
           cb.display_name AS created_by_name,
           -- quick summary counts
           (SELECT COUNT(*) FROM rfis       WHERE project_id = p.id AND status != 'closed') AS open_rfis,
           (SELECT COUNT(*) FROM submittals WHERE project_id = p.id AND status NOT IN ('approved','closed')) AS pending_submittals,
           (SELECT COUNT(*) FROM purchase_orders WHERE project_id = p.id AND status NOT IN ('closed','cancelled')) AS active_pos,
           (SELECT COUNT(*) FROM risks      WHERE project_id = p.id AND status = 'open') AS open_risks,
           (SELECT COUNT(*) FROM action_items WHERE project_id = p.id AND status IN ('open','overdue')) AS open_actions,
           (SELECT COUNT(*) FROM wirs       WHERE project_id = p.id AND status NOT IN ('completed','waived')) AS open_wirs
    FROM projects p
    LEFT JOIN users pm ON pm.id = p.project_manager
    LEFT JOIN users le ON le.id = p.lead_engineer
    LEFT JOIN users cb ON cb.id = p.created_by
    WHERE p.id = $1
      AND p.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  `, [id])

  const project = result.rows[0]
  if (!project) { res.status(404).json({ error: 'not_found', message: 'Project not found.' }); return }

  res.json({ data: project })
})

// ─── POST /api/v1/projects ────────────────────────────────────────────────────

router.post('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const {
    code, name, description, client_name, location, country,
    status = 'planning', current_phase, contract_type, currency = 'USD',
    budget, planned_start, planned_finish, project_manager, lead_engineer, metadata = {},
  } = req.body as Record<string, unknown>

  if (!code || !name) {
    res.status(422).json({ error: 'validation', message: 'code and name are required.' })
    return
  }

  const result = await tenantQuery(tenantId, `
    INSERT INTO projects (
      tenant_id, code, name, description, client_name, location, country,
      status, current_phase, contract_type, currency,
      budget, planned_start, planned_finish,
      project_manager, lead_engineer, metadata, created_by
    ) VALUES (
      current_setting('app.current_tenant_id', true)::uuid,
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
    )
    RETURNING *
  `, [
    code, name, description ?? null, client_name ?? null, location ?? null, country ?? null,
    status, current_phase ?? null, contract_type ?? null, currency,
    budget ?? null, planned_start ?? null, planned_finish ?? null,
    project_manager ?? null, lead_engineer ?? null, JSON.stringify(metadata), req.auth?.sub ?? null,
  ])

  const project = result.rows[0]
  slog('INFO', 'projects', '[api] Project created', { tenantId, projectId: project.id, code: project.code })
  res.status(201).json({ data: project })
})

// ─── PATCH /api/v1/projects/:id ───────────────────────────────────────────────

router.patch('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const allowed = [
    'name','description','client_name','location','country','status','current_phase',
    'contract_type','currency','budget','committed_cost','actual_cost','forecast_cost',
    'contingency_pct','planned_start','planned_finish','actual_start','actual_finish',
    'progress_pct','project_manager','lead_engineer','metadata',
  ]

  const updates: string[] = []
  const values:  unknown[] = []
  let   paramIdx = 1

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      updates.push(`${key} = $${paramIdx++}`)
      values.push(key === 'metadata' ? JSON.stringify(req.body[key]) : req.body[key])
    }
  }

  if (updates.length === 0) {
    res.status(422).json({ error: 'validation', message: 'No valid fields to update.' })
    return
  }

  values.push(id)
  const result = await tenantQuery(tenantId, `
    UPDATE projects SET ${updates.join(', ')}
    WHERE id = $${paramIdx}
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
    RETURNING *
  `, values)

  const project = result.rows[0]
  if (!project) { res.status(404).json({ error: 'not_found' }); return }

  slog('INFO', 'projects', '[api] Project updated', { tenantId, projectId: id })
  res.json({ data: project })
})

// ─── DELETE /api/v1/projects/:id ──────────────────────────────────────────────

router.delete('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  // Only owner/admin can delete
  if (!['owner','admin'].includes(req.auth?.role ?? '')) {
    res.status(403).json({ error: 'forbidden', message: 'Insufficient role to delete projects.' })
    return
  }

  const result = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM projects
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
    RETURNING id
  `, [id])

  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }

  slog('WARN', 'projects', '[api] Project deleted', { tenantId, projectId: id, deletedBy: req.auth?.sub })
  res.status(204).send()
})

// ─── GET /api/v1/projects/:id/summary ────────────────────────────────────────

router.get('/:id/summary', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const [projectRes, activityRes] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, code, name, status, current_phase, progress_pct,
             budget, committed_cost, actual_cost, forecast_cost,
             planned_start, planned_finish, actual_start
      FROM projects
      WHERE id = $1
        AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
    `, [id]),
    tenantQuery(tenantId, `
      SELECT action, resource, created_at,
             u.display_name AS user_name
      FROM audit_log al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND al.resource_id = $1
      ORDER BY al.created_at DESC
      LIMIT 20
    `, [id]),
  ])

  const project = projectRes.rows[0]
  if (!project) { res.status(404).json({ error: 'not_found' }); return }

  // Budget variance
  const budgetVariance = project.budget
    ? ((project.budget - project.forecast_cost) / project.budget * 100).toFixed(1)
    : null

  res.json({
    data: {
      project,
      metrics: { budgetVariance },
      recentActivity: activityRes.rows,
    },
  })
})

export default router
