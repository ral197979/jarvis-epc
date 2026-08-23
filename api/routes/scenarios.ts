// Denver Engineering — Scenario Routes (v6.0.0)
// Scenario simulation CRUD and execution endpoints.

import { Router, Request, Response } from 'express'
import { createScenario, runScenario, getScenario, listScenarios, cancelScenario } from '../services/twin/scenarioSimulationEngine'
import { projectTwinTimeline } from '../services/twin/timelineProjectionService'
import { getStateAt, replayRange, diffStates, computeStateVelocity, getScoreTrend } from '../services/twin/temporalStateEngine'

import { requireCapability } from '../authz/requireCapability'
import { requireTwinScope } from '../authz/recordScope'
const router = Router()

// ─── Scenarios ────────────────────────────────────────────────────────────────

router.post('/', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const userId: string = (req as unknown as { userId: string }).userId ?? 'system'
    const scenario = await createScenario({ tenantId, createdBy: userId, ...req.body })
    res.status(201).json(scenario)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const { status, limit, offset } = req.query
    const scenarios = await listScenarios(
      tenantId,
      status as Parameters<typeof listScenarios>[1],
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0
    )
    res.json({ scenarios, count: scenarios.length })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:scenarioId', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const scenario = await getScenario(req.params.scenarioId as string, tenantId)
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' })
    res.json(scenario)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/:scenarioId/run', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const scenario = await runScenario(req.params.scenarioId as string, tenantId)
    res.json(scenario)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/:scenarioId/cancel', requireCapability('crossdomain.write') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    await cancelScenario(req.params.scenarioId as string, tenantId)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── Timeline projection ──────────────────────────────────────────────────────

router.get('/projection/:twinId', requireCapability('crossdomain.read') as never, requireTwinScope() as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const horizonDays = req.query.horizonDays ? Number(req.query.horizonDays) : 30
    const projection = await projectTwinTimeline(req.params.twinId as string, tenantId, horizonDays)
    res.json(projection)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ─── Temporal queries ─────────────────────────────────────────────────────────

router.get('/temporal/:twinId/at', requireCapability('crossdomain.read') as never, requireTwinScope() as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    if (!req.query.ts) return res.status(400).json({ error: 'ts query param required' })
    const state = await getStateAt(req.params.twinId as string, tenantId, new Date(req.query.ts as string))
    if (!state) return res.status(404).json({ error: 'No state found at that time' })
    res.json({ state, at: req.query.ts })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/temporal/:twinId/replay', requireCapability('crossdomain.read') as never, requireTwinScope() as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const { from, to } = req.query
    if (!from || !to) return res.status(400).json({ error: 'from and to query params required' })
    const snapshots = await replayRange(req.params.twinId as string, tenantId, new Date(from as string), new Date(to as string))
    res.json({ snapshots, count: snapshots.length })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/temporal/:twinId/diff', requireCapability('crossdomain.read') as never, requireTwinScope() as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const { from, to } = req.query
    if (!from || !to) return res.status(400).json({ error: 'from and to query params required' })
    const diff = await diffStates(req.params.twinId as string, tenantId, new Date(from as string), new Date(to as string))
    res.json(diff)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/temporal/:twinId/velocity', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const windowDays = req.query.windowDays ? Number(req.query.windowDays) : 7
    const velocity = await computeStateVelocity(req.params.twinId as string, tenantId, windowDays)
    res.json(velocity)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/temporal/:twinId/trend/:field', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  try {
    const tenantId: string = (req as unknown as { tenantId: string }).tenantId
    const windowDays = req.query.windowDays ? Number(req.query.windowDays) : 30
    const field = req.params.field as Parameters<typeof getScoreTrend>[2]
    const trend = await getScoreTrend(req.params.twinId as string, tenantId, field, windowDays)
    res.json({ field, trend, windowDays })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router
