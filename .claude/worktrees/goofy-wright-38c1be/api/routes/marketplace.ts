/**
 * JARVIS EPC — Marketplace Route (G4)
 * GET  /api/v1/marketplace          — list available tools
 * PATCH /api/v1/marketplace/:name   — enable/disable (owner role only)
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import { slog } from '../../src/modules/observability/index'

type Req = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as any)
router.use(requireTenant() as any)

router.get('/marketplace', async (req: Request, res: Response) => {
  const r = req as Req
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT * FROM marketplace_tools WHERE tenant_id=$1 ORDER BY name`,
      [r.tenantId!])
    res.json({ tools: result.rows, total: result.rowCount })
  } catch {
    res.json({ tools: [], total: 0 })
  }
})

router.patch('/marketplace/:name', async (req: Request, res: Response) => {
  const r = req as Req
  const { enabled } = req.body ?? {}
  const role = (r as any).auth?.role ?? 'viewer'
  if (role !== 'owner') return res.status(403).json({ error: 'owner role required' })
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled (boolean) required' })
  try {
    await tenantQuery(r.tenantId!, `
      INSERT INTO marketplace_tools (tenant_id, name, enabled)
      VALUES ($1,$2,$3)
      ON CONFLICT (tenant_id, name) DO UPDATE SET enabled=$3, updated_at=NOW()`,
      [r.tenantId!, req.params.name, enabled])
    slog('INFO', 'marketplace', `Tool ${enabled ? 'enabled' : 'disabled'}`, { name: req.params.name, tenantId: r.tenantId })
    res.json({ name: req.params.name, enabled })
  } catch (e) {
    console.error('[marketplace] patch error', e)
    res.status(500).json({ error: 'Failed to update tool' })
  }
})

export { router as marketplaceRouter }
