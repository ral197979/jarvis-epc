/**
 * Denver Engineering — Proposals API Routes (v10.12.0)
 *
 * GET    /api/v1/proposals/summary
 * POST   /api/v1/proposals
 * GET    /api/v1/proposals
 * GET    /api/v1/proposals/:id
 * PATCH  /api/v1/proposals/:id
 * POST   /api/v1/proposals/:id/submit
 * POST   /api/v1/proposals/:id/won
 * POST   /api/v1/proposals/:id/lost
 * POST   /api/v1/proposals/:id/no-bid
 * GET    /api/v1/proposals/:id/items
 * POST   /api/v1/proposals/:id/items
 * PATCH  /api/v1/proposals/:id/items/:itemId
 * DELETE /api/v1/proposals/:id/items/:itemId
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import {
  createProposal, listProposals, getProposal, updateProposal,
  submitProposal, markWon, markLost, markNoBid, getPipelineSummary,
  listProposalItems, addProposalItem, updateProposalItem, deleteProposalItem,
  type ProposalStatus,
} from '../services/proposals/proposalService'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}
const q = (req: Request, key: string) => {
  const v = (req.query as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : v
}

export const proposalsRouter = Router()
proposalsRouter.use(requireAuth     as never)
proposalsRouter.use(requireTenant() as never)

// ─── Summary ──────────────────────────────────────────────────────────────────

proposalsRouter.get('/proposals/summary', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const summary = await getPipelineSummary(r.tenantId!)
    res.json({ summary })
  } catch (e) { res.status(500).json({ error: 'Failed to load pipeline summary' }) }
})

// ─── Collection ───────────────────────────────────────────────────────────────

proposalsRouter.post('/proposals', async (req: Request, res: Response) => {
  const r = req as R
  const { title, clientName } = req.body as Record<string, unknown>
  if (!title || !clientName) { res.status(400).json({ error: 'title and clientName are required' }); return }
  try {
    const proposal = await createProposal(r.tenantId!, { createdBy: r.auth?.sub, ...req.body })
    res.status(201).json({ proposal })
  } catch (e) { res.status(500).json({ error: 'Failed to create proposal' }) }
})

proposalsRouter.get('/proposals', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const proposals = await listProposals(r.tenantId!, {
      status: q(req, 'status') as ProposalStatus | undefined,
      limit:  q(req, 'limit')  ? Number(q(req, 'limit')) : undefined,
    })
    res.json({ proposals })
  } catch (e) { res.status(500).json({ error: 'Failed to list proposals' }) }
})

// ─── Single proposal ──────────────────────────────────────────────────────────

proposalsRouter.get('/proposals/:id', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const proposal = await getProposal(r.tenantId!, p(req, 'id'))
    if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return }
    res.json({ proposal })
  } catch (e) { res.status(500).json({ error: 'Failed to get proposal' }) }
})

proposalsRouter.patch('/proposals/:id', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const proposal = await updateProposal(r.tenantId!, p(req, 'id'), req.body)
    if (!proposal) { res.status(404).json({ error: 'Proposal not found or not editable' }); return }
    res.json({ proposal })
  } catch (e) { res.status(500).json({ error: 'Failed to update proposal' }) }
})

// ─── Status transitions ───────────────────────────────────────────────────────

proposalsRouter.post('/proposals/:id/submit', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const proposal = await submitProposal(r.tenantId!, p(req, 'id'))
    if (!proposal) { res.status(404).json({ error: 'Proposal not found or not in draft' }); return }
    res.json({ proposal })
  } catch (e) { res.status(500).json({ error: 'Failed to submit proposal' }) }
})

proposalsRouter.post('/proposals/:id/won', requireCapability('crm.approve') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const proposal = await markWon(r.tenantId!, p(req, 'id'))
    if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return }
    res.json({ proposal })
  } catch (e) { res.status(500).json({ error: 'Failed to mark proposal won' }) }
})

proposalsRouter.post('/proposals/:id/lost', requireCapability('crm.approve') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const proposal = await markLost(r.tenantId!, p(req, 'id'))
    if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return }
    res.json({ proposal })
  } catch (e) { res.status(500).json({ error: 'Failed to mark proposal lost' }) }
})

proposalsRouter.post('/proposals/:id/no-bid', requireCapability('crm.approve') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const proposal = await markNoBid(r.tenantId!, p(req, 'id'))
    if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return }
    res.json({ proposal })
  } catch (e) { res.status(500).json({ error: 'Failed to mark proposal no-bid' }) }
})

// ─── Items ────────────────────────────────────────────────────────────────────

proposalsRouter.get('/proposals/:id/items', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const items = await listProposalItems(r.tenantId!, p(req, 'id'))
    res.json({ items })
  } catch (e) { res.status(500).json({ error: 'Failed to list proposal items' }) }
})

proposalsRouter.post('/proposals/:id/items', async (req: Request, res: Response) => {
  const r = req as R
  const { description, unitCost } = req.body as Record<string, unknown>
  if (!description || unitCost === undefined) { res.status(400).json({ error: 'description and unitCost are required' }); return }
  try {
    const item = await addProposalItem(r.tenantId!, p(req, 'id'), req.body)
    res.status(201).json({ item })
  } catch (e) { res.status(500).json({ error: 'Failed to add proposal item' }) }
})

proposalsRouter.patch('/proposals/:id/items/:itemId', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const item = await updateProposalItem(r.tenantId!, p(req, 'itemId'), req.body)
    if (!item) { res.status(404).json({ error: 'Item not found' }); return }
    res.json({ item })
  } catch (e) { res.status(500).json({ error: 'Failed to update proposal item' }) }
})

proposalsRouter.delete('/proposals/:id/items/:itemId', async (req: Request, res: Response) => {
  const r = req as R
  try {
    await deleteProposalItem(r.tenantId!, p(req, 'itemId'))
    res.status(204).end()
  } catch (e) { res.status(500).json({ error: 'Failed to delete proposal item' }) }
})
