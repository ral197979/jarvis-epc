/**
 * Denver Engineering — Deficiencies API (v4.32.0)
 * ──────────────────────────────────────────────────────────────────────────────
 * Test-traced deficiency (distinct from field `punch_items`).
 * Closes audit F01.
 *
 * Mount at '/api/v1' in server.ts.
 *
 * Endpoints:
 *   GET    /api/v1/projects/:projectId/deficiencies
 *   POST   /api/v1/deficiencies
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import {
  listDeficienciesByProject, createDeficiency, updateDeficiency,
  NotFoundError, ValidationError,
} from '../services/cxExecution'

import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope, requireRecordScope } from '../authz/recordScope'
type Req = Request & AuthenticatedRequest & TenantRequest

export const deficienciesRouter = Router()
deficienciesRouter.use(requireAuth   as never)
deficienciesRouter.use(requireTenant() as never)

function _handleErr(err: unknown, res: Response, where: string): void {
  if (err instanceof ValidationError) {
    res.status(err.status).json({ error: 'validation', message: err.message })
    return
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: 'not_found', message: err.message })
    return
  }
  const code = (err as { code?: string })?.code
  if (code === '23505') {
    res.status(409).json({ error: 'duplicate', message: 'code already exists for this project' })
    return
  }
  console.error(`[deficiencies] ${where} error`, err)
  res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' })
}

deficienciesRouter.get('/projects/:projectId/deficiencies', requireCapability('quality.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as Req
  try {
    const items = await listDeficienciesByProject({ tenantId: r.tenantId!, projectId: String(req.params['projectId']) })
    res.json({ items })
  } catch (err) { _handleErr(err, res, 'list') }
})

deficienciesRouter.post('/deficiencies', requireCapability('quality.write') as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  if (!b.projectId || !b.code || !b.title) {
    res.status(400).json({ error: 'validation', message: 'projectId, code, and title are required' })
    return
  }
  try {
    const item = await createDeficiency(
      { tenantId: r.tenantId!, userId: r.auth?.sub ?? null },
      {
        projectId:      String(b.projectId),
        testPackId:     b.testPackId     ?? null,
        testResultId:   b.testResultId   ?? null,
        tagId:          b.tagId          ?? null,
        code:           String(b.code),
        title:          String(b.title),
        description:    b.description    ?? null,
        severity:       b.severity,
        status:         b.status,
        assigneeUserId: b.assigneeUserId ?? null,
        dueDate:        b.dueDate        ?? null,
      },
    )
    res.status(201).json({ item })
  } catch (err) { _handleErr(err, res, 'create') }
})

deficienciesRouter.patch('/deficiencies/:deficiencyId', requireCapability('quality.write') as never, requireRecordScope('deficiencies', 'deficiencyId') as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  try {
    const item = await updateDeficiency(
      { tenantId: r.tenantId!, userId: r.auth?.sub ?? null },
      String(req.params['deficiencyId']),
      {
        title:           b.title,
        description:     b.description,
        severity:        b.severity,
        status:          b.status,
        assigneeUserId:  b.assigneeUserId,
        dueDate:         b.dueDate,
      },
    )
    res.json({ item })
  } catch (err) { _handleErr(err, res, 'update') }
})

export default deficienciesRouter
