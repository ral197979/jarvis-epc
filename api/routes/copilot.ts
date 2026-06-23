/**
 * Denver Engineering — Project Copilot API Route (v4.41.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * The AI Project Intelligence layer — turns live project state into a ranked,
 * explained "what should I focus on today?" briefing.
 *
 * Endpoints:
 *   GET /api/v1/copilot/projects/:projectId/focus   — focus briefing for one project
 *   GET /api/v1/copilot/focus                        — portfolio roll-up of top items
 *
 * Query params (both): ?limit=<n>  caps returned items (1–100, default 25/30).
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { buildProjectFocus, buildPortfolioFocus } from '../services/copilot/projectCopilotService'
import { buildProjectCoordination, buildPortfolioCoordination } from '../services/copilot/coordinationService'
import { buildProjectReport, buildPortfolioReport } from '../services/copilot/executiveReportService'
import { buildPortfolioInsights } from '../services/copilot/portfolioInsightsService'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth as never)
router.use(requireTenant() as never)

function parseLimit(raw: unknown, fallback: number): number {
  const n = parseInt(String(raw ?? ''), 10)
  if (isNaN(n)) return fallback
  return Math.max(1, Math.min(100, n))
}

router.get('/copilot/projects/:projectId/focus', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const limit = parseLimit(req.query['limit'], 25)
  try {
    const briefing = await buildProjectFocus(r.tenantId!, String(req.params.projectId), new Date(), limit)
    if (!briefing) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: briefing })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build focus briefing', detail: (err as Error).message })
  }
})

router.get('/copilot/focus', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const limit = parseLimit(req.query['limit'], 30)
  try {
    const briefing = await buildPortfolioFocus(r.tenantId!, new Date(), limit)
    res.json({ data: briefing })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build portfolio focus', detail: (err as Error).message })
  }
})

// ── Coordination Copilot: where the project is blocked / out of sync ──────────

router.get('/copilot/projects/:projectId/coordination', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const limit = parseLimit(req.query['limit'], 50)
  try {
    const briefing = await buildProjectCoordination(r.tenantId!, String(req.params.projectId), new Date(), limit)
    if (!briefing) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: briefing })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build coordination briefing', detail: (err as Error).message })
  }
})

router.get('/copilot/coordination', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const limit = parseLimit(req.query['limit'], 50)
  try {
    const briefing = await buildPortfolioCoordination(r.tenantId!, new Date(), limit)
    res.json({ data: briefing })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build portfolio coordination', detail: (err as Error).message })
  }
})

// ── Executive Copilot: deterministic board / project briefings ────────────────

router.get('/copilot/projects/:projectId/report', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const report = await buildProjectReport(r.tenantId!, String(req.params.projectId), new Date())
    if (!report) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: report })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build project report', detail: (err as Error).message })
  }
})

router.get('/copilot/report', async (_req: Request, res: Response) => {
  const r = _req as AuthTenantReq
  try {
    const report = await buildPortfolioReport(r.tenantId!, new Date())
    res.json({ data: report })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build portfolio report', detail: (err as Error).message })
  }
})

// ── Portfolio Copilot: cross-project comparison & resource conflicts ──────────

router.get('/copilot/portfolio', async (_req: Request, res: Response) => {
  const r = _req as AuthTenantReq
  try {
    const insights = await buildPortfolioInsights(r.tenantId!, new Date())
    res.json({ data: insights })
  } catch (err) {
    res.status(500).json({ error: 'Failed to build portfolio insights', detail: (err as Error).message })
  }
})

export const copilotRouter = router
