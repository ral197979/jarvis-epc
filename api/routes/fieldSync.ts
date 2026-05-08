/**
 * Denver Engineering — Field Sync Routes
 * ─────────────────────────────────
 * v4.31.0 | Offline-first mutation replay for field workflows.
 *
 *   POST /api/v1/field-sync/batch
 *     Body:  { operations: FieldSyncOperation[] }
 *     Reply: { results:    FieldSyncResult[]    }  (one-to-one order-preserving)
 *
 *   GET  /api/v1/field-sync/operations
 *     Paginated history of processed operations for this tenant — useful
 *     for admins diagnosing replay issues and for clients resyncing
 *     local state after IndexedDB loss.
 *
 * The heavy lifting lives in api/services/fieldSync.ts. This file is
 * just HTTP plumbing.
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import {
  processFieldSyncBatch,
  type FieldSyncOperation,
} from '../services/fieldSync'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

const MAX_BATCH = 100

router.post('/batch', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const body = req.body as { operations?: unknown }
  if (!Array.isArray(body.operations)) {
    res.status(422).json({ error: 'validation', message: 'operations must be an array' })
    return
  }
  if (body.operations.length === 0) {
    res.json({ results: [] })
    return
  }
  if (body.operations.length > MAX_BATCH) {
    res.status(413).json({ error: 'batch_too_large', message: `max ${MAX_BATCH} operations per batch` })
    return
  }

  const results = await processFieldSyncBatch(
    tenantId,
    req.auth?.sub ?? null,
    body.operations as FieldSyncOperation[],
  )
  res.json({ results })
})

router.get('/operations', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const page  = Math.max(1, parseInt(String(req.query['page']  ?? '1'), 10))
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query['limit'] ?? '50'), 10)))
  const offset = (page - 1) * limit

  const { resource, status } = req.query as Record<string, string>
  const conds: string[] = []
  const vals: unknown[] = []
  let i = 1
  if (resource) { conds.push(`resource = $${i++}`); vals.push(resource) }
  if (status)   { conds.push(`status = $${i++}`);   vals.push(status) }
  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const [rows, countRow] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT id, client_op_id, resource, op, status, resource_id,
             error_text, created_by, created_at
      FROM   field_sync_operations
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ORDER BY created_at DESC
      LIMIT  $${i} OFFSET $${i + 1}
    `, [...vals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM field_sync_operations
      WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    `, vals),
  ])

  const total = parseInt(countRow.rows[0]?.count ?? '0', 10)
  res.json({
    data: rows.rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  })
})

export default router
