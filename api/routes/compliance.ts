/**
 * Denver Engineering — Compliance Tasks Routes
 * ─────────────────────────────────────────
 * v4.31.0 | CRUD for compliance_tasks.
 *
 *   GET    /api/v1/compliance-tasks                — list (paginated, filterable)
 *   GET    /api/v1/compliance-tasks/:id            — one
 *   POST   /api/v1/compliance-tasks                — create
 *   PATCH  /api/v1/compliance-tasks/:id            — update
 *   POST   /api/v1/compliance-tasks/:id/complete   — mark done (terminal)
 *   POST   /api/v1/compliance-tasks/:id/waive      — waive (terminal, admin)
 *   DELETE /api/v1/compliance-tasks/:id            — admin
 *
 * The complianceWatcher service (api/services/complianceWatcher.ts) scans
 * this table and emits webhook events on state transitions. These routes
 * own user-initiated mutations only; the watcher owns schedule transitions.
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { createAction } from '../services/actionService'  // v4.33.0 Ava
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { requireRecordScope, collectionScopeSql, collectionScopeParams } from '../authz/recordScope'
import { resolveCurrentUser } from '../authz/currentUser'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)


function _pagination(q: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(q['page'] ?? '1'), 10))
  const limit = Math.min(200, Math.max(1, parseInt(String(q['limit'] ?? '50'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

// ─── GET list ─────────────────────────────────────────────────────────────────

router.get('/', requireCapability('safety.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { status, category, project_id, assigned_to } = req.query as Record<string, string>

  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (status)      { conds.push(`status = $${i++}`);      vals.push(status) }
  if (category)    { conds.push(`category = $${i++}`);    vals.push(category) }
  if (project_id)  { conds.push(`project_id = $${i++}`);  vals.push(project_id) }
  if (assigned_to) { conds.push(`assigned_to = $${i++}`); vals.push(assigned_to) }
  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  // ADR-014 Phase 3F. `compliance_tasks` is DUAL_PROJECT_OR_TENANT: a
  // tenant-level obligation has no project and stays visible to any safety.view
  // holder, a project task needs live membership of its project. The SAME
  // predicate goes on the row query and the COUNT — a scoped page with a
  // tenant-wide total would report 3 rows out of 27 and leak the occupancy of
  // projects the caller cannot see (§15).
  const principal = await resolveCurrentUser(req as never)
  if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return }
  const scope = collectionScopeSql(principal, 'compliance_tasks', 'project_id', `$${i}`)
  const scopeVals = collectionScopeParams(principal, 'compliance_tasks')
  const j = i + scopeVals.length

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, project_id, title, description, category, due_date,
             notify_days_before, status, last_notified_at, completed_at,
             assigned_to, created_by, metadata, created_at, updated_at
      FROM compliance_tasks
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ${scope}
      ORDER BY due_date ASC, created_at DESC
      LIMIT $${j} OFFSET $${j + 1}
    `, [...vals, ...scopeVals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM compliance_tasks
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ${scope}
    `, [...vals, ...scopeVals]),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({
    data: rows.rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

// ─── GET one ──────────────────────────────────────────────────────────────────

router.get('/:id', requireCapability('safety.view') as never, requireRecordScope('compliance_tasks') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery(tenantId, `
    SELECT * FROM compliance_tasks
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ─── POST create ──────────────────────────────────────────────────────────────

router.post('/', requireCapability('safety.write') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as Record<string, unknown>
  const title    = typeof b['title']    === 'string' ? b['title']    : null
  const dueDate  = typeof b['due_date'] === 'string' ? b['due_date'] : null
  if (!title || !dueDate) {
    res.status(422).json({ error: 'validation', message: 'title and due_date required' })
    return
  }

  const result = await tenantQuery(tenantId, `
    INSERT INTO compliance_tasks
      (tenant_id, project_id, title, description, category,
       due_date, notify_days_before, assigned_to, created_by, metadata)
    VALUES
      (current_setting('app.current_tenant_id',true)::uuid,
       $1, $2, $3, $4, $5::date, $6, $7, $8, $9::jsonb)
    RETURNING *
  `, [
    b['project_id']         ?? null,
    title,
    b['description']        ?? null,
    (b['category'] as string) ?? 'general',
    dueDate,
    Number(b['notify_days_before'] ?? 7),
    b['assigned_to']        ?? null,
    req.auth?.sub           ?? null,
    JSON.stringify(b['metadata'] ?? {}),
  ])
  const row = result.rows[0]
  void createAction(tenantId, {
    title:               `Compliance: ${row.title}`,
    action_type:         'COMPLIANCE_TASK',
    source_module:       'compliance_tasks',
    source_id:           row.id,
    project_id:          row.project_id ?? null,
    priority:            'medium',
    assigned_to_user_id: row.assigned_to ?? null,
    created_by:          row.created_by ?? null,
  })
  res.status(201).json({ data: row })
})

// ─── PATCH update ─────────────────────────────────────────────────────────────

router.patch('/:id', requireCapability('safety.write') as never, requireRecordScope('compliance_tasks') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const fields = ['title','description','category','due_date','notify_days_before',
                  'assigned_to','metadata','project_id']
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      if (f === 'metadata') {
        sets.push(`${f} = $${i++}::jsonb`)
        vals.push(JSON.stringify(req.body[f]))
      } else {
        sets.push(`${f} = $${i++}`)
        vals.push(req.body[f])
      }
    }
  }
  if (sets.length === 0) {
    res.status(422).json({ error: 'validation', message: 'no valid fields' })
    return
  }
  vals.push(req.params['id'])
  const result = await tenantQuery(tenantId, `
    UPDATE compliance_tasks SET ${sets.join(', ')}
    WHERE id = $${i}
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING *
  `, vals)
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ─── POST complete ────────────────────────────────────────────────────────────

router.post('/:id/complete', requireCapability('safety.approve') as never, requireRecordScope('compliance_tasks') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery(tenantId, `
    UPDATE compliance_tasks
    SET    status       = 'completed',
           completed_at = NOW()
    WHERE  id = $1
      AND  tenant_id = current_setting('app.current_tenant_id',true)::uuid
      AND  status NOT IN ('completed','waived')
    RETURNING *
  `, [req.params['id']])
  if (!result.rows[0]) {
    res.status(404).json({ error: 'not_found', message: 'task missing or already terminal' })
    return
  }
  res.json({ data: result.rows[0] })
})

// ─── POST waive (admin) ───────────────────────────────────────────────────────

router.post('/:id/waive', requireCapability('safety.approve') as never, requireRecordScope('compliance_tasks') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery(tenantId, `
    UPDATE compliance_tasks
    SET    status = 'waived'
    WHERE  id = $1
      AND  tenant_id = current_setting('app.current_tenant_id',true)::uuid
      AND  status NOT IN ('completed','waived')
    RETURNING *
  `, [req.params['id']])
  if (!result.rows[0]) {
    res.status(404).json({ error: 'not_found', message: 'task missing or already terminal' })
    return
  }
  res.json({ data: result.rows[0] })
})

// ─── DELETE (admin) ───────────────────────────────────────────────────────────

router.delete('/:id', requireCapability('safety.approve') as never, requireRecordScope('compliance_tasks') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM compliance_tasks
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING id
  `, [req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

export default router
