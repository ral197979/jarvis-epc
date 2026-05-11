/**
 * Denver Engineering — Transmittal Routes (v10.1.0)
 * ───────────────────────────────────────────────────
 * Document transmittal workflow (Aconex/Procore parity).
 *
 * Endpoints:
 *   POST  /api/v1/transmittals              — create transmittal (with items)
 *   GET   /api/v1/transmittals              — list (filter: project, status, overdue)
 *   GET   /api/v1/transmittals/:id          — transmittal + items + event log
 *   POST  /api/v1/transmittals/:id/send     — send (draft → sent)
 *   POST  /api/v1/transmittals/:id/respond  — record response
 *   POST  /api/v1/transmittals/:id/close    — close
 *   GET   /api/v1/transmittals/overdue      — overdue response list
 */
import { Router, type Request, type Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import {
  createTransmittal,
  sendTransmittal,
  recordResponse,
  listTransmittals,
  getTransmittal,
  getOverdueTransmittals,
} from '../services/transmittals/transmittalService'
import { tenantQuery } from '../db/pool'

type R = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

const tid = (req: Request) => (req as R).tenantId!
const sub = (req: Request) => (req as R).auth?.sub ?? 'system'
const qs  = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v
const p   = (req: Request, key: string) =>
  qs((req.params as Record<string, string | string[]>)[key]) ?? ''

// GET /transmittals/overdue — must precede /:id
router.get('/overdue', async (req: Request, res: Response) => {
  try {
    const rows = await getOverdueTransmittals(tid(req))
    res.json({ data: rows })
  } catch (e) {
    res.status(500).json({ error: 'Failed to get overdue transmittals' })
  }
})

// POST /transmittals
router.post('/', async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>
  if (!b['subject'] || !b['purpose'] || !b['from_party'] || !b['to_party'] ||
      !Array.isArray(b['to_contacts']) || !Array.isArray(b['items'])) {
    res.status(400).json({ error: 'subject, purpose, from_party, to_party, to_contacts[], items[] required' })
    return
  }
  try {
    const result = await createTransmittal(tid(req), b as never, sub(req))
    res.status(201).json({ data: result })
  } catch (e) {
    console.error('[transmittals] create error', e)
    res.status(500).json({ error: 'Failed to create transmittal' })
  }
})

// GET /transmittals
router.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await listTransmittals(tid(req), {
      project_id: qs(req.query['project_id'] as string | string[]),
      status:     qs(req.query['status'] as string | string[]),
      purpose:    qs(req.query['purpose'] as string | string[]),
      overdue:    req.query['overdue'] === 'true',
    })
    res.json({ data: rows })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list transmittals' })
  }
})

// GET /transmittals/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await getTransmittal(tid(req), p(req, 'id'))
    if (!result) { res.status(404).json({ error: 'Transmittal not found' }); return }
    res.json({ data: result })
  } catch (e) {
    res.status(500).json({ error: 'Failed to get transmittal' })
  }
})

// POST /transmittals/:id/send
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    await sendTransmittal(tid(req), p(req, 'id'), sub(req))
    res.json({ data: { sent: true } })
  } catch (e) {
    res.status(500).json({ error: 'Failed to send transmittal' })
  }
})

// POST /transmittals/:id/respond
router.post('/:id/respond', async (req: Request, res: Response) => {
  const { response, notes } = req.body as { response?: string; notes?: string }
  const valid = ['approved','approved_with_comments','revise_and_resubmit','rejected','received','no_exception_taken']
  if (!response || !valid.includes(response)) {
    res.status(400).json({ error: `response must be one of: ${valid.join(', ')}` }); return
  }
  try {
    await recordResponse(tid(req), p(req, 'id'), response as never, notes ?? null, sub(req))
    res.json({ data: { recorded: true } })
  } catch (e) {
    res.status(500).json({ error: 'Failed to record response' })
  }
})

// POST /transmittals/:id/close
router.post('/:id/close', async (req: Request, res: Response) => {
  try {
    await tenantQuery(tid(req),
      `UPDATE transmittals SET status='closed', updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND status NOT IN ('voided','closed')`,
      [p(req, 'id'), tid(req)])
    await tenantQuery(tid(req),
      `INSERT INTO transmittal_events (tenant_id, transmittal_id, event_type, to_status, actor)
       VALUES ($1,$2,'closed','closed',$3)`,
      [tid(req), p(req, 'id'), sub(req)])
    res.json({ data: { closed: true } })
  } catch (e) {
    res.status(500).json({ error: 'Failed to close transmittal' })
  }
})

export { router as transmittalsRouter }
