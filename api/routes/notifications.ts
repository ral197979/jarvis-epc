/**
 * Denver Engineering — Notifications API Routes (ADR-014 Phase 2C-4B)
 * ─────────────────────────────────────────────────────────────────────────────
 * POST /api/v1/notifications/scan            — tenant scan + recipient fan-out
 * GET  /api/v1/notifications                 — MY deliveries (unread, category, limit)
 * GET  /api/v1/notifications/count           — MY unread count
 * POST /api/v1/notifications/:id/read        — mark one of MINE read
 * POST /api/v1/notifications/read-all        — mark all of MINE read
 * POST /api/v1/notifications/:id/dismiss     — dismiss one of MINE
 * POST /api/v1/notifications/clear           — dismiss all of MINE
 *
 * Every route below used to take only a tenant id, which is why Phase 2C-4A
 * deferred them: read/dismiss wrote shared columns, so one user acting changed
 * what every other user saw. They now resolve the LIVE database principal and
 * operate on that user's `notification_deliveries` rows.
 *
 * Nothing here accepts a recipient, a capability set or an audience from the
 * request. The user is the live principal; the source policy comes from
 * `notificationSourcePolicies.ts`. A caller cannot widen their own audience or
 * blank an event's `required_capabilities`.
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { personalPrincipal } from '../authz/personalScope'
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

/**
 * The live principal, or `null` after the refusal has been written.
 *
 * Both the id and the ROLE are needed downstream: the role re-evaluates each
 * event's `required_capabilities`, so a user demoted after delivery stops
 * seeing what they were sent.
 */
async function principalOf(
  req: Request, res: Response,
): Promise<{ tenantId: string; userId: string; role: string } | null> {
  const r = req as R
  const principal = await personalPrincipal(req)
  if (!principal) { res.status(401).json({ error: 'unauthenticated' }); return null }
  return { tenantId: r.tenantId!, userId: principal.id, role: principal.role }
}

// ─── POST /notifications/scan ────────────────────────────────────────────────
// Tenant-wide scanning and fan-out across every user's inbox: Personal Inbox
// administration, so personal.admin (owner only). Deliberately not
// platform.admin — ADR-014 D2 keeps the platform administrator out of business
// workflow — and deliberately not personal.write, which every ordinary holder
// has. The guard runs before any scan query, so a refused caller writes nothing.
notificationsRouter.post('/notifications/scan',
  requireCapability('personal.admin') as never,
  async (req: Request, res: Response) => {
    const r = req as R
    try {
      const inserted = await scanAndGenerate(r.tenantId!)
      res.json({ inserted })
    } catch (e) { res.status(500).json({ error: 'Scan failed' }) }
  })

// ─── GET /notifications ──────────────────────────────────────────────────────

notificationsRouter.get('/notifications',
  requireCapability('personal.view') as never,
  async (req: Request, res: Response) => {
    const ids = await principalOf(req, res); if (!ids) return
    try {
      const notifs = await listNotifications(ids.tenantId, ids.userId, ids.role, {
        unreadOnly: q(req, 'unread') === 'true',
        category:   q(req, 'category') as NotifCategory | undefined,
        limit:      q(req, 'limit') ? Number(q(req, 'limit')) : undefined,
      })
      res.json({ notifications: notifs })
    } catch (e) { res.status(500).json({ error: 'Failed to list notifications' }) }
  })

// ─── GET /notifications/count ────────────────────────────────────────────────

notificationsRouter.get('/notifications/count',
  requireCapability('personal.view') as never,
  async (req: Request, res: Response) => {
    const ids = await principalOf(req, res); if (!ids) return
    try { res.json({ count: await unreadCount(ids.tenantId, ids.userId, ids.role) }) }
    catch (e) { res.status(500).json({ error: 'Failed to get count' }) }
  })

// ─── POST /notifications/read-all ────────────────────────────────────────────

notificationsRouter.post('/notifications/read-all',
  requireCapability('personal.write') as never,
  async (req: Request, res: Response) => {
    const ids = await principalOf(req, res); if (!ids) return
    try {
      const updated = await markAllRead(ids.tenantId, ids.userId, ids.role)
      res.json({ ok: true, updated })
    } catch (e) { res.status(500).json({ error: 'Failed' }) }
  })

// ─── POST /notifications/clear ───────────────────────────────────────────────
// A personal operation now: it dismisses THIS user's deliveries. The shared
// event survives and every other user's inbox is untouched.

notificationsRouter.post('/notifications/clear',
  requireCapability('personal.write') as never,
  async (req: Request, res: Response) => {
    const ids = await principalOf(req, res); if (!ids) return
    try {
      const cleared = await clearAll(ids.tenantId, ids.userId, ids.role)
      res.json({ ok: true, cleared })
    } catch (e) { res.status(500).json({ error: 'Failed' }) }
  })

// ─── POST /notifications/:id/read ────────────────────────────────────────────
// `:id` is the event id the client already holds. It names an event, never a
// delivery, so there is no id a caller can supply that reaches a peer's row.
// A miss answers 404 rather than 403: whether the event exists is itself
// information about somebody else's inbox.

notificationsRouter.post('/notifications/:id/read',
  requireCapability('personal.write') as never,
  async (req: Request, res: Response) => {
    const ids = await principalOf(req, res); if (!ids) return
    try {
      const ok = await markRead(ids.tenantId, ids.userId, ids.role, p(req, 'id'))
      if (!ok) { res.status(404).json({ error: 'not_found' }); return }
      res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: 'Failed' }) }
  })

// ─── POST /notifications/:id/dismiss ─────────────────────────────────────────

notificationsRouter.post('/notifications/:id/dismiss',
  requireCapability('personal.write') as never,
  async (req: Request, res: Response) => {
    const ids = await principalOf(req, res); if (!ids) return
    try {
      const ok = await dismiss(ids.tenantId, ids.userId, ids.role, p(req, 'id'))
      if (!ok) { res.status(404).json({ error: 'not_found' }); return }
      res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: 'Failed' }) }
  })
