/**
 * Denver Engineering — Cost Entry API Routes (v10.11.0)
 *
 * POST  /api/v1/projects/:projectId/cost-entries        — create
 * GET   /api/v1/projects/:projectId/cost-entries        — list
 * GET   /api/v1/projects/:projectId/cost-entries/summary
 * GET   /api/v1/cost-entries/:id                        — detail
 * PATCH /api/v1/cost-entries/:id                        — update (draft only)
 * DELETE /api/v1/cost-entries/:id                       — delete (draft only)
 * POST  /api/v1/cost-entries/:id/post                   — draft → posted
 * POST  /api/v1/cost-entries/:id/void                   — draft → void
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope, requireRecordScope } from '../authz/recordScope'
import {
  createCostEntry, listCostEntries, getCostEntry, updateCostEntry,
  deleteCostEntry, postCostEntry, voidCostEntry, getCostEntrySummary,
  type CostEntryType, type CostEntryStatus,
} from '../services/costEntry/costEntryService'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}
const q = (req: Request, key: string) => {
  const v = (req.query as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : v
}

export const costEntryRouter = Router()
costEntryRouter.use(requireAuth    as never)
costEntryRouter.use(requireTenant() as never)

// ─── Per-project ──────────────────────────────────────────────────────────────

costEntryRouter.post('/projects/:projectId/cost-entries', requireCapability('cost.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  const { description, amount, entryDate } = req.body as Record<string, unknown>
  if (!description || !amount || !entryDate) {
    res.status(400).json({ error: 'description, amount, and entryDate are required' }); return
  }
  try {
    const entry = await createCostEntry(r.tenantId!, {
      projectId: p(req, 'projectId'),
      createdBy: r.auth?.sub,
      ...req.body,
    })
    res.status(201).json({ entry })
  } catch (e) { res.status(500).json({ error: 'Failed to create cost entry' }) }
})

costEntryRouter.get('/projects/:projectId/cost-entries', requireCapability('cost.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const entries = await listCostEntries(r.tenantId!, p(req, 'projectId'), {
      entryType: q(req, 'type')     as CostEntryType | undefined,
      status:    q(req, 'status')   as CostEntryStatus | undefined,
      dateFrom:  q(req, 'dateFrom') as string | undefined,
      dateTo:    q(req, 'dateTo')   as string | undefined,
      limit:     q(req, 'limit') ? Number(q(req, 'limit')) : undefined,
    })
    res.json({ entries })
  } catch (e) { res.status(500).json({ error: 'Failed to list cost entries' }) }
})

costEntryRouter.get('/projects/:projectId/cost-entries/summary', requireCapability('cost.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const summary = await getCostEntrySummary(r.tenantId!, p(req, 'projectId'))
    res.json({ summary })
  } catch (e) { res.status(500).json({ error: 'Failed to load summary' }) }
})

// ─── Single entry ─────────────────────────────────────────────────────────────

costEntryRouter.get('/cost-entries/:id', requireCapability('cost.view') as never, requireRecordScope('cost_entries') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const entry = await getCostEntry(r.tenantId!, p(req, 'id'))
    if (!entry) { res.status(404).json({ error: 'Cost entry not found' }); return }
    res.json({ entry })
  } catch (e) { res.status(500).json({ error: 'Failed to get cost entry' }) }
})

costEntryRouter.patch('/cost-entries/:id', requireCapability('cost.write') as never, requireRecordScope('cost_entries') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const entry = await updateCostEntry(r.tenantId!, p(req, 'id'), req.body)
    if (!entry) { res.status(404).json({ error: 'Cost entry not found or not in draft status' }); return }
    res.json({ entry })
  } catch (e) { res.status(500).json({ error: 'Failed to update cost entry' }) }
})

costEntryRouter.delete('/cost-entries/:id', requireCapability('cost.write') as never, requireRecordScope('cost_entries') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const ok = await deleteCostEntry(r.tenantId!, p(req, 'id'))
    if (!ok) { res.status(404).json({ error: 'Cost entry not found or not in draft status' }); return }
    res.status(204).end()
  } catch (e) { res.status(500).json({ error: 'Failed to delete cost entry' }) }
})

costEntryRouter.post('/cost-entries/:id/post', requireCapability('cost.approve') as never, requireRecordScope('cost_entries') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const entry = await postCostEntry(r.tenantId!, p(req, 'id'), r.auth?.sub ?? 'unknown')
    if (!entry) { res.status(404).json({ error: 'Cost entry not found or not in draft status' }); return }
    res.json({ entry })
  } catch (e) { res.status(500).json({ error: 'Failed to post cost entry' }) }
})

costEntryRouter.post('/cost-entries/:id/void', requireCapability('cost.approve') as never, requireRecordScope('cost_entries') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const entry = await voidCostEntry(r.tenantId!, p(req, 'id'))
    if (!entry) { res.status(404).json({ error: 'Cost entry not found or not in draft status' }); return }
    res.json({ entry })
  } catch (e) { res.status(500).json({ error: 'Failed to void cost entry' }) }
})
