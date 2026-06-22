/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Denver Engineering — Actions Routes (v4.34.0)
 * ────────────────────────────────────────────────
 * Ava Phase 1E + Phase 2 — Global Action Center API
 *
 * Phase 1:
 *   GET  /api/v1/actions            — list (paginated, filterable)
 *   GET  /api/v1/actions/my         — current user's open actions
 *   GET  /api/v1/actions/overdue    — overdue actions (admin/pm)
 *   GET  /api/v1/actions/summary    — counts by status/priority/type
 *   GET  /api/v1/actions/:id        — single action + escalation history
 *   PATCH /api/v1/actions/:id       — update status / reassign
 *   GET/POST/PATCH /api/v1/actions/sla-rules
 *   GET/POST/PATCH /api/v1/actions/delegations
 *
 * Phase 2 (v4.34.0):
 *   GET  /api/v1/actions/inbox                     — unified operations inbox
 *   POST /api/v1/actions/:id/relationships          — add relation
 *   GET  /api/v1/actions/:id/relationships          — list relations
 *   DELETE /api/v1/actions/relationships/:relId     — soft-delete relation
 *   GET  /api/v1/actions/:id/timeline               — event history
 *   GET  /api/v1/actions/:id/dependencies           — dependency report
 *   POST /api/v1/actions/:id/sla/pause              — pause SLA
 *   POST /api/v1/actions/:id/sla/resume             — resume SLA
 *   GET  /api/v1/actions/analytics/overview         — live overview
 *   GET  /api/v1/actions/analytics/trends           — trend data
 *   GET  /api/v1/actions/analytics/workload         — assignee workload
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { slog } from '../../src/modules/observability/index'
import { createRelation, listRelations, deleteRelation } from '../services/actions/actionRelationshipService'
import { buildDependencyReport } from '../services/actions/actionDependencyGraph'
import { getActionTimeline, publishActionEvent } from '../services/actions/actionEventPublisher'
import { pauseSla, resumeSla } from '../services/sla/slaPolicyEngine'
import { getOverview, getTrends, getWorkload } from '../services/actions/actionAnalyticsService'

type Req = AuthenticatedRequest & TenantRequest

