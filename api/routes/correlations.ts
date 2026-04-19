/**
 * JARVIS EPC — Correlation Routes (v4.31.0)
 *
 *   POST /api/v1/correlations
 *     Body: { subject: { kind, id, project_id?, system_tag?, occurred_at },
 *             window_hours?, limit? }
 *     Returns ranked list of proximate events from audit_log, daily_logs,
 *     action_items, compliance_tasks, commissioning_packs.
 *
 * Uses POST instead of GET because the subject payload carries structured
 * nested data that's ugly to serialize in query strings.
 */

import { Router, Response } from 'express'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { findCorrelates, type Subject } from '../services/correlationFinder'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

router.post('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const b = req.body as {
    subject?: Partial<Subject>
    window_hours?: number
    limit?: number
  }
  const s = b.subject
  if (!s?.kind || !s?.id || !s?.occurred_at) {
    res.status(422).json({
      error: 'validation',
      message: 'subject.kind, subject.id, and subject.occurred_at are required',
    })
    return
  }

  const hits = await findCorrelates(tenantId, s as Subject, {
    window_hours: b.window_hours,
    limit:        b.limit,
  })
  res.json({
    data: {
      subject: s,
      window_hours: b.window_hours ?? 48,
      hits,
    },
  })
})

export default router
