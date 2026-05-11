/**
 * Denver Engineering — Monte Carlo Risk Simulation Routes (v10.1.0)
 * ──────────────────────────────────────────────────────────────────
 * Probabilistic schedule + cost risk analysis (Oracle P6 Risk parity).
 *
 * Endpoints:
 *   POST /api/v1/monte-carlo/runs             — run simulation (sync, returns results)
 *   GET  /api/v1/monte-carlo/runs             — list runs
 *   GET  /api/v1/monte-carlo/runs/:id         — run + inputs + sensitivity
 *   GET  /api/v1/monte-carlo/runs/:id/distribution — iteration histogram data
 */
import { Router, type Request, type Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import {
  runMonteCarlo,
  listMonteCarloRuns,
  getMonteCarloRun,
  getIterationDistribution,
} from '../services/simulation/monteCarloService'

type R = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

const tid = (req: Request) => (req as R).tenantId!
const qs  = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v
const p   = (req: Request, key: string) =>
  qs((req.params as Record<string, string | string[]>)[key]) ?? ''

// POST /monte-carlo/runs
router.post('/runs', async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>
  if (!b['name'] || !Array.isArray(b['tasks']) || !(b['tasks'] as unknown[]).length) {
    res.status(400).json({ error: 'name and tasks[] required' }); return
  }
  try {
    const result = await runMonteCarlo({
      tenantId:       tid(req),
      projectId:      b['project_id'] as string | undefined,
      name:           b['name'] as string,
      description:    b['description'] as string | undefined,
      tasks:          b['tasks'] as never,
      iterationCount: b['iteration_count'] as number | undefined,
      seed:           b['seed'] as number | undefined,
    })
    res.status(201).json({ data: result })
  } catch (e) {
    console.error('[monte-carlo] run error', e)
    res.status(500).json({ error: 'Simulation failed' })
  }
})

// GET /monte-carlo/runs
router.get('/runs', async (req: Request, res: Response) => {
  const project_id = qs(req.query['project_id'] as string | string[])
  try {
    const runs = await listMonteCarloRuns(tid(req), project_id)
    res.json({ data: runs })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list runs' })
  }
})

// GET /monte-carlo/runs/:id
router.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const result = await getMonteCarloRun(tid(req), p(req, 'id'))
    if (!result) { res.status(404).json({ error: 'Run not found' }); return }
    res.json({ data: result })
  } catch (e) {
    res.status(500).json({ error: 'Failed to get run' })
  }
})

// GET /monte-carlo/runs/:id/distribution
router.get('/runs/:id/distribution', async (req: Request, res: Response) => {
  try {
    const rows = await getIterationDistribution(tid(req), p(req, 'id'))
    res.json({ data: rows })
  } catch (e) {
    res.status(500).json({ error: 'Failed to get distribution' })
  }
})

export { router as monteCarloRouter }