export const actionsRouter = Router()
actionsRouter.use(requireAuth as never)
actionsRouter.use(requireTenant() as never)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _pagination(q: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(q['page']  ?? '1'),  10))
  const limit = Math.min(200, Math.max(1, parseInt(String(q['limit'] ?? '50'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

function _requireAdminOrPm(req: Req, res: Response): boolean {
  const role = req.auth?.role ?? ''
  if (!['owner','admin','project_manager'].includes(role)) {
    res.status(403).json({ error: 'forbidden', message: 'project_manager or above required' })
    return false
  }
  return true
}

// ─── GET /api/v1/actions ─────────────────────────────────────────────────────

actionsRouter.get('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const {
    status, priority, action_type, source_module,
    project_id, system_type, assigned_to_user_id,
  } = req.query as Record<string, string>

  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1

  if (status)              { conds.push(`a.status = $${i++}`);               vals.push(status) }
  if (priority)            { conds.push(`a.priority = $${i++}`);             vals.push(priority) }
  if (action_type)         { conds.push(`a.action_type = $${i++}`);          vals.push(action_type) }
  if (source_module)       { conds.push(`a.source_module = $${i++}`);        vals.push(source_module) }
  if (project_id)          { conds.push(`a.project_id = $${i++}`);           vals.push(project_id) }
  if (system_type)         { conds.push(`a.system_type = $${i++}`);          vals.push(system_type) }
  if (assigned_to_user_id) { conds.push(`a.assigned_to_user_id = $${i++}`);  vals.push(assigned_to_user_id) }

  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT
        a.*,
        p.code        AS project_code,
        p.name        AS project_name,
        u.email       AS assigned_user_email,
        COUNT(ae.id)  AS escalation_count
      FROM  actions a
      LEFT JOIN projects            p  ON p.id = a.project_id
      LEFT JOIN users               u  ON u.id = a.assigned_to_user_id
      LEFT JOIN action_escalations  ae ON ae.action_id = a.id
      WHERE a.tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      GROUP BY a.id, p.code, p.name, u.email
      ORDER BY
        CASE a.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
        a.due_at ASC NULLS LAST,
        a.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `, [...vals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM actions a
      WHERE a.tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    `, vals),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({ data: rows.rows, meta: { total, page, limit } })
})

// ─── GET /api/v1/actions/my ──────────────────────────────────────────────────

actionsRouter.get('/my', async (req: Req, res: Response) => {
  const { tenantId } = req
  const userId = req.auth?.userId
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!userId)   { res.status(401).json({ error: 'auth_required' }); return }

  const { limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { status } = req.query as Record<string, string>
  const effectiveStatus = status ?? 'open'

  const rows = await tenantQuery(tenantId, `
    SELECT
      a.*,
      p.code       AS project_code,
      p.name       AS project_name,
      COUNT(ae.id) AS escalation_count
    FROM  actions a
    LEFT JOIN projects           p  ON p.id = a.project_id
    LEFT JOIN action_escalations ae ON ae.action_id = a.id
    WHERE a.tenant_id = current_setting('app.current_tenant_id',true)::uuid
      AND a.assigned_to_user_id = $1
      AND a.status = $2
    GROUP BY a.id, p.code, p.name
    ORDER BY
      CASE a.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      a.due_at ASC NULLS LAST
    LIMIT $3 OFFSET $4
  `, [userId, effectiveStatus, limit, offset])

  res.json({ data: rows.rows })
})

// ─── GET /api/v1/actions/overdue ─────────────────────────────────────────────

actionsRouter.get('/overdue', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!_requireAdminOrPm(req, res)) return

  const { limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { project_id, system_type, action_type } = req.query as Record<string, string>

  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (project_id)  { conds.push(`a.project_id = $${i++}`);  vals.push(project_id) }
  if (system_type) { conds.push(`a.system_type = $${i++}`); vals.push(system_type) }
  if (action_type) { conds.push(`a.action_type = $${i++}`); vals.push(action_type) }
  const extra = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const rows = await tenantQuery(tenantId, `
    SELECT
      a.*,
      p.code       AS project_code,
      p.name       AS project_name,
      u.email      AS assigned_user_email,
      EXTRACT(EPOCH FROM (NOW() - a.due_at)) / 3600.0 AS hours_overdue,
      MAX(ae.escalation_level) AS max_escalation_level
    FROM  actions a
    LEFT JOIN projects           p  ON p.id = a.project_id
    LEFT JOIN users              u  ON u.id = a.assigned_to_user_id
    LEFT JOIN action_escalations ae ON ae.action_id = a.id
    WHERE a.tenant_id = current_setting('app.current_tenant_id',true)::uuid
      AND a.status IN ('open','in_progress')
      AND a.due_at IS NOT NULL
      AND a.due_at < NOW()
      ${extra}
    GROUP BY a.id, p.code, p.name, u.email
    ORDER BY a.due_at ASC
    LIMIT $${i} OFFSET $${i + 1}
  `, [...vals, limit, offset])

  res.json({ data: rows.rows })
})

// ─── GET /api/v1/actions/summary ─────────────────────────────────────────────

