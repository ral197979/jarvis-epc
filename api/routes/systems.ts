/**
 * Denver Engineering — Systems / Subsystems / Tags API (v4.32.0)
 * ──────────────────────────────────────────────────────────────────────────────
 * Closes audit F05 — real EPC hierarchy (project → system → subsystem → tag).
 *
 * Mount at '/api/v1' in server.ts (paths own their full URL, matching the
 * drawings/bim/budgets convention).
 *
 * Endpoints:
 *   GET    /api/v1/projects/:projectId/systems
 *   POST   /api/v1/projects/:projectId/systems
 *   POST   /api/v1/systems/:systemId/subsystems
 *   GET    /api/v1/projects/:projectId/tags
 *   POST   /api/v1/systems/:systemId/tags
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import {
  listSystems, createSystem, updateSystem,
  createSubsystem, updateSubsystem,
  listTagsForProject, createTag, updateTag,
  NotFoundError, ValidationError,
} from '../services/epcCore'
// getTagPackCoverage reads test_packs (execution) — sourced from cxExecution.
import { getTagPackCoverage } from '../services/cxExecution'

import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope } from '../authz/recordScope'
type Req = Request & AuthenticatedRequest & TenantRequest

export const systemsRouter = Router()
systemsRouter.use(requireAuth   as never)
systemsRouter.use(requireTenant() as never)

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
  console.error(`[systems] ${where} error`, err)
  res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' })
}

// ─── SYSTEMS ──────────────────────────────────────────────────────────────────

systemsRouter.get('/projects/:projectId/systems', requireCapability('commissioning.view') as never, async (req: Request, res: Response) => {
  const r = req as Req
  try {
    const items = await listSystems({ tenantId: r.tenantId!, projectId: String(req.params['projectId']) })
    res.json({ items })
  } catch (err) { _handleErr(err, res, 'listSystems') }
})

systemsRouter.post('/projects/:projectId/systems', requireCapability('commissioning.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  if (!b.code || !b.name) {
    res.status(400).json({ error: 'validation', message: 'code and name are required' })
    return
  }
  try {
    const item = await createSystem(
      { tenantId: r.tenantId!, projectId: String(req.params['projectId']), userId: r.auth?.sub ?? null },
      {
        code:        String(b.code),
        name:        String(b.name),
        description: b.description ?? null,
        status:      b.status,
      },
    )
    res.status(201).json({ item })
  } catch (err) { _handleErr(err, res, 'createSystem') }
})

systemsRouter.patch('/systems/:systemId', requireCapability('commissioning.write') as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  try {
    const item = await updateSystem(
      { tenantId: r.tenantId!, userId: r.auth?.sub ?? null },
      String(req.params['systemId']),
      { code: b.code, name: b.name, description: b.description, status: b.status },
    )
    res.json({ item })
  } catch (err) { _handleErr(err, res, 'updateSystem') }
})

// ─── SUBSYSTEMS ───────────────────────────────────────────────────────────────

// POST body must include projectId so the service can verify system-in-project scope.
systemsRouter.post('/systems/:systemId/subsystems', requireCapability('commissioning.write') as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  if (!b.projectId || !b.code || !b.name) {
    res.status(400).json({ error: 'validation', message: 'projectId, code, and name are required' })
    return
  }
  try {
    const item = await createSubsystem(
      { tenantId: r.tenantId!, projectId: String(b.projectId), userId: r.auth?.sub ?? null },
      String(req.params['systemId']),
      {
        code:        String(b.code),
        name:        String(b.name),
        description: b.description ?? null,
        status:      b.status,
      },
    )
    res.status(201).json({ item })
  } catch (err) { _handleErr(err, res, 'createSubsystem') }
})

systemsRouter.patch('/subsystems/:subsystemId', requireCapability('commissioning.write') as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  try {
    const item = await updateSubsystem(
      { tenantId: r.tenantId!, userId: r.auth?.sub ?? null },
      String(req.params['subsystemId']),
      { code: b.code, name: b.name, description: b.description, status: b.status },
    )
    res.json({ item })
  } catch (err) { _handleErr(err, res, 'updateSubsystem') }
})

// ─── TAGS ─────────────────────────────────────────────────────────────────────

systemsRouter.get('/projects/:projectId/tags', requireCapability('commissioning.view') as never, async (req: Request, res: Response) => {
  const r = req as Req
  try {
    const items = await listTagsForProject({ tenantId: r.tenantId!, projectId: String(req.params['projectId']) })
    res.json({ items })
  } catch (err) { _handleErr(err, res, 'listTags') }
})

systemsRouter.post('/systems/:systemId/tags', requireCapability('commissioning.write') as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  if (!b.projectId || !b.tagNo || !b.equipmentName) {
    res.status(400).json({ error: 'validation', message: 'projectId, tagNo, and equipmentName are required' })
    return
  }
  try {
    const item = await createTag(
      { tenantId: r.tenantId!, projectId: String(b.projectId), userId: r.auth?.sub ?? null },
      String(req.params['systemId']),
      {
        tagNo:         String(b.tagNo),
        equipmentName: String(b.equipmentName),
        equipmentType: b.equipmentType ?? null,
        subsystemId:   b.subsystemId ?? null,
        location:      b.location ?? null,
        manufacturer:  b.manufacturer ?? null,
        modelNo:       b.modelNo ?? null,
        serialNo:      b.serialNo ?? null,
        status:        b.status,
      },
    )
    res.status(201).json({ item })
  } catch (err) { _handleErr(err, res, 'createTag') }
})

systemsRouter.patch('/tags/:tagId', requireCapability('commissioning.write') as never, async (req: Request, res: Response) => {
  const r = req as Req
  const b = req.body ?? {}
  try {
    const item = await updateTag(
      { tenantId: r.tenantId!, userId: r.auth?.sub ?? null },
      String(req.params['tagId']),
      {
        equipmentName: b.equipmentName,
        equipmentType: b.equipmentType,
        location:      b.location,
        manufacturer:  b.manufacturer,
        modelNo:       b.modelNo,
        serialNo:      b.serialNo,
        status:        b.status,
      },
    )
    res.json({ item })
  } catch (err) { _handleErr(err, res, 'updateTag') }
})

// ─── F05: tag/pack coverage ───────────────────────────────────────────────────
systemsRouter.get('/projects/:projectId/coverage', requireCapability('commissioning.view') as never, async (req: Request, res: Response) => {
  const r = req as Req
  try {
    const limit  = Math.min(Math.max(parseInt(String(req.query['limit']  ?? '100'), 10) || 100, 1), 500)
    const offset = Math.max(parseInt(String(req.query['offset'] ?? '0'),   10) || 0, 0)
    const report = await getTagPackCoverage({
      tenantId:  r.tenantId!,
      projectId: String(req.params['projectId']),
      limit,
      offset,
    })
    res.json(report)
  } catch (err) { _handleErr(err, res, 'getTagPackCoverage') }
})

export default systemsRouter
