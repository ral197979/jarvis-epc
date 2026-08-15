/**
 * Denver Engineering — Autosign Rules + Arbitration Routes
 * v4.31.0
 *
 *   GET    /api/v1/commissioning/autosign-rules
 *   POST   /api/v1/commissioning/autosign-rules
 *   PATCH  /api/v1/commissioning/autosign-rules/:id
 *   DELETE /api/v1/commissioning/autosign-rules/:id
 *
 *   POST   /api/v1/commissioning/arbitrate
 *     Body: { system_type, criteria_name, numericValue? or booleanValue?,
 *             project_id?, client_id?, pack_id?, commit?: bool }
 *     Default commit=false so the endpoint can be used as a preview
 *     (what would the system decide) without side effects.
 *
 * CRUD is owner/admin-only; arbitrate is any authenticated user (it
 * only reads or writes observations through the normal audit/action
 * trail; not a privileged operation).
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { arbitrate } from '../services/ciArbiter'
import { requireCapability } from '../authz/requireCapability'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)


function _pagination(q: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(q['page'] ?? '1'), 10))
  const limit = Math.min(200, Math.max(1, parseInt(String(q['limit'] ?? '50'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

router.get('/', requireCapability('commissioning.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { scope, system_type, criteria_name, enabled } = req.query as Record<string, string>

  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (scope)         { conds.push(`scope = $${i++}`);         vals.push(scope) }
  if (system_type)   { conds.push(`system_type = $${i++}`);   vals.push(system_type) }
  if (criteria_name) { conds.push(`criteria_name = $${i++}`); vals.push(criteria_name) }
  if (enabled === 'true' || enabled === 'false') {
    conds.push(`enabled = $${i++}`)
    vals.push(enabled === 'true')
  }
  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, scope, client_id, project_id, system_type, criteria_name, criteria_kind,
             target_value, tolerance_pct, tolerance_abs, unit, expected_bool,
             enabled, baseline_min_samples, novelty_z_threshold,
             created_at, updated_at
      FROM   commissioning_autosign_rules
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ORDER  BY system_type, criteria_name, scope
      LIMIT  $${i} OFFSET $${i + 1}
    `, [...vals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM commissioning_autosign_rules
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    `, vals),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({ data: rows.rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

router.post('/', requireCapability('commissioning.approve') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as Record<string, unknown>
  const scope        = String(b['scope'] ?? '')
  const systemType   = b['system_type']   as string
  const criteriaName = b['criteria_name'] as string
  const criteriaKind = String(b['criteria_kind'] ?? 'numeric')

  if (!['global','client','project'].includes(scope)) {
    res.status(422).json({ error: 'validation', message: 'scope must be global|client|project' }); return
  }
  if (!systemType || !criteriaName) {
    res.status(422).json({ error: 'validation', message: 'system_type and criteria_name required' }); return
  }
  if (!['numeric','boolean'].includes(criteriaKind)) {
    res.status(422).json({ error: 'validation', message: 'criteria_kind must be numeric|boolean' }); return
  }

  try {
    const result = await tenantQuery(tenantId, `
      INSERT INTO commissioning_autosign_rules
        (tenant_id, scope, client_id, project_id,
         system_type, criteria_name, criteria_kind,
         target_value, tolerance_pct, tolerance_abs, unit,
         expected_bool, enabled, baseline_min_samples, novelty_z_threshold,
         created_by)
      VALUES
        (current_setting('app.current_tenant_id',true)::uuid,
         $1, $2, $3, $4, $5, $6::autosign_criteria_kind,
         $7, $8, $9, $10, $11, COALESCE($12, TRUE), COALESCE($13, 30), COALESCE($14, 2.5),
         $15)
      RETURNING *
    `, [
      scope, b['client_id'] ?? null, b['project_id'] ?? null,
      systemType, criteriaName, criteriaKind,
      b['target_value']  ?? null,
      b['tolerance_pct'] ?? null,
      b['tolerance_abs'] ?? null,
      b['unit']          ?? null,
      b['expected_bool'] ?? null,
      b['enabled'],
      b['baseline_min_samples'],
      b['novelty_z_threshold'],
      req.auth?.sub ?? null,
    ])
    res.status(201).json({ data: result.rows[0] })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/autosign_numeric_shape|autosign_boolean_shape/.test(msg)) {
      res.status(422).json({
        error: 'validation',
        message: 'invalid rule shape: numeric needs target + one tolerance; boolean needs expected_bool only',
      })
      return
    }
    throw err
  }
})

router.patch('/:id', requireCapability('commissioning.approve') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const fields = ['target_value','tolerance_pct','tolerance_abs','unit','expected_bool',
                  'enabled','baseline_min_samples','novelty_z_threshold']
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
    UPDATE commissioning_autosign_rules SET ${sets.join(', ')}
    WHERE id = $${i}
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING *
  `, vals)
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

router.delete('/:id', requireCapability('commissioning.approve') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM commissioning_autosign_rules
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING id
  `, [req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.status(204).send()
})

// ─── Arbitration ──────────────────────────────────────────────────────────────

router.post('/arbitrate', requireCapability('commissioning.approve') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as Record<string, unknown>
  const systemType   = b['system_type']   as string | undefined
  const criteriaName = b['criteria_name'] as string | undefined
  if (!systemType || !criteriaName) {
    res.status(422).json({ error: 'validation', message: 'system_type and criteria_name required' }); return
  }

  const hasNumeric = typeof b['numericValue'] === 'number'
  const hasBool    = typeof b['booleanValue'] === 'boolean'
  if (hasNumeric === hasBool) {
    res.status(422).json({ error: 'validation', message: 'provide exactly one of numericValue or booleanValue' })
    return
  }

  const result = await arbitrate({
    tenantId,
    projectId:    (b['project_id'] as string | undefined) ?? null,
    clientId:     (b['client_id']  as string | undefined) ?? null,
    systemType,
    criteriaName,
    unit:         b['unit'] as string | undefined,
    packId:       (b['pack_id']    as string | undefined) ?? null,
    userId:       req.auth?.sub ?? null,
    numericValue: hasNumeric ? (b['numericValue'] as number) : undefined,
    booleanValue: hasBool    ? (b['booleanValue'] as boolean) : undefined,
  }, { commit: b['commit'] === true })

  res.json({ data: result })
})

export default router