actionsRouter.get('/summary', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { project_id } = req.query as Record<string, string>
  const projectFilter = project_id ? `AND project_id = '${project_id}'` : ''

  const [byStatus, byPriority, byType, overdueCount] = await Promise.all([
    tenantQuery<{ status: string; count: string }>(tenantId, `
      SELECT status, COUNT(*)::text AS count FROM actions
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid ${projectFilter}
      GROUP BY status
    `, []),
    tenantQuery<{ priority: string; count: string }>(tenantId, `
      SELECT priority, COUNT(*)::text AS count FROM actions
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid
        AND status IN ('open','in_progress') ${projectFilter}
      GROUP BY priority
    `, []),
    tenantQuery<{ action_type: string; count: string }>(tenantId, `
      SELECT action_type, COUNT(*)::text AS count FROM actions
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid
        AND status IN ('open','in_progress') ${projectFilter}
      GROUP BY action_type ORDER BY count DESC
    `, []),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM actions
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid
        AND status IN ('open','in_progress')
        AND due_at IS NOT NULL
        AND due_at < NOW() ${projectFilter}
    `, []),
  ])

  res.json({
    by_status:     Object.fromEntries(byStatus.rows.map(r => [r.status, parseInt(r.count)])),
    by_priority:   Object.fromEntries(byPriority.rows.map(r => [r.priority, parseInt(r.count)])),
    by_type:       Object.fromEntries(byType.rows.map(r => [r.action_type, parseInt(r.count)])),
    overdue_count: parseInt(overdueCount.rows[0]?.count ?? '0'),
  })
})

// ─── GET /api/v1/actions/:id ─────────────────────────────────────────────────

actionsRouter.get('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const [action, escalations] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT a.*, p.code AS project_code, p.name AS project_name,
             u.email AS assigned_user_email
      FROM actions a
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN users    u ON u.id = a.assigned_to_user_id
      WHERE a.id = $1
        AND a.tenant_id = current_setting('app.current_tenant_id',true)::uuid
    `, [id]),
    tenantQuery(tenantId, `
      SELECT * FROM action_escalations
      WHERE action_id = $1
        AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
      ORDER BY escalation_level ASC
    `, [id]),
  ])

  if (!action.rows[0]) { res.status(404).json({ error: 'not_found' }); return }

  res.json({ data: { ...action.rows[0], escalations: escalations.rows } })
})

// ─── PATCH /api/v1/actions/:id ───────────────────────────────────────────────

actionsRouter.patch('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { status, priority, assigned_to_user_id, assigned_to_role, description } = req.body as {
    status?:               string
    priority?:             string
    assigned_to_user_id?:  string | null
    assigned_to_role?:     string | null
    description?:          string
  }

  const sets: string[] = ['updated_at = NOW()']
  const vals: unknown[] = []
  let i = 1

  if (status !== undefined) {
    const valid = ['open','in_progress','completed','cancelled']
    if (!valid.includes(status)) { res.status(400).json({ error: 'invalid_status' }); return }
    sets.push(`status = $${i++}`); vals.push(status)
    if (status === 'completed') { sets.push(`completed_at = NOW()`) }
    if (status === 'cancelled') { sets.push(`cancelled_at = NOW()`) }
  }
  if (priority !== undefined)            { sets.push(`priority = $${i++}`);            vals.push(priority) }
  if (assigned_to_user_id !== undefined) { sets.push(`assigned_to_user_id = $${i++}`); vals.push(assigned_to_user_id) }
  if (assigned_to_role !== undefined)    { sets.push(`assigned_to_role = $${i++}`);    vals.push(assigned_to_role) }
  if (description !== undefined)         { sets.push(`description = $${i++}`);         vals.push(description) }

  if (sets.length === 1) { res.status(400).json({ error: 'no_fields_to_update' }); return }

  const result = await tenantQuery(tenantId, `
    UPDATE actions SET ${sets.join(', ')}
    WHERE id = $${i}
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING *
  `, [...vals, id])

  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ═══════════════════════════════════════════════════════════════════════════════
// SLA RULES
// ═══════════════════════════════════════════════════════════════════════════════

actionsRouter.get('/sla-rules', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const rows = await tenantQuery(tenantId, `
    SELECT * FROM sla_rules
    WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid
    ORDER BY action_type, system_type NULLS LAST
  `, [])
  res.json({ data: rows.rows })
})

actionsRouter.post('/sla-rules', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!_requireAdminOrPm(req, res)) return

  const { action_type, system_type, default_duration_hours, escalation_levels } = req.body as {
    action_type:              string
    system_type?:             string | null
    default_duration_hours?:  number
    escalation_levels?:       unknown[]
  }

  if (!action_type) { res.status(400).json({ error: 'action_type_required' }); return }

  const result = await tenantQuery(tenantId, `
    INSERT INTO sla_rules (tenant_id, action_type, system_type, default_duration_hours, escalation_levels)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    ON CONFLICT (tenant_id, action_type, system_type) DO UPDATE
      SET default_duration_hours = EXCLUDED.default_duration_hours,
          escalation_levels      = EXCLUDED.escalation_levels,
          updated_at             = NOW()
    RETURNING *
  `, [
    tenantId,
    action_type,
    system_type ?? null,
    default_duration_hours ?? 72,
    JSON.stringify(escalation_levels ?? []),
  ])

  res.status(201).json({ data: result.rows[0] })
})

