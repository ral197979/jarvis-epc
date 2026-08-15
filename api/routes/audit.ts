/**
 * Denver Engineering — Audit Log Routes
 * ─────────────────────────────
 * v4.30.0 | GET /api/v1/audit, GET /api/v1/audit/:id
 *
 * Returns tenant-scoped audit events written by other routes via the
 * audit_log table (see api/db/migrations/001_tenants_and_users.sql).
 *
 * All routes require:
 *   - requireAuth    (sets req.auth)
 *   - requireTenant  (sets req.tenantId / req.tenant)
 *
 * Filters:
 *   ?action=create|read|update|delete|login|logout|export|approve|reject|upload|download|integrate_push|integrate_pull
 *   ?resource=<string>          // e.g. "projects"
 *   ?resource_id=<uuid>
 *   ?user_id=<uuid>
 *   ?from=<iso>&to=<iso>        // date range on created_at
 *   ?search=<free text>         // matches resource / request_id / user_agent
 *
 * Pagination: ?page=1&limit=50
 * Sort:       ?sort=created_at&dir=desc (default)
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { slog } from '../../src/modules/observability/index'
import { requireCapability } from '../authz/requireCapability'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()

// ─── Middleware stack ────────────────────────────────────────────────────────
router.use(requireAuth as never)
router.use(requireTenant() as never)

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _paginationParams(query: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(query['page']  ?? '1'), 10))
  const limit = Math.min(200, Math.max(1, parseInt(String(query['limit'] ?? '50'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

const ACTIONS = new Set([
  'create','read','update','delete','login','logout','export',
  'approve','reject','upload','download','integrate_push','integrate_pull',
])

// ─── GET /api/v1/audit ────────────────────────────────────────────────────────
router.get('/', requireCapability('audit.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _paginationParams(req.query as Record<string, unknown>)
  const {
    action,
    resource,
    resource_id,
    user_id,
    from,
    to,
    search,
    sort = 'created_at',
    dir  = 'desc',
  } = req.query as Record<string, string>

  const allowedSort = ['created_at','action','resource','user_id']
  const sortCol = allowedSort.includes(sort) ? sort : 'created_at'
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC'

  const conditions: string[] = []
  const values: unknown[]    = []
  let   paramIdx             = 1

  if (action) {
    if (!ACTIONS.has(action)) {
      res.status(400).json({ error: 'invalid_action', allowed: Array.from(ACTIONS) })
      return
    }
    conditions.push(`a.action = $${paramIdx++}::audit_action`)
    values.push(action)
  }
  if (resource)    { conditions.push(`a.resource = $${paramIdx++}`); values.push(resource) }
  if (resource_id) { conditions.push(`a.resource_id = $${paramIdx++}::uuid`); values.push(resource_id) }
  if (user_id)     { conditions.push(`a.user_id = $${paramIdx++}::uuid`); values.push(user_id) }
  if (from)        { conditions.push(`a.created_at >= $${paramIdx++}::timestamptz`); values.push(from) }
  if (to)          { conditions.push(`a.created_at <= $${paramIdx++}::timestamptz`); values.push(to) }
  if (search) {
    conditions.push(`(a.resource ILIKE $${paramIdx} OR a.request_id ILIKE $${paramIdx} OR a.user_agent ILIKE $${paramIdx})`)
    values.push(`%${search}%`)
    paramIdx++
  }

  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  try {
    const [dataRes, countRes] = await Promise.all([
      tenantQuery(tenantId, `
        SELECT a.id,
               a.tenant_id,
               a.user_id,
               u.display_name AS user_name,
               u.email        AS user_email,
               a.action,
               a.resource,
               a.resource_id,
               a.old_data,
               a.new_data,
               a.ip_address,
               a.user_agent,
               a.request_id,
               a.created_at
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE a.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        ${where}
        ORDER BY a.${sortCol} ${sortDir}
        LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
      `, [...values, limit, offset]),
      tenantQuery<{ count: string }>(tenantId, `
        SELECT COUNT(*)::text AS count
        FROM audit_log a
        WHERE a.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        ${where}
      `, values),
    ])

    const total = parseInt(countRes.rows[0]?.count ?? '0', 10)
    res.json({
      data: dataRes.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    slog('ERROR', 'audit', 'audit.list.failed', { err: String(err), tenantId })
    res.status(500).json({ error: 'audit_list_failed' })
  }
})

// ─── GET /api/v1/audit/:id ────────────────────────────────────────────────────
router.get('/:id', requireCapability('audit.view') as never, async (req: Req, res: Response) => {
  const { tenantId } = req
  const { id } = req.params
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!id)       { res.status(400).json({ error: 'id_required' });     return }

  try {
    const r = await tenantQuery(tenantId, `
      SELECT a.*,
             u.display_name AS user_name,
             u.email        AS user_email
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = current_setting('app.current_tenant_id', true)::uuid
        AND a.id = $1::uuid
      LIMIT 1
    `, [id])
    if (!r.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
    res.json(r.rows[0])
  } catch (err) {
    slog('ERROR', 'audit', 'audit.get.failed', { err: String(err), tenantId, id })
    res.status(500).json({ error: 'audit_get_failed' })
  }
})

// ─── GET /api/v1/audit/_meta/actions ──────────────────────────────────────────
// Returns the allowed action values for UI filter dropdowns.
router.get('/_meta/actions', requireCapability('audit.view') as never, async (_req: Req, res: Response) => {
  res.json({ actions: Array.from(ACTIONS) })
})

// ─── GET /api/v1/audit/export — Compliance export (CSV or JSON) ───────────────
// Required for SOC 2, ISO 27001, and enterprise compliance audits.
// Supports: ?format=csv|json, ?from=<iso>, ?to=<iso>, ?resource=<str>, max 10k rows.

router.get('/export', requireCapability('audit.view') as never,
  async (req: Req, res: Response) => {
    const { tenantId } = req
    if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

    const format   = req.query['format'] === 'csv' ? 'csv' : 'json'
    const from     = req.query['from']     as string | undefined
    const to       = req.query['to']       as string | undefined
    const resource = req.query['resource'] as string | undefined
    const limit    = Math.min(10_000, parseInt(String(req.query['limit'] ?? '10000'), 10))

    const conditions: string[] = [`a.tenant_id = current_setting('app.current_tenant_id', true)::uuid`]
    const values: unknown[]    = []
    let   pi                   = 1

    if (from)     { conditions.push(`a.created_at >= $${pi++}::timestamptz`); values.push(from) }
    if (to)       { conditions.push(`a.created_at <= $${pi++}::timestamptz`); values.push(to) }
    if (resource) { conditions.push(`a.resource = $${pi++}`); values.push(resource) }

    values.push(limit)
    const where = conditions.join(' AND ')

    try {
      const result = await tenantQuery(tenantId, `
        SELECT
          a.id,
          a.created_at,
          u.email        AS user_email,
          u.display_name AS user_name,
          a.action,
          a.resource,
          a.resource_id,
          a.ip_address,
          a.user_agent,
          a.request_id
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE ${where}
        ORDER BY a.created_at DESC
        LIMIT $${pi}
      `, values)

      slog('INFO', 'audit', '[export] Audit log exported', {
        tenantId, format, rows: result.rows.length,
      })

      if (format === 'csv') {
        const headers = ['id','created_at','user_email','user_name','action','resource','resource_id','ip_address','user_agent','request_id']
        const escape  = (v: unknown) => {
          const s = v == null ? '' : String(v)
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"` : s
        }
        const rows = result.rows.map((r: Record<string,unknown>) =>
          headers.map(h => escape(r[h])).join(',')
        )
        const csv = [headers.join(','), ...rows].join('\n')
        const filename = `audit-export-${tenantId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`
        res.set('Content-Type', 'text/csv; charset=utf-8')
        res.set('Content-Disposition', `attachment; filename="${filename}"`)
        res.send(csv)
      } else {
        res.json({
          data:      result.rows,
          exported:  result.rows.length,
          exportedAt: new Date().toISOString(),
          filters:   { from, to, resource },
        })
      }
    } catch (err) {
      slog('ERROR', 'audit', '[export] Export failed', { err: String(err), tenantId })
      res.status(500).json({ error: 'export_failed' })
    }
  }
)

export { router as auditRouter }
