/**
 * Denver Engineering — Simulation Routes (v4.40.0)
 * ──────────────────────────────────────────────────
 * Ava Phase 4 — Operational replay and what-if simulation endpoints.
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { TenantRequest } from '../middleware/tenant'
import { createSimulationSession, runReplay, runWhatIf, getSimulationResults } from '../services/simulation/replayEngine'
import { tenantQuery } from '../db/pool'
import { log } from '../lib/logger'

export const simulationRouter = Router()
const auth = requireAuth as never
type SimReq = Request & AuthenticatedRequest & TenantRequest

simulationRouter.use(auth)

// ─── Replay historical events ─────────────────────────────────────────────────
simulationRouter.post('/replay', async (req: Request, res: Response) => {
  const r = req as SimReq
  const { replay_from, replay_to, project_id, limit = 500 } = req.body
  const sessionId = await createSimulationSession(r.tenantId, r.auth.sub, {
    type: 'replay', replayFrom: replay_from, replayTo: replay_to,
    projectId: project_id, limit,
  })
  // Run async; return session ID immediately
  runReplay(sessionId, r.tenantId).catch(err => log.warn({ err, sessionId }, 'Replay session failed'))
  res.status(202).json({ data: { session_id: sessionId, status: 'running' } })
})

// ─── What-if scenario ─────────────────────────────────────────────────────────
simulationRouter.post('/what-if', async (req: Request, res: Response) => {
  const r = req as SimReq
  const { replay_from, replay_to, synthetic_events = [], limit = 500 } = req.body
  if (!Array.isArray(synthetic_events)) {
    res.status(400).json({ error: 'synthetic_events must be an array' }); return
  }
  const result = await runWhatIf(r.tenantId, r.auth.sub, {
    type: 'what_if', replayFrom: replay_from, replayTo: replay_to,
    syntheticEvents: synthetic_events, limit,
  })
  res.json({ data: result })
})

// ─── Get simulation results ───────────────────────────────────────────────────
simulationRouter.get('/:id/results', async (req: Request, res: Response) => {
  const r = req as SimReq
  const result = await getSimulationResults(r.tenantId, req.params['id']!)
  if (!result) { res.status(404).json({ error: 'Simulation not found' }); return }
  res.json({ data: result })
})

// ─── List sessions ────────────────────────────────────────────────────────────
simulationRouter.get('/', async (req: Request, res: Response) => {
  const r = req as SimReq
  const { rows } = await tenantQuery(r.tenantId, `
    SELECT id, simulation_type, status, events_replayed, replay_checksum,
           projected_readiness, created_at, completed_at
    FROM simulation_sessions
    WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50
  `, [r.tenantId])
  res.json({ data: rows })
})