actionsRouter.patch('/sla-rules/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!_requireAdminOrPm(req, res)) return

  const { id } = req.params
  const { default_duration_hours, escalation_levels, is_active } = req.body as {
    default_duration_hours?: number
    escalation_levels?:      unknown[]
    is_active?:              boolean
  }

  const sets: string[] = ['updated_at = NOW()']
  const vals: unknown[] = []
  let i = 1

  if (default_duration_hours !== undefined) { sets.push(`default_duration_hours = $${i++}`); vals.push(default_duration_hours) }
  if (escalation_levels !== undefined)      { sets.push(`escalation_levels = $${i++}::jsonb`); vals.push(JSON.stringify(escalation_levels)) }
  if (is_active !== undefined)              { sets.push(`is_active = $${i++}`); vals.push(is_active) }

  const result = await tenantQuery(tenantId, `
    UPDATE sla_rules SET ${sets.join(', ')}
    WHERE id = $${i}
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING *
  `, [...vals, id])

  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL DELEGATIONS
// ═══════════════════════════════════════════════════════════════════════════════

actionsRouter.get('/delegations', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const userId = req.auth?.userId

  const rows = await tenantQuery(tenantId, `
    SELECT d.*,
           u1.email AS delegator_email,
           u2.email AS delegate_email
    FROM   approval_delegations d
    JOIN   users u1 ON u1.id = d.user_id
    JOIN   users u2 ON u2.id = d.delegate_user_id
    WHERE  d.tenant_id = current_setting('app.current_tenant_id',true)::uuid
      AND  (d.user_id = $1 OR d.delegate_user_id = $1)
    ORDER  BY d.created_at DESC
  `, [userId])

  res.json({ data: rows.rows })
})

actionsRouter.post('/delegations', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const userId = req.auth?.userId
  if (!userId) { res.status(401).json({ error: 'auth_required' }); return }

  const { delegate_user_id, start_date, end_date, scope } = req.body as {
    delegate_user_id: string
    start_date:       string
    end_date:         string
    scope?:           Record<string, unknown>
  }

  if (!delegate_user_id) { res.status(400).json({ error: 'delegate_user_id_required' }); return }
  if (!start_date)       { res.status(400).json({ error: 'start_date_required' }); return }
  if (!end_date)         { res.status(400).json({ error: 'end_date_required' }); return }
  if (delegate_user_id === userId) {
    res.status(400).json({ error: 'cannot_delegate_to_self' }); return
  }

  // Check for circular delegation (A → B already exists and B → A being attempted)
  const circularCheck = await tenantQuery<{ count: string }>(tenantId, `
    SELECT COUNT(*)::text AS count FROM approval_delegations
    WHERE tenant_id        = current_setting('app.current_tenant_id',true)::uuid
      AND user_id          = $1
      AND delegate_user_id = $2
      AND is_active        = TRUE
  `, [delegate_user_id, userId])

  if (parseInt(circularCheck.rows[0]?.count ?? '0') > 0) {
    res.status(400).json({ error: 'circular_delegation', message: 'delegate already delegates to you' })
    return
  }

  try {
    const result = await tenantQuery(tenantId, `
      INSERT INTO approval_delegations (tenant_id, user_id, delegate_user_id, start_date, end_date, scope, created_by)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      RETURNING *
    `, [tenantId, userId, delegate_user_id, start_date, end_date, JSON.stringify(scope ?? {}), userId])

    slog('INFO', 'actionsRouter', '[delegation] Created', {
      user_id: userId, delegate: delegate_user_id, start_date, end_date,
    })
    res.status(201).json({ data: result.rows[0] })
  } catch (err: unknown) {
    const msg = String(err)
    if (msg.includes('unique') || msg.includes('duplicate')) {
      res.status(409).json({ error: 'delegation_already_exists' })
    } else {
      res.status(500).json({ error: 'internal_error', message: msg })
    }
  }
})

