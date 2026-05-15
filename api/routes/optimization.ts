// Denver Engineering — Optimization Routes (v7.0.0)
// Resource optimization, strategy planning, consensus decisions.

import { Router, Request, Response } from 'express'
import {
  analyzeResourceUtilization, buildWorkloadBalancePlan,
  proposeOptimization, approveOptimization,
  markOptimizationApplied, listOptimizationProposals,
} from '../services/adaptive/resourceOptimizationEngine'
import {
  generateStrategyPlan,
} from '../services/adaptive/operationalStrategyPlanner'
import {
  buildConsensus, coordinateRecommendations,
  getOptimizationSummary,
} from '../services/adaptive/optimizationCoordinator'
import {
  synthesizeRootCause,
} from '../services/adaptive/rootCauseSynthesisEngine'

const router = Router()
const tid = (req: Request): string => (req as unknown as { tenantId: string }).tenantId

// ─── Resource analysis ────────────────────────────────────────────────────────

router.get('/resources', async (req: Request, res: Response) => {
  try {
    const allocations = await analyzeResourceUtilization(tid(req))
    res.json(allocations)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/resources/balance-plan', async (req: Request, res: Response) => {
  try {
    const plan = await buildWorkloadBalancePlan(tid(req))
    res.json(plan)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ─── Optimization proposals ───────────────────────────────────────────────────

router.post('/proposals', async (req: Request, res: Response) => {
  try {
    const proposal = await proposeOptimization(tid(req), req.body)
    res.status(201).json(proposal)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/proposals', async (req: Request, res: Response) => {
  try {
    const { status, optimizationType, limit } = req.query as Record<string, string>
    const proposals = await listOptimizationProposals(tid(req), {
      status,
      optimizationType,
      limit: limit != null ? Number(limit) : undefined,
    })
    res.json(proposals)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.post('/proposals/:id/approve', async (req: Request, res: Response) => {
  try {
    const { approvedBy } = req.body
    const proposal = await approveOptimization(tid(req), req.params.id as string, approvedBy)
    res.json(proposal)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.post('/proposals/:id/apply', async (req: Request, res: Response) => {
  try {
    const { actualGain } = req.body
    const proposal = await markOptimizationApplied(tid(req), req.params.id as string, actualGain)
    res.json(proposal)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.get('/proposals/summary', async (req: Request, res: Response) => {
  try {
    const summary = await getOptimizationSummary(tid(req))
    res.json(summary)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ─── Strategy planning ────────────────────────────────────────────────────────

router.post('/strategy', async (req: Request, res: Response) => {
  try {
    const { horizon, objectives } = req.body ?? {}
    const plan = await generateStrategyPlan(tid(req), { horizon, objectives })
    res.json(plan)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ─── Multi-agent consensus ────────────────────────────────────────────────────

router.post('/consensus', async (req: Request, res: Response) => {
  try {
    const { topic, votes } = req.body
    const result = await buildConsensus(tid(req), topic, votes)
    res.json(result)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.post('/coordinate', async (req: Request, res: Response) => {
  try {
    const { inputs } = req.body
    const result = await coordinateRecommendations(tid(req), inputs)
    res.json(result)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ─── Root cause synthesis ─────────────────────────────────────────────────────

router.post('/root-cause', async (req: Request, res: Response) => {
  try {
    const { entityId, entityType, windowHours, anomalyIds } = req.body ?? {}
    const report = await synthesizeRootCause(tid(req), { entityId, entityType, windowHours, anomalyIds })
    res.json(report)
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

export default router
