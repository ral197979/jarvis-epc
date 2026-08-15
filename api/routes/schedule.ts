/**
 * Denver Engineering — Schedule / CPM Routes
 * ──────────────────────────────────────
 * v4.31.0 | Tasks, FS dependencies, critical path compute.
 *
 *   GET    /api/v1/schedule/:projectId/tasks
 *   POST   /api/v1/schedule/:projectId/tasks
 *   PATCH  /api/v1/schedule/tasks/:id
 *   DELETE /api/v1/schedule/tasks/:id
 *
 *   GET    /api/v1/schedule/:projectId/dependencies
 *   POST   /api/v1/schedule/:projectId/dependencies
 *   DELETE /api/v1/schedule/dependencies/:id
 *
 *   GET    /api/v1/schedule/:projectId/cpm
 *     Runs the forward/backward pass and returns { results, project_finish,
 *     critical_path }. Pure compute — no persistence.
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { computeCpm, CpmCycleError, CpmMissingTaskError } from '../services/cpm'

import { requireCapability } from '../authz/requireCapability'
type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

// ─── Tasks ────────────────────────────────────────────────────────────────────

router.get('/:projectId/tasks', requireCapability('schedule.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const rows = await tenantQuery(tenantId, `
    SELECT id, project_id, name, wbs_code, description,
           duration_days, is_milestone, actual_start, actual_finish,
           status, created_at, updated_at
    FROM   schedule_tasks
    WHERE  project_id = $1
      AND  tenant_id = current_setting('app.current_tenant_id',true)::uuid
    ORDER BY wbs_code NULLS LAST, created_at ASC
  `, [req.params['projectId']])
  res.json({ data: rows.rows })
})

router.post('/:projectId/tasks', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as Record<string, unknown>
  if (!b['name']) { res.status(422).json({ error: 'validation', message: 'name required' }); return }

  const duration = Number(b['duration_days'] ?? 0)
  if (!Number.isInteger(duration) || duration < 0) {
    res.status(422).json({ error: 'validation', message: 'duration_days must be >= 0' })
    return
  }

  const result = await tenantQuery(tenantId, `
    INSERT INTO schedule_tasks
      (tenant_id, project_id, name, wbs_code, description,
       duration_days, is_milestone, status, created_by)
    VALUES
      (current_setting('app.current_tenant_id',true)::uuid,
       $1, $2, $3, $4, $5, $6, COALESCE($7, 'not_started'), $8)
    RETURNING *
  `, [
    req.params['projectId'], b['name'],
    b['wbs_code'] ?? null, b['description'] ?? null,
    duration, Boolean(b['is_milestone']),
    b['status'] ?? null, req.auth?.sub ?? null,
  ])
  res.status(201).json({ data: result.rows[0] })
})

router.patch('/tasks/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const fields = ['name','wbs_code','description','duration_days','is_milestone',
                  'actual_start','actual_finish','status']
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      sets.push(`${f} = $${i++}`)
      vals.push(req.body[f])
    }
  }
  if (sets.length === 0) { res.status(422).json({ error: 'validation', message: 'no valid fields' }); return }
  vals.push(req.params['id'])

  const result = await tenantQuery(tenantId, `
    UPDATE schedule_tasks SET ${sets.join(', ')}
    WHERE id = $${i}
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING *
  `, vals)
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

router.delete('/tasks/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM schedule_tasks
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING id
  `, [req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

// ─── Dependencies ────────────────────────────────────────────────────────────

router.get('/:projectId/dependencies', requireCapability('schedule.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  // Join to schedule_tasks to scope by project (deps themselves don't carry project_id)
  const rows = await tenantQuery(tenantId, `
    SELECT d.id, d.predecessor_id, d.successor_id, d.lag_days, d.created_at
    FROM   schedule_dependencies d
    JOIN   schedule_tasks p ON p.id = d.predecessor_id
    WHERE  p.project_id = $1
      AND  d.tenant_id = current_setting('app.current_tenant_id',true)::uuid
    ORDER BY d.created_at
  `, [req.params['projectId']])
  res.json({ data: rows.rows })
})

router.post('/:projectId/dependencies', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as Record<string, unknown>
  if (!b['predecessor_id'] || !b['successor_id']) {
    res.status(422).json({ error: 'validation', message: 'predecessor_id and successor_id required' })
    return
  }
  if (b['predecessor_id'] === b['successor_id']) {
    res.status(422).json({ error: 'validation', message: 'predecessor and successor must differ' })
    return
  }

  try {
    const result = await tenantQuery(tenantId, `
      INSERT INTO schedule_dependencies
        (tenant_id, predecessor_id, successor_id, lag_days)
      VALUES
        (current_setting('app.current_tenant_id',true)::uuid, $1, $2, $3)
      RETURNING *
    `, [b['predecessor_id'], b['successor_id'], Number(b['lag_days'] ?? 0)])
    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('schedule_deps_unique')) {
      res.status(409).json({ error: 'conflict', message: 'dependency already exists' })
      return
    }
    throw err
  }
})

router.delete('/dependencies/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM schedule_dependencies
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING id
  `, [req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

// ─── CPM compute ──────────────────────────────────────────────────────────────

router.get('/:projectId/cpm', requireCapability('schedule.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const [tasks, deps] = await Promise.all([
    tenantQuery<{ id: string; duration_days: number }>(tenantId, `
      SELECT id, duration_days FROM schedule_tasks
      WHERE project_id = $1
        AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    `, [req.params['projectId']]),
    tenantQuery<{ predecessor_id: string; successor_id: string; lag_days: number }>(tenantId, `
      SELECT d.predecessor_id, d.successor_id, d.lag_days
      FROM   schedule_dependencies d
      JOIN   schedule_tasks p ON p.id = d.predecessor_id
      WHERE  p.project_id = $1
        AND  d.tenant_id = current_setting('app.current_tenant_id',true)::uuid
    `, [req.params['projectId']]),
  ])

  try {
    const out = computeCpm(tasks.rows, deps.rows)
    res.json({ data: out })
  } catch (err) {
    if (err instanceof CpmCycleError) {
      res.status(409).json({ error: 'cycle_detected', cycle: err.cycle, message: err.message })
      return
    }
    if (err instanceof CpmMissingTaskError) {
      res.status(409).json({ error: 'missing_task', task_id: err.taskId, message: err.message })
      return
    }
    throw err
  }
})

export default router