actionsRouter.patch('/delegations/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const userId = req.auth?.userId

  // Users can only deactivate their own delegations (or admins can deactivate any)
  const role = req.auth?.role ?? ''
  const isAdmin = ['owner','admin'].includes(role)

  const result = await tenantQuery(tenantId, `
    UPDATE approval_delegations
    SET    is_active   = FALSE,
           updated_at  = NOW()
    WHERE  id          = $1
      AND  tenant_id   = current_setting('app.current_tenant_id',true)::uuid
      AND  ($2 OR user_id = $3)
    RETURNING *
  `, [id, isAdmin, userId])

  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2 ROUTES (v4.34.0)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/v1/actions/inbox ────────────────────────────────────────────────

actionsRouter.get('/inbox', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const {
    module, project_id, assignee, priority, status,
    escalation_level, overdue_only, system_type,
    limit: limitStr = '50', cursor,
  } = req.query as Record<string, string>

  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1

  const effectiveStatus = status ?? 'open'
  if (effectiveStatus !== 'all') {
    conds.push(`a.status = $${i++}`); vals.push(effectiveStatus)
  }
  if (module)      { conds.push(`a.source_module = $${i++}`);        vals.push(module) }
  if (project_id)  { conds.push(`a.project_id = $${i++}`);           vals.push(project_id) }
  if (assignee)    { conds.push(`a.assigned_to_user_id = $${i++}`);  vals.push(assignee) }
  if (priority)    { conds.push(`a.priority = $${i++}`);             vals.push(priority) }
  if (system_type) { conds.push(`a.system_type = $${i++}`);          vals.push(system_type) }
  if (overdue_only === 'true') {
    conds.push(`a.due_at IS NOT NULL AND a.due_at < NOW()`)
  }
  if (escalation_level) {
    conds.push(`(SELECT MAX(ae2.escalation_level) FROM action_escalations ae2 WHERE ae2.action_id = a.id) = $${i++}`)
    vals.push(parseInt(escalation_level, 10))
  }
  if (cursor) { conds.push(`a.created_at < $${i++}`); vals.push(cursor) }

  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''
  const lim   = Math.min(200, Math.max(1, parseInt(limitStr, 10)))

  const rows = await tenantQuery(tenantId, `
    SELECT
      a.*,
      p.code        AS project_code,
      p.name        AS project_name,
      u.email       AS assigned_user_email,
      MAX(ae.escalation_level)                               AS max_escalation_level,
      COUNT(ae.id)                                           AS escalation_count,
      ROUND(EXTRACT(EPOCH FROM (NOW() - a.created_at)) / 3600.0, 1) AS age_hours,
      CASE WHEN a.due_at IS NOT NULL
        THEN ROUND(EXTRACT(EPOCH FROM (a.due_at - NOW())) / 60.0)
        ELSE NULL END                                        AS sla_remaining_minutes,
      sla.sla_status,
      (SELECT COUNT(*) FROM action_relations ar
       WHERE ar.tenant_id = a.tenant_id
         AND ar.target_action_id = a.id
         AND ar.relation_type IN ('blocks','spawned_from')
         AND ar.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM actions bl WHERE bl.id = ar.source_action_id
                       AND bl.status NOT IN ('completed','cancelled'))
      ) AS blocked_by_count,
      (SELECT COUNT(*) FROM action_relations ar2
       WHERE ar2.tenant_id = a.tenant_id
         AND (ar2.source_action_id = a.id OR ar2.target_action_id = a.id)
         AND ar2.deleted_at IS NULL
      ) AS dependency_count
    FROM  actions a
    LEFT JOIN projects            p   ON p.id = a.project_id
    LEFT JOIN users               u   ON u.id = a.assigned_to_user_id
    LEFT JOIN action_escalations  ae  ON ae.action_id = a.id
    LEFT JOIN action_sla_state    sla ON sla.action_id = a.id
    WHERE a.tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    GROUP BY a.id, p.code, p.name, u.email, sla.sla_status
    ORDER BY
      CASE a.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      a.due_at ASC NULLS LAST,
      a.created_at DESC
    LIMIT $${i}
  `, [...vals, lim])

  const data = rows.rows.map((r: Record<string, unknown>) => ({
    ...r,
    is_blocked:        (parseInt(String(r['blocked_by_count'] ?? '0'), 10)) > 0,
    escalation_status: r['max_escalation_level'] ? `L${r['max_escalation_level']}` : 'none',
  }))

  const nextCursor = data.length === lim
    ? (data[data.length - 1] as unknown as { created_at: string } | undefined)?.created_at ?? null
    : null

  res.json({ data, meta: { limit: lim, next_cursor: nextCursor } })
})

