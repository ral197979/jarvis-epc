/**
 * Denver Engineering — Automation Admin Routes
 * ─────────────────────────────────────────
 * v4.31.0 | CRUD + observability for the scheduler.
 *
 * Routes (all owner/admin + tenant-scoped):
 *   GET    /api/v1/admin/automation/handlers                  — registered job_types
 *   GET    /api/v1/admin/automation/scheduled                 — list recurring defs
 *   POST   /api/v1/admin/automation/scheduled                 — create one
 *   PATCH  /api/v1/admin/automation/scheduled/:id             — toggle/update
 *   DELETE /api/v1/admin/automation/scheduled/:id
 *   GET    /api/v1/admin/automation/background                — list recent jobs
 *   POST   /api/v1/admin/automation/background/:id/retry      — requeue a failed job
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { listRegisteredHandlers } from '../services/scheduler'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()

router.use(requireAuth as never)
router.use(requireTenant() as never)

function _requireAdmin(req: Req, res: Response): boolean {
  if (!['owner','admin'].includes(req.auth?.role ?? '')) {
    res.status(403).json({ error: 'forbidden', message: 'owner/admin role required' })
    return false
  }
  return true
}

function _pagination(q: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(q['page'] ?? '1'), 10))
  const limit = Math.min(200, Math.max(1, parseInt(String(q['limit'] ?? '50'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /handlers — list job_types known to this process
// ═══════════════════════════════════════════════════════════════════════════

router.get('/handlers', (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  res.json({ data: listRegisteredHandlers() })
})

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULED JOBS
// ═══════════════════════════════════════════════════════════════════════════

router.get('/scheduled', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, name, job_type, payload_json, interval_seconds, cron_expression,
             enabled, max_attempts, next_run_at, last_run_at, last_job_id,
             created_at, updated_at
      FROM scheduled_jobs
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid
      ORDER BY enabled DESC, next_run_at ASC
      LIMIT $1 OFFSET $2
    `, [limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM scheduled_jobs
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid
    `, []),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({
    data: rows.rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

router.post('/scheduled', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as Record<string, unknown>
  const name     = typeof b['name']     === 'string' ? b['name']     : null
  const jobType  = typeof b['job_type'] === 'string' ? b['job_type'] : null
  if (!name || !jobType) {
    res.status(422).json({ error: 'validation', message: 'name and job_type required' })
    return
  }

  // next_run_at defaults to NOW() in the migration; callers can override.
  const nextRunAt     = (b['next_run_at'] as string | undefined) ?? null
  const intervalSecs  = b['interval_seconds'] == null ? null : Number(b['interval_seconds'])
  const cronExpr      = (b['cron_expression'] as string | undefined) ?? null
  const enabled       = b['enabled']      == null ? true : Boolean(b['enabled'])
  const maxAttempts   = b['max_attempts'] == null ? 3    : Number(b['max_attempts'])
  const payload       = (b['payload_json'] as Record<string, unknown> | undefined) ?? {}

  if (intervalSecs !== null && (!Number.isFinite(intervalSecs) || intervalSecs < 1)) {
    res.status(422).json({ error: 'validation', message: 'interval_seconds must be >= 1' })
    return
  }

  try {
    const result = await tenantQuery(tenantId, `
      INSERT INTO scheduled_jobs
        (tenant_id, created_by, name, job_type, payload_json,
         interval_seconds, cron_expression, enabled, max_attempts,
         next_run_at)
      VALUES
        (current_setting('app.current_tenant_id',true)::uuid,
         $1, $2, $3, $4::jsonb, $5, $6, $7, $8,
         COALESCE($9::TIMESTAMPTZ, NOW()))
      RETURNING *
    `, [
      req.auth?.sub ?? null, name, jobType, JSON.stringify(payload),
      intervalSecs, cronExpr, enabled, maxAttempts, nextRunAt,
    ])
    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('scheduled_jobs_tenant_name_unique')) {
      res.status(409).json({ error: 'conflict', message: `name '${name}' already exists` })
      return
    }
    throw err
  }
})

router.patch('/scheduled/:id', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const fields = ['name','job_type','payload_json','interval_seconds','cron_expression',
                  'enabled','max_attempts','next_run_at']
  const sets: string[] = []
  const vals: unknown[] = []
  let i = 1
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      if (f === 'payload_json') {
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
    UPDATE scheduled_jobs SET ${sets.join(', ')}
    WHERE id = $${i}
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING *
  `, vals)
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

router.delete('/scheduled/:id', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM scheduled_jobs
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING id
  `, [req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

// ═══════════════════════════════════════════════════════════════════════════
// BACKGROUND JOBS (read + retry)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/background', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { status, job_type, scheduled_job_id } = req.query as Record<string, string>

  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (status)           { conds.push(`status = $${i++}`);           vals.push(status) }
  if (job_type)         { conds.push(`job_type = $${i++}`);         vals.push(job_type) }
  if (scheduled_job_id) { conds.push(`scheduled_job_id = $${i++}`); vals.push(scheduled_job_id) }
  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, scheduled_job_id, job_type, status, attempts, max_attempts,
             payload_json, result_json, error_text,
             run_after, locked_at, locked_by, created_at, updated_at
      FROM background_jobs
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ORDER BY created_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `, [...vals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM background_jobs
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    `, vals),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({
    data: rows.rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// KPI SNAPSHOTS (history read)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/kpi-snapshots', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { from, to } = req.query as Record<string, string>

  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (from) { conds.push(`captured_at >= $${i++}`); vals.push(new Date(from).toISOString()) }
  if (to)   { conds.push(`captured_at <= $${i++}`); vals.push(new Date(to).toISOString()) }
  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, captured_at, metrics
      FROM kpi_snapshots
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ORDER BY captured_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `, [...vals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM kpi_snapshots
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    `, vals),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({
    data: rows.rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

router.post('/background/:id/retry', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  // Reset attempts so it gets one fresh pass; clear lock; re-queue immediately.
  const result = await tenantQuery(tenantId, `
    UPDATE background_jobs
    SET status     = 'queued',
        attempts   = 0,
        error_text = NULL,
        locked_at  = NULL,
        locked_by  = NULL,
        run_after  = NOW(),
        updated_at = NOW()
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
      AND status IN ('failed','queued','complete')
    RETURNING id, status, attempts, run_after
  `, [req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ═══════════════════════════════════════════════════════════════════════════
// MCP TOOL MARKETPLACE (per-tenant disable list)
// ═══════════════════════════════════════════════════════════════════════════

router.get('/mcp-tools', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const rows = await tenantQuery(tenantId, `
    SELECT tool_name, reason, disabled_by, created_at
    FROM   mcp_disabled_tools
    WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid
    ORDER  BY tool_name
  `, [])
  res.json({ data: rows.rows })
})

router.post('/mcp-tools/:name/disable', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as { reason?: string }
  try {
    const result = await tenantQuery(tenantId, `
      INSERT INTO mcp_disabled_tools (tenant_id, tool_name, reason, disabled_by)
      VALUES (current_setting('app.current_tenant_id',true)::uuid, $1, $2, $3)
      RETURNING *
    `, [req.params['name'], b.reason ?? null, req.auth?.sub ?? null])
    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('mcp_disabled_tools_unique')) {
      res.status(409).json({ error: 'already_disabled' })
      return
    }
    throw err
  }
})

router.delete('/mcp-tools/:name/disable', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery<{ tool_name: string }>(tenantId, `
    DELETE FROM mcp_disabled_tools
    WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid
      AND tool_name = $1
    RETURNING tool_name
  `, [req.params['name']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_disabled' }); return }
  res.status(204).send()
})

export default router
