/**
 * Denver Engineering — Projects Routes
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
// v4.31.0 TS fix: `tenantTransaction` unused in current routes
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { slog } from '../../src/modules/observability/index'
import { requireCapability } from '../authz/requireCapability'
import { guardTransitionOwnedState } from '../authz/transitionStates'
import { resolveCurrentUser } from '../authz/currentUser'
import { canAccessProject } from '../authz/recordScope'
import { roleHasCapability } from '../authz/capabilities'
// v4.31.0 TS fix: `randomBytes` unused — commented pending reintroduction
// import { randomBytes } from 'node:crypto'

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

/**
 * The commercial columns on `projects`. ADR-014 Phase 2B-2 recorded this route
 * as MIXED_PAYLOAD_PHASE3 precisely because they travel in the same row as the
 * delivery context, and `cost.view` is owner-only.
 */
const PROJECT_COST_FIELDS = [
  'budget', 'committed_cost', 'actual_cost', 'forecast_cost', 'contingency_pct',
] as const

/**
 * The project row as this reader may see it.
 *
 * Removed, not nulled: a `budget: null` is indistinguishable from a project
 * with no budget set, which would make the response lie rather than withhold.
 * An absent key says "not disclosed to you".
 */
function projectForReader(row: Record<string, unknown>, role: string): Record<string, unknown> {
  if (roleHasCapability(role, 'cost.view')) return row
  const visible = { ...row }
  for (const f of PROJECT_COST_FIELDS) delete visible[f]
  return visible
}

// ─── GET /api/v1/projects ─────────────────────────────────────────────────────

router.get('/', requireCapability('project.list.all') as never, async (req: Req, res: Response) => {
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

/**
 * ADR-014 Phase 3A — the first record-scoped read.
 *
 * Before Phase 3A this route carried NO capability guard at all: any
 * authenticated principal in the tenant could open any project, including its
 * budget and cost columns. It was the larger of the two endpoints Phase 2
 * deliberately deferred, recorded as MIXED_PAYLOAD_PHASE3 because neither
 * available capability was correct on its own — `project.view` would have
 * disclosed the commercial columns to every delivery role, and `cost.view`
 * (owner-only) would have closed the project record to all of them.
 *
 * Phase 3A resolves that by separating the two questions the row asks:
 *
 *   route authority   project.view      — may this principal read project context
 *   record scope      responsible-user  — may this principal read THIS project
 *   field authority   cost.view         — may this principal see the money
 *
 * Order matters: scope is decided from a light `SELECT id` before the payload
 * query runs, so a refused caller never causes the project row, its client
 * name, its status or its six summary sub-counts to be loaded at all.
 */
router.get('/:id', requireCapability('project.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  // Live principal, not the token's claims — a membership revoked a second ago
  // must take effect now, without waiting for the JWT to expire.
  const principal = await resolveCurrentUser(req)
  if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }

  if (!await canAccessProject(principal, String(id))) {
    // Deliberately indistinguishable from a project that does not exist. A 403
    // here would confirm the id is real, which is itself information about
    // another team's work. Same body as the not-found branch below.
    res.status(404).json({ error: 'not_found', message: 'Project not found.' })
    return
  }

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

  res.json({ data: projectForReader(project as Record<string, unknown>, principal.role) })
})

// ─── POST /api/v1/projects ────────────────────────────────────────────────────

router.post('/', requireCapability('project.write') as never, async (req: Req, res: Response) => {
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
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
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

router.patch('/:id', requireCapability('project.write') as never, guardTransitionOwnedState('projects') as never, async (req: Req, res: Response) => {
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

// ADR-014 D4 — hard deletion carries its own authority, `project.delete`, held
// by `owner` alone. It is deliberately neither project.write (ordinary editing)
// nor project.approve: the latter would extend irreversible destruction of the
// project root, and the delivery and commercial history hanging off it, to every
// project manager. The previous check read the JWT role, so a demoted owner kept
// the power until the token expired; authority is now the live database role.
router.delete('/:id', requireCapability('project.delete') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

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

router.get('/:id/summary', requireCapability('cost.view') as never, async (req: Req, res: Response) => {
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

// ─── PATCH /api/v1/projects/:id/agent-mode ────────────────────────────────────
// v4.31.0: agentic kill switch. Owner/admin only. The value here gates
// downstream agent-originated writes via api/middleware/agentMode.ts.
router.patch('/:id/agent-mode', requireCapability('ai.govern') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const mode = (req.body as { mode?: string }).mode
  if (!['auto','review_all','frozen'].includes(mode ?? '')) {
    res.status(422).json({ error: 'validation', message: 'mode must be auto|review_all|frozen' })
    return
  }

  const result = await tenantQuery(tenantId, `
    UPDATE projects
    SET agent_mode = $1
    WHERE id = $2
      AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
    RETURNING id, code, name, agent_mode
  `, [mode, id])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }

  slog('WARN', 'projects', '[api] Project agent_mode changed', {
    tenantId, projectId: id, mode, changedBy: req.auth?.sub,
  })
  res.json({ data: result.rows[0] })
})

/**
 * Canonical project closure (ADR-014 Phase 2A-2).
 *
 * `completed` and `cancelled` are terminal project states, and the capability
 * registry already names project closure as what `project.approve` is for. The
 * generic PATCH could set either directly, so closure had no authorization at
 * all. One route owns both outcomes.
 */
router.post('/:id/close', requireCapability('project.approve') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const outcome = String((req.body as { outcome?: string }).outcome ?? 'completed')
  if (!['completed', 'cancelled'].includes(outcome)) {
    res.status(422).json({ error: 'validation', message: 'outcome must be one of: completed, cancelled' }); return
  }

  const result = await tenantQuery(tenantId, `
    UPDATE projects SET status = $1, actual_finish = COALESCE(actual_finish, CURRENT_DATE), updated_at = NOW()
    WHERE id = $2 AND status NOT IN ('completed','cancelled')
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING *
  `, [outcome, req.params['id']])

  if (!result.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Project not found or already closed.' }); return }
  slog('INFO', 'projects', '[project] Closed', { tenantId, projectId: req.params['id'], outcome, by: req.auth?.sub })
  res.json({ data: result.rows[0] })
})

export default router
