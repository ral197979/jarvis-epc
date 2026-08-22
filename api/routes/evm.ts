/**
 * Denver Engineering — EVM API Routes (v10.3.0)
 *
 * POST   /api/v1/projects/:projectId/evm/baselines          — create baseline
 * GET    /api/v1/projects/:projectId/evm/baselines          — list baselines
 * POST   /api/v1/evm/baselines/:baselineId/wbs              — upsert WBS entries
 * GET    /api/v1/evm/baselines/:baselineId/wbs              — list WBS entries
 * POST   /api/v1/projects/:projectId/evm/actuals            — record actual cost
 * GET    /api/v1/projects/:projectId/evm/actuals            — list actuals
 * POST   /api/v1/projects/:projectId/evm/progress           — record % complete
 * GET    /api/v1/projects/:projectId/evm/metrics            — current EVM metrics
 * POST   /api/v1/projects/:projectId/evm/snapshot           — take period snapshot
 * GET    /api/v1/projects/:projectId/evm/scurve             — S-curve time series
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope, requireRecordScope } from '../authz/recordScope'
import {
  createBaseline, listBaselines,
  upsertWbsEntries, listWbsEntries,
  recordActual, listActuals,
  recordProgress,
  computeEvmMetrics, takeSnapshot, getScurveData,
} from '../services/evm/evmService'

type R = Request & AuthenticatedRequest & TenantRequest
const qs = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v
const p  = (req: Request, key: string) =>
  qs((req.params as Record<string, string | string[]>)[key]) ?? ''

export const evmRouter = Router()
evmRouter.use(requireAuth   as never)
evmRouter.use(requireTenant() as never)

// ─── Baselines ────────────────────────────────────────────────────────────────

evmRouter.post('/projects/:projectId/evm/baselines', requireCapability('cost.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const baseline = await createBaseline(r.tenantId!, {
      projectId:  p(req, 'projectId'),
      ...req.body,
    })
    res.status(201).json({ baseline })
  } catch (e) {
    res.status(500).json({ error: 'Failed to create baseline' })
  }
})

evmRouter.get('/projects/:projectId/evm/baselines', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const baselines = await listBaselines(r.tenantId!, p(req, 'projectId'))
    res.json({ baselines })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list baselines' })
  }
})

// ─── WBS entries ──────────────────────────────────────────────────────────────

evmRouter.post('/evm/baselines/:baselineId/wbs', requireCapability('cost.write') as never, requireRecordScope('evm_baselines', 'baselineId') as never, async (req: Request, res: Response) => {
  const r = req as R
  const { projectId, entries } = req.body as { projectId: string; entries: unknown[] }
  if (!projectId || !Array.isArray(entries)) {
    res.status(400).json({ error: 'projectId and entries[] required' }); return
  }
  try {
    const wbs = await upsertWbsEntries(r.tenantId!, p(req, 'baselineId'), projectId, entries as never)
    res.status(201).json({ wbs })
  } catch (e) {
    res.status(500).json({ error: 'Failed to upsert WBS entries' })
  }
})

evmRouter.get('/evm/baselines/:baselineId/wbs', requireCapability('cost.view') as never, requireRecordScope('evm_baselines', 'baselineId') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const wbs = await listWbsEntries(r.tenantId!, p(req, 'baselineId'))
    res.json({ wbs })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list WBS entries' })
  }
})

// ─── Actuals ──────────────────────────────────────────────────────────────────

evmRouter.post('/projects/:projectId/evm/actuals', requireCapability('cost.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const actual = await recordActual(r.tenantId!, {
      projectId: p(req, 'projectId'),
      recordedBy: r.auth?.sub,
      ...req.body,
    })
    res.status(201).json({ actual })
  } catch (e) {
    res.status(500).json({ error: 'Failed to record actual' })
  }
})

evmRouter.get('/projects/:projectId/evm/actuals', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const actuals = await listActuals(r.tenantId!, p(req, 'projectId'))
    res.json({ actuals })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list actuals' })
  }
})

// ─── Progress ─────────────────────────────────────────────────────────────────

evmRouter.post('/projects/:projectId/evm/progress', requireCapability('cost.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const progress = await recordProgress(r.tenantId!, {
      projectId: p(req, 'projectId'),
      recordedBy: r.auth?.sub,
      ...req.body,
    })
    res.status(201).json({ progress })
  } catch (e) {
    res.status(500).json({ error: 'Failed to record progress' })
  }
})

// ─── Metrics + S-curve ────────────────────────────────────────────────────────

evmRouter.get('/projects/:projectId/evm/metrics', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const statusDate = qs(req.query['status_date'] as string | undefined)
    const metrics = await computeEvmMetrics(r.tenantId!, p(req, 'projectId'), statusDate)
    if (!metrics) { res.status(404).json({ error: 'No active EVM baseline for this project' }); return }
    res.json({ metrics })
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute EVM metrics' })
  }
})

evmRouter.post('/projects/:projectId/evm/snapshot', requireCapability('cost.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const statusDate = req.body.status_date as string | undefined
    const metrics = await takeSnapshot(r.tenantId!, p(req, 'projectId'), statusDate)
    if (!metrics) { res.status(404).json({ error: 'No active EVM baseline for this project' }); return }
    res.status(201).json({ metrics })
  } catch (e) {
    res.status(500).json({ error: 'Failed to take snapshot' })
  }
})

evmRouter.get('/projects/:projectId/evm/scurve', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const data = await getScurveData(r.tenantId!, p(req, 'projectId'))
    res.json({ scurve: data })
  } catch (e) {
    res.status(500).json({ error: 'Failed to get S-curve data' })
  }
})
