/**
 * Denver Engineering — Notifications API Routes (v10.14.0)
 *
 * POST /api/v1/notifications/scan            — run alert scan, insert new notifs
 * GET  /api/v1/notifications                 — list (unreadOnly, category, limit)
 * GET  /api/v1/notifications/count           — unread count
 * POST /api/v1/notifications/:id/read        — mark one read
 * POST /api/v1/notifications/read-all        — mark all read
 * POST /api/v1/notifications/:id/dismiss     — dismiss one
 * POST /api/v1/notifications/clear           — dismiss all
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import {
  scanAndGenerate, listNotifications, unreadCount,
  markRead, markAllRead, dismiss, clearAll,
  type NotifCategory,
} from '../services/notifications2/notificationService'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}
const q = (req: Request, key: string) => {
  const v = (req.query as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : v
}

export const notificationsRouter = Router()
notificationsRouter.use(requireAuth     as never)
notificationsRouter.use(requireTenant() as never)

notificationsRouter.post('/notifications/scan', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const inserted = await scanAndGenerate(r.tenantId!)
    res.json({ inserted })
  } catch (e) { res.status(500).json({ error: 'Scan failed' }) }
})

notificationsRouter.get('/notifications', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const notifs = await listNotifications(r.tenantId!, {
      unreadOnly: q(req, 'unread') === 'true',
      category:   q(req, 'category') as NotifCategory | undefined,
      limit:      q(req, 'limit') ? Number(q(req, 'limit')) : undefined,
    })
    res.json({ notifications: notifs })
  } catch (e) { res.status(500).json({ error: 'Failed to list notifications' }) }
})

notificationsRouter.get('/notifications/count', async (req: Request, res: Response) => {
  const r = req as R
  try { res.json({ count: await unreadCount(r.tenantId!) }) }
  catch (e) { res.status(500).json({ error: 'Failed to get count' }) }
})

notificationsRouter.post('/notifications/read-all', async (req: Request, res: Response) => {
  const r = req as R
  try { await markAllRead(r.tenantId!); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: 'Failed' }) }
})

notificationsRouter.post('/notifications/clear', async (req: Request, res: Response) => {
  const r = req as R
  try { await clearAll(r.tenantId!); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: 'Failed' }) }
})

notificationsRouter.post('/notifications/:id/read', async (req: Request, res: Response) => {
  const r = req as R
  try { await markRead(r.tenantId!, p(req, 'id')); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: 'Failed' }) }
})

notificationsRouter.post('/notifications/:id/dismiss', async (req: Request, res: Response) => {
  const r = req as R
  try { await dismiss(r.tenantId!, p(req, 'id')); res.json({ ok: true }) }
  catch (e) { res.status(500).json({ error: 'Failed' }) }
})
