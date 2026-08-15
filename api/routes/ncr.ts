/**
 * Denver Engineering — NCR / CAPA API (v4.55.0)
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET   /api/v1/projects/:projectId/ncrs
 *   POST  /api/v1/projects/:projectId/ncrs
 *   PATCH /api/v1/ncrs/:id                       (status / disposition / root_cause)
 *   POST  /api/v1/ncrs/:id/close                  (canonical closure — quality.verify)
 *   GET   /api/v1/ncrs/:id/capas
 *   POST  /api/v1/ncrs/:id/capas
 *   PATCH /api/v1/capas/:id                       (status)
 *   POST  /api/v1/capas/:id/verify                (canonical verification — quality.verify)
 *   GET   /api/v1/projects/:projectId/ncr-summary
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import {
  listNcrs, createNcr, updateNcr, closeNcr, listCorrectiveActions, createCorrectiveAction,
  updateCorrectiveActionStatus, verifyCorrectiveAction, buildNcrSummary, autoRaiseNcrsFromInspections,
} from '../services/quality/ncrService'

import { requireCapability } from '../authz/requireCapability'
import { guardTransitionOwnedState } from '../authz/transitionStates'
type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

const NCR_STATUS = new Set(['open', 'investigating', 'corrective_action', 'verification', 'closed'])
const DISPOSITION = new Set(['pending', 'use_as_is', 'rework', 'repair', 'reject', 'return'])
const CAPA_STATUS = new Set(['open', 'in_progress', 'completed', 'verified'])

router.get('/projects/:projectId/ncrs', requireCapability('quality.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try { res.json({ data: await listNcrs(r.tenantId!, String(req.params.projectId)) }) }
  catch (err) { res.status(500).json({ error: 'Failed to list NCRs', detail: (err as Error).message }) }
})

router.post('/projects/:projectId/ncrs', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { title?: string }
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'title is required' })
  try {
    const row = await createNcr(r.tenantId!, String(req.params.projectId), req.body, r.auth?.sub ?? null)
    res.status(201).json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to create NCR', detail: (err as Error).message }) }
})

router.patch('/ncrs/:id', guardTransitionOwnedState('ncrs') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { status?: string; disposition?: string; root_cause?: string }
  if (b.status && !NCR_STATUS.has(b.status)) return res.status(400).json({ error: 'invalid status' })
  if (b.disposition && !DISPOSITION.has(b.disposition)) return res.status(400).json({ error: 'invalid disposition' })
  if (!b.status && !b.disposition && b.root_cause == null) return res.status(400).json({ error: 'nothing to update' })
  try {
    const row = await updateNcr(r.tenantId!, String(req.params.id), b)
    if (!row) return res.status(404).json({ error: 'NCR not found' })
    res.json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to update NCR', detail: (err as Error).message }) }
})

router.post('/ncrs/:id/close', requireCapability('quality.verify') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const row = await closeNcr(r.tenantId!, String(req.params.id))
    if (!row) return res.status(404).json({ error: 'NCR not found or already closed' })
    res.json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to close NCR', detail: (err as Error).message }) }
})

router.get('/ncrs/:id/capas', requireCapability('quality.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try { res.json({ data: await listCorrectiveActions(r.tenantId!, String(req.params.id)) }) }
  catch (err) { res.status(500).json({ error: 'Failed to list corrective actions', detail: (err as Error).message }) }
})

router.post('/ncrs/:id/capas', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body as { description?: string }
  if (!b.description || !String(b.description).trim()) return res.status(400).json({ error: 'description is required' })
  try {
    const row = await createCorrectiveAction(r.tenantId!, String(req.params.id), req.body)
    if (!row) return res.status(404).json({ error: 'NCR not found' })
    res.status(201).json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to create corrective action', detail: (err as Error).message }) }
})

router.patch('/capas/:id', guardTransitionOwnedState('corrective_actions') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const status = (req.body as { status?: string }).status
  if (!status || !CAPA_STATUS.has(status)) return res.status(400).json({ error: `status must be one of ${[...CAPA_STATUS].join(', ')}` })
  try {
    const row = await updateCorrectiveActionStatus(r.tenantId!, String(req.params.id), status)
    if (!row) return res.status(404).json({ error: 'Corrective action not found' })
    res.json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to update corrective action', detail: (err as Error).message }) }
})

router.post('/capas/:id/verify', requireCapability('quality.verify') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const row = await verifyCorrectiveAction(r.tenantId!, String(req.params.id))
    if (!row) return res.status(404).json({ error: 'Corrective action not found or already verified' })
    res.json({ data: row })
  } catch (err) { res.status(500).json({ error: 'Failed to verify corrective action', detail: (err as Error).message }) }
})

router.post('/projects/:projectId/ncrs/auto-raise', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await autoRaiseNcrsFromInspections(r.tenantId!, String(req.params.projectId), r.auth?.sub ?? null)
    res.status(result.count > 0 ? 201 : 200).json({ data: result })
  } catch (err) { res.status(500).json({ error: 'Failed to auto-raise NCRs', detail: (err as Error).message }) }
})

router.get('/projects/:projectId/ncr-summary', requireCapability('quality.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await buildNcrSummary(r.tenantId!, String(req.params.projectId), new Date())
    if (!result) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: result })
  } catch (err) { res.status(500).json({ error: 'Failed to build NCR summary', detail: (err as Error).message }) }
})

export const ncrRouter = router
