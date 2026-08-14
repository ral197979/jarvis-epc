/**
 * Denver Engineering — Mobile Sync Routes (v4.35.0)
 * ───────────────────────────────────────────────────
 * Ava Phase 3
 *   POST /sync/upload    — push offline mutations to server
 *   POST /sync/pull      — fetch delta since watermark
 *   POST /sync/resolve   — resolve a conflict
 *   POST /sync/register  — register a mobile device
 *   GET  /sync/conflicts — list unresolved conflicts
 */
import { Router, type Response } from 'express'
import type { TenantRequest as Request } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import { processSyncUpload, pullDelta } from '../services/mobile/syncEngine'
import { resolveConflict, listUnresolvedConflicts } from '../services/mobile/conflictResolver'
import { requireCapability } from '../authz/requireCapability'

export const syncRouter = Router()

// ─── POST /sync/register ──────────────────────────────────────────────────────

syncRouter.post('/register', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const userId   = (req as never as { auth?: { sub?: string } }).auth?.sub
  const { device_token, device_name, device_platform, app_version, push_token } = req.body as {
    device_token: string
    device_name?: string
    device_platform?: string
    app_version?: string
    push_token?: string
  }

  if (!device_token) { res.status(400).json({ error: 'device_token required' }); return }
  if (!userId)       { res.status(401).json({ error: 'unauthorized' }); return }

  const res2 = await tenantQuery(tenantId, `
    INSERT INTO mobile_devices
      (tenant_id, user_id, device_token, device_name, device_platform, app_version, push_token, last_seen_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (device_token) DO UPDATE SET
      device_name     = EXCLUDED.device_name,
      app_version     = EXCLUDED.app_version,
      push_token      = EXCLUDED.push_token,
      last_seen_at    = NOW(),
      is_active       = TRUE
    RETURNING id
  `, [tenantId, userId, device_token, device_name ?? null,
      device_platform ?? null, app_version ?? null, push_token ?? null])

  res.json({ data: { device_id: res2.rows[0].id } })
})

// ─── POST /sync/upload ────────────────────────────────────────────────────────

syncRouter.post('/upload', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const { device_id, mutations, client_watermark } = req.body as {
    device_id:         string
    mutations:         unknown[]
    client_watermark?: string
  }

  if (!device_id || !Array.isArray(mutations)) {
    res.status(400).json({ error: 'device_id and mutations[] required' })
    return
  }

  // Validate device belongs to tenant
  const deviceRes = await tenantQuery(tenantId,
    `SELECT id, user_id FROM mobile_devices WHERE id = $1 AND tenant_id = $2 AND is_active = TRUE`,
    [device_id, tenantId],
  )
  if (!deviceRes.rows[0]) { res.status(404).json({ error: 'device_not_found' }); return }

  // Update last_seen
  void tenantQuery(tenantId, `UPDATE mobile_devices SET last_seen_at = NOW() WHERE id = $1`, [device_id])

  const result = await processSyncUpload({
    tenantId,
    deviceId: device_id,
    userId:   deviceRes.rows[0].user_id as string,
    mutations: mutations as never,
    clientWatermark: client_watermark,
  })

  res.json({ data: result })
})

// ─── POST /sync/pull ──────────────────────────────────────────────────────────

syncRouter.post('/pull', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const { since_watermark, limit } = req.body as { since_watermark?: string; limit?: number }

  const delta = await pullDelta(tenantId, since_watermark, Math.min(limit ?? 200, 500))
  res.json({ data: delta })
})

// ─── POST /sync/resolve ───────────────────────────────────────────────────────

syncRouter.post('/resolve', requireCapability('field.write') as never, async (req: Request, res: Response) => {
  const tenantId  = req.tenantId!
  const resolvedBy = (req as never as { auth?: { sub?: string } }).auth?.sub
  const { conflict_id, strategy, merge_fields } = req.body as {
    conflict_id:  string
    strategy:     'client_wins' | 'server_wins' | 'merged' | 'rejected'
    merge_fields?: Record<string, unknown>
  }

  if (!conflict_id || !strategy) {
    res.status(400).json({ error: 'conflict_id and strategy required' })
    return
  }

  const ok = await resolveConflict({
    tenantId,
    conflictId:  conflict_id,
    strategy,
    resolvedBy:  resolvedBy ?? 'unknown',
    mergeFields: merge_fields,
  })

  if (!ok) { res.status(404).json({ error: 'conflict_not_found' }); return }
  res.json({ data: { resolved: true, conflict_id } })
})

// ─── GET /sync/conflicts ──────────────────────────────────────────────────────

syncRouter.get('/conflicts', async (req: Request, res: Response) => {
  const tenantId = req.tenantId!
  const limit    = Math.min(parseInt(req.query['limit'] as string ?? '50', 10), 200)

  const conflicts = await listUnresolvedConflicts(tenantId, limit)
  res.json({ data: conflicts, meta: { count: conflicts.length } })
})
