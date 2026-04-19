/**
 * JARVIS EPC — Commissioning Baselines Routes (v4.31.0)
 * Admin-visibility endpoints over the rolling baseline state.
 *
 *   GET    /api/v1/commissioning/baselines
 *          Paginated list of baselines. Each row carries sample_count,
 *          mean/std, IQR band, warmup status, last_sample_at.
 *   GET    /api/v1/commissioning/baselines/:id
 *          Detail + recent observations (N most recent) for scatter plots.
 *   DELETE /api/v1/commissioning/baselines/:id
 *          Resets: drops the baseline row and its observations. Next
 *          matching arbitration will re-bootstrap from zero.
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

function _requireAdmin(req: Req, res: Response): boolean {
  if (!['owner','admin'].includes(req.auth?.role ?? '')) {
    res.status(403).json({ error: 'forbidden' })
    return false
  }
  return true
}

router.get('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const page  = Math.max(1, parseInt(String(req.query['page']  ?? '1'), 10))
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10)))
  const offset = (page - 1) * limit

  const { system_type, scope } = req.query as Record<string, string>
  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (system_type) { conds.push(`system_type = $${i++}`); vals.push(system_type) }
  if (scope)       { conds.push(`scope = $${i++}`);       vals.push(scope) }
  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT b.id, b.scope, b.client_id, b.project_id,
             b.system_type, b.criteria_name,
             b.sample_count, b.mean_value, b.std_dev,
             b.min_observed, b.max_observed, b.p25_value, b.p75_value,
             b.window_days, b.last_sample_at, b.updated_at,
             -- Warmup state is inferred: the arbiter compares sample_count
             -- against the matching rule's baseline_min_samples, but for
             -- dashboard purposes a simple rule-of-thumb is still useful.
             (b.sample_count >= 30) AS is_warm
      FROM   commissioning_baselines b
      WHERE  b.tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ORDER  BY b.updated_at DESC NULLS LAST
      LIMIT  $${i} OFFSET $${i + 1}
    `, [...vals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM commissioning_baselines
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    `, vals),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({ data: rows.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

router.get('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const [baseline, observations] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT * FROM commissioning_baselines
      WHERE  id = $1
        AND  tenant_id = current_setting('app.current_tenant_id',true)::uuid
    `, [req.params['id']]),
    tenantQuery(tenantId, `
      SELECT id, value, decision, decision_reason, z_score, created_at
      FROM   commissioning_observations
      WHERE  baseline_id = $1
        AND  tenant_id   = current_setting('app.current_tenant_id',true)::uuid
      ORDER  BY created_at DESC
      LIMIT  100
    `, [req.params['id']]),
  ])

  if (!baseline.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: { baseline: baseline.rows[0], observations: observations.rows } })
})

router.delete('/:id', async (req: Req, res: Response) => {
  if (!_requireAdmin(req, res)) return
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const r = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM commissioning_baselines
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING id
  `, [req.params['id']])
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

export default router
