/**
 * Denver Engineering — Test Packs API (v4.32.0)
 * ──────────────────────────────────────────────────────────────────────────────
 * Closes audit F05 — packs MUST reference a real project + system.
 * Distinct from `commissioning_packs` (the existing generated-deliverable
 * workflow, unchanged by this pass).
 *
 * Mount at '/api/v1' in server.ts.
 *
 * Endpoints:
 *   GET    /api/v1/projects/:projectId/test-packs
 *   POST   /api/v1/test-packs
 *   GET    /api/v1/test-packs/:packId
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import {
  listTestPacksByProject, createTestPack, getTestPack, updateTestPack,
  NotFoundError, ValidationError,
} from '../services/cxExecution'

import { requireCapability } from '../authz/requireCapability'
import { requireRecordScope } from '../authz/recordScope'
type Req = Request & AuthenticatedRequest & TenantRequest

export const testPacksRouter = Router()
testPacksRouter.use(requireAuth   as never)
testPacksRouter.use(requireTenant() as never)

function _handleErr(err: unknown, res: Response, where: string): void {
  if (err instanceof ValidationError) {
    res.status(err.status).json({ error: 'validation', message: err.message })
    return
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: 'not_found', message: err.message })
    return
  }
  const msg = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string })?.code
  if (code === '23505') {
    res.status(409).json({ error: 'duplicate', message: msg })
    return
  }
  console.error(`[testPacks] ${where} error`, err)
  res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' })
}

testPacksRouter.get('/projects/:projectId/test-packs', requireCapability('commissioning.view') as never, async (req: Request, res: Response) => {
  const r = req as Req
  try {
    const items = await listTestPacksByProject({ tenantId: r.tenantId!, projectId: String(req.params['projectId']) })
    res.json({ items })
  } catch (err) { _handleErr(err, res, 'list') }
})

testPacksRouter.post('/test-packs', requireCapability('commissioning.write') as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  // F05 hard rule — minimum required fields for real scope.
  if (!b.projectId || !b.systemId || !b.packNo || !b.title || !b.packType) {
    res.status(400).json({
      error:   'validation',
      message: 'projectId, systemId, packNo, title, and packType are required — title-only synthetic packs are forbidden',
    })
    return
  }
  try {
    const item = await createTestPack(
      { tenantId: r.tenantId!, userId: r.auth?.sub ?? null },
      {
        projectId:           String(b.projectId),
        systemId:            String(b.systemId),
        subsystemId:         b.subsystemId ?? null,
        tagId:               b.tagId ?? null,
        commissioningItemId: b.commissioningItemId ?? null,
        packNo:              String(b.packNo),
        title:               String(b.title),
        revision:            b.revision ?? 'A',
        packType:            String(b.packType),
        generatedFrom:       b.generatedFrom ?? 'manual',
      },
    )
    res.status(201).json({ item })
  } catch (err) { _handleErr(err, res, 'create') }
})

testPacksRouter.get('/test-packs/:packId', requireCapability('commissioning.view') as never, async (req: Request, res: Response) => {
  const r = req as Req
  try {
    const item = await getTestPack({ tenantId: r.tenantId! }, String(req.params['packId']))
    res.json({ item })
  } catch (err) { _handleErr(err, res, 'get') }
})

testPacksRouter.patch('/test-packs/:packId', requireCapability('commissioning.write') as never, requireRecordScope('test_packs', 'packId') as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  try {
    const item = await updateTestPack(
      { tenantId: r.tenantId!, userId: r.auth?.sub ?? null },
      String(req.params['packId']),
      { title: b.title, revision: b.revision, status: b.status },
    )
    res.json({ item })
  } catch (err) { _handleErr(err, res, 'update') }
})

export default testPacksRouter
