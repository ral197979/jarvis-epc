/**
 * Denver Engineering — Commissioning Items API (v4.32.0)
 * ──────────────────────────────────────────────────────────────────────────────
 * Pre-comm / functional / startup / turnover checklist items scoped to a
 * project → system hierarchy. Distinct from `commissioning_packs` (the AI
 * document deliverable) and from `test_packs` (structured test execution).
 *
 * Mount at '/api/v1' in server.ts.
 *
 * Endpoints:
 *   GET    /api/v1/projects/:projectId/commissioning-items
 *   POST   /api/v1/commissioning-items
 *   PATCH  /api/v1/commissioning-items/:itemId
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import {
  listCommissioningItems, createCommissioningItem, updateCommissioningItem,
  NotFoundError, ValidationError,
} from '../services/epcCore'

type Req = Request & AuthenticatedRequest & TenantRequest

export const commissioningItemsRouter = Router()
commissioningItemsRouter.use(requireAuth   as never)
commissioningItemsRouter.use(requireTenant() as never)

function _handleErr(err: unknown, res: Response, where: string): void {
  if (err instanceof ValidationError) {
    res.status(err.status).json({ error: 'validation', message: err.message })
    return
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: 'not_found', message: err.message })
    return
  }
  const msg  = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string })?.code
  if (code === '23505') {
    res.status(409).json({ error: 'duplicate', message: msg })
    return
  }
  console.error(`[commissioningItems] ${where} error`, err)
  res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' })
}

commissioningItemsRouter.get('/projects/:projectId/commissioning-items', async (req: Request, res: Response) => {
  const r = req as Req
  try {
    const items = await listCommissioningItems({
      tenantId:  r.tenantId!,
      projectId: String(req.params['projectId']),
    })
    res.json({ items })
  } catch (err) { _handleErr(err, res, 'list') }
})

commissioningItemsRouter.post('/commissioning-items', async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  if (!b.projectId || !b.systemId || !b.itemType || !b.title) {
    res.status(400).json({
      error:   'validation',
      message: 'projectId, systemId, itemType, and title are required',
    })
    return
  }
  try {
    const item = await createCommissioningItem(
      { tenantId: r.tenantId!, userId: r.auth?.sub ?? null },
      {
        projectId:         String(b.projectId),
        systemId:          String(b.systemId),
        subsystemId:       b.subsystemId       ?? null,
        tagId:             b.tagId             ?? null,
        itemType:          String(b.itemType),
        title:             String(b.title),
        description:       b.description       ?? null,
        status:            b.status,
        sourceDocumentId:  b.sourceDocumentId  ?? null,
        sourceReference:   b.sourceReference   ?? null,
      },
    )
    res.status(201).json({ item })
  } catch (err) { _handleErr(err, res, 'create') }
})

commissioningItemsRouter.patch('/commissioning-items/:itemId', async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  try {
    const item = await updateCommissioningItem(
      { tenantId: r.tenantId!, userId: r.auth?.sub ?? null },
      String(req.params['itemId']),
      {
        title:           b.title,
        description:     b.description,
        status:          b.status,
        sourceReference: b.sourceReference,
      },
    )
    res.json({ item })
  } catch (err) { _handleErr(err, res, 'update') }
})

export default commissioningItemsRouter