// ─── Analytics ────────────────────────────────────────────────────────────────

actionsRouter.get('/analytics/overview', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  res.json({ data: await getOverview(tenantId) })
})

actionsRouter.get('/analytics/trends', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const days = Math.min(365, parseInt(String(req.query['days'] ?? '30'), 10))
  res.json({ data: await getTrends(tenantId, days) })
})

actionsRouter.get('/analytics/workload', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!_requireAdminOrPm(req, res)) return
  const limit = Math.min(50, parseInt(String(req.query['limit'] ?? '20'), 10))
  res.json({ data: await getWorkload(tenantId, limit) })
})

// ─── Relationships ────────────────────────────────────────────────────────────

actionsRouter.post('/:id/relationships', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { target_action_id, relation_type, notes } = req.body as Record<string, string>
  if (!target_action_id || !relation_type) {
    res.status(422).json({ error: 'target_action_id and relation_type required' }); return
  }

  const { relation, error } = await createRelation(tenantId, {
    sourceActionId: id as string,
    targetActionId: target_action_id,
    relationType:   relation_type as never,
    notes:          notes ?? null,
    actorId:        req.auth?.userId ?? null,
  })

  if (error === 'cycle_detected')            { res.status(409).json({ error }); return }
  if (error === 'action_not_found')          { res.status(404).json({ error }); return }
  if (error === 'self_relation_not_allowed') { res.status(400).json({ error }); return }
  if (!relation)                             { res.status(500).json({ error: 'failed' }); return }

  res.status(201).json({ data: relation })
})

actionsRouter.get('/:id/relationships', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const direction = (req.query['direction'] as 'inbound' | 'outbound' | 'both') ?? 'both'
  res.json({ data: await listRelations(tenantId, id as string, direction) })
})

actionsRouter.delete('/relationships/:relId', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const deleted = await deleteRelation(tenantId, req.params.relId as string, req.auth?.userId ?? null)
  if (!deleted) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ deleted: true })
})

// ─── Timeline ─────────────────────────────────────────────────────────────────

actionsRouter.get('/:id/timeline', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const limit  = Math.min(200, parseInt(String(req.query['limit'] ?? '100'), 10))
  const before = req.query['before'] as string | undefined
  res.json({ data: await getActionTimeline(tenantId, id as string, limit, before) })
})

// ─── Dependencies ─────────────────────────────────────────────────────────────

actionsRouter.get('/:id/dependencies', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  res.json({ data: await buildDependencyReport(tenantId, id as string) })
})

// ─── SLA pause / resume ───────────────────────────────────────────────────────

actionsRouter.post('/:id/sla/pause', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const paused = await pauseSla(tenantId, id as string)
  if (!paused) { res.status(409).json({ error: 'not_active_or_not_found' }); return }
  void publishActionEvent(tenantId, id as string, 'sla_paused', req.auth?.userId ?? null)
  res.json({ paused: true })
})

actionsRouter.post('/:id/sla/resume', async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const resumed = await resumeSla(tenantId, id as string)
  if (!resumed) { res.status(409).json({ error: 'not_paused_or_not_found' }); return }
  void publishActionEvent(tenantId, id as string, 'sla_resumed', req.auth?.userId ?? null)
  res.json({ resumed: true })
})
