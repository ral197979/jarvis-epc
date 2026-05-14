/**
 * Denver Engineering — Subcontracts API Routes (v10.8.0)
 *
 * Bid Packages:
 *   POST   /api/v1/projects/:projectId/bid-packages            — create
 *   GET    /api/v1/projects/:projectId/bid-packages            — list
 *   GET    /api/v1/projects/:projectId/bid-packages/summary    — summary stats
 *   GET    /api/v1/bid-packages/:id                            — detail
 *   POST   /api/v1/bid-packages/:id/issue                      — draft → issued
 *   POST   /api/v1/bid-packages/:id/close                      — issued → closed
 *   POST   /api/v1/bid-packages/:id/cancel                     — → cancelled
 *
 * Bid Submissions:
 *   GET    /api/v1/bid-packages/:id/submissions                — list
 *   POST   /api/v1/bid-packages/:id/submissions                — submit a bid
 *   POST   /api/v1/bid-submissions/:id/award                   — award → create subcontract
 *
 * Subcontracts:
 *   POST   /api/v1/projects/:projectId/subcontracts            — create directly
 *   GET    /api/v1/projects/:projectId/subcontracts            — list
 *   GET    /api/v1/subcontracts/:id                            — detail
 *   PATCH  /api/v1/subcontracts/:id/status                     — update status
 *
 * Invoices:
 *   POST   /api/v1/subcontracts/:id/invoices                   — create invoice
 *   GET    /api/v1/subcontracts/:id/invoices                   — list invoices
 *   POST   /api/v1/sc-invoices/:id/submit                      — draft → submitted
 *   POST   /api/v1/sc-invoices/:id/approve                     — submitted → approved
 *   POST   /api/v1/sc-invoices/:id/reject                      — submitted → rejected
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest }       from '../middleware/tenant'
import {
  createBidPackage, listBidPackages, getBidPackage,
  issueBidPackage, closeBidPackage, cancelBidPackage,
  submitBid, listBidSubmissions, awardBid,
  createSubcontract, listSubcontracts, getSubcontract, updateSubcontractStatus,
  createInvoice, listInvoices, submitInvoice, reviewInvoice,
  getSubcontractSummary,
  type ScStatus,
} from '../services/procurement/subcontractService'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}
const q = (req: Request, key: string) => {
  const v = (req.query as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : v
}

export const subcontractsRouter = Router()
subcontractsRouter.use(requireAuth    as never)
subcontractsRouter.use(requireTenant() as never)

// ─── Bid packages ─────────────────────────────────────────────────────────────

subcontractsRouter.post('/projects/:projectId/bid-packages', async (req: Request, res: Response) => {
  const r = req as R
  const { title } = req.body as Record<string, unknown>
  if (!title) { res.status(400).json({ error: 'title is required' }); return }
  try {
    const pkg = await createBidPackage(r.tenantId!, { projectId: p(req, 'projectId'), createdBy: r.auth?.sub, ...req.body })
    res.status(201).json({ bidPackage: pkg })
  } catch (e) { res.status(500).json({ error: 'Failed to create bid package' }) }
})

subcontractsRouter.get('/projects/:projectId/bid-packages', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const packages = await listBidPackages(r.tenantId!, p(req, 'projectId'), q(req, 'status') as never)
    res.json({ bidPackages: packages })
  } catch (e) { res.status(500).json({ error: 'Failed to list bid packages' }) }
})

subcontractsRouter.get('/projects/:projectId/bid-packages/summary', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const summary = await getSubcontractSummary(r.tenantId!, p(req, 'projectId'))
    res.json({ summary })
  } catch (e) { res.status(500).json({ error: 'Failed to get summary' }) }
})

subcontractsRouter.get('/bid-packages/:id', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const pkg = await getBidPackage(r.tenantId!, p(req, 'id'))
    if (!pkg) { res.status(404).json({ error: 'Bid package not found' }); return }
    res.json({ bidPackage: pkg })
  } catch (e) { res.status(500).json({ error: 'Failed to get bid package' }) }
})

subcontractsRouter.post('/bid-packages/:id/issue', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const pkg = await issueBidPackage(r.tenantId!, p(req, 'id'))
    if (!pkg) { res.status(404).json({ error: 'Bid package not found or not in draft status' }); return }
    res.json({ bidPackage: pkg })
  } catch (e) { res.status(500).json({ error: 'Failed to issue bid package' }) }
})

subcontractsRouter.post('/bid-packages/:id/close', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const pkg = await closeBidPackage(r.tenantId!, p(req, 'id'))
    if (!pkg) { res.status(404).json({ error: 'Bid package not found or not in issued status' }); return }
    res.json({ bidPackage: pkg })
  } catch (e) { res.status(500).json({ error: 'Failed to close bid package' }) }
})

subcontractsRouter.post('/bid-packages/:id/cancel', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const pkg = await cancelBidPackage(r.tenantId!, p(req, 'id'))
    if (!pkg) { res.status(404).json({ error: 'Bid package not found or cannot be cancelled' }); return }
    res.json({ bidPackage: pkg })
  } catch (e) { res.status(500).json({ error: 'Failed to cancel bid package' }) }
})

// ─── Bid submissions ──────────────────────────────────────────────────────────

subcontractsRouter.get('/bid-packages/:id/submissions', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const submissions = await listBidSubmissions(r.tenantId!, p(req, 'id'))
    res.json({ submissions })
  } catch (e) { res.status(500).json({ error: 'Failed to list bid submissions' }) }
})

subcontractsRouter.post('/bid-packages/:id/submissions', async (req: Request, res: Response) => {
  const r = req as R
  const { vendorId } = req.body as Record<string, unknown>
  if (!vendorId) { res.status(400).json({ error: 'vendorId is required' }); return }
  try {
    const sub = await submitBid(r.tenantId!, { bidPackageId: p(req, 'id'), ...req.body })
    res.status(201).json({ submission: sub })
  } catch (e) { res.status(500).json({ error: 'Failed to submit bid' }) }
})

subcontractsRouter.post('/bid-submissions/:id/award', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const sc = await awardBid(r.tenantId!, p(req, 'id'), r.auth?.sub ?? 'unknown', req.body)
    if (!sc) { res.status(404).json({ error: 'Bid submission not found' }); return }
    res.status(201).json({ subcontract: sc })
  } catch (e) { res.status(500).json({ error: 'Failed to award bid' }) }
})

// ─── Subcontracts ─────────────────────────────────────────────────────────────

subcontractsRouter.post('/projects/:projectId/subcontracts', async (req: Request, res: Response) => {
  const r = req as R
  const { vendorId, title, contractValue } = req.body as Record<string, unknown>
  if (!vendorId || !title || contractValue == null) {
    res.status(400).json({ error: 'vendorId, title, and contractValue are required' }); return
  }
  try {
    const sc = await createSubcontract(r.tenantId!, { projectId: p(req, 'projectId'), createdBy: r.auth?.sub, ...req.body })
    res.status(201).json({ subcontract: sc })
  } catch (e) { res.status(500).json({ error: 'Failed to create subcontract' }) }
})

subcontractsRouter.get('/projects/:projectId/subcontracts', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const subcontracts = await listSubcontracts(r.tenantId!, p(req, 'projectId'), q(req, 'status') as never)
    res.json({ subcontracts })
  } catch (e) { res.status(500).json({ error: 'Failed to list subcontracts' }) }
})

subcontractsRouter.get('/subcontracts/:id', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const sc = await getSubcontract(r.tenantId!, p(req, 'id'))
    if (!sc) { res.status(404).json({ error: 'Subcontract not found' }); return }
    res.json({ subcontract: sc })
  } catch (e) { res.status(500).json({ error: 'Failed to get subcontract' }) }
})

subcontractsRouter.patch('/subcontracts/:id/status', async (req: Request, res: Response) => {
  const r = req as R
  const { status } = req.body as { status?: ScStatus }
  if (!status) { res.status(400).json({ error: 'status is required' }); return }
  try {
    const sc = await updateSubcontractStatus(r.tenantId!, p(req, 'id'), status)
    if (!sc) { res.status(404).json({ error: 'Subcontract not found' }); return }
    res.json({ subcontract: sc })
  } catch (e) { res.status(500).json({ error: 'Failed to update status' }) }
})

// ─── Invoices ─────────────────────────────────────────────────────────────────

subcontractsRouter.post('/subcontracts/:id/invoices', async (req: Request, res: Response) => {
  const r = req as R
  const { periodStart, periodEnd, grossAmount } = req.body as Record<string, unknown>
  if (!periodStart || !periodEnd || grossAmount == null) {
    res.status(400).json({ error: 'periodStart, periodEnd, and grossAmount are required' }); return
  }
  try {
    const inv = await createInvoice(r.tenantId!, { subcontractId: p(req, 'id'), ...req.body })
    res.status(201).json({ invoice: inv })
  } catch (e) { res.status(500).json({ error: 'Failed to create invoice' }) }
})

subcontractsRouter.get('/subcontracts/:id/invoices', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const invoices = await listInvoices(r.tenantId!, p(req, 'id'))
    res.json({ invoices })
  } catch (e) { res.status(500).json({ error: 'Failed to list invoices' }) }
})

subcontractsRouter.post('/sc-invoices/:id/submit', async (req: Request, res: Response) => {
  const r = req as R
  try {
    const inv = await submitInvoice(r.tenantId!, p(req, 'id'))
    if (!inv) { res.status(404).json({ error: 'Invoice not found or not in draft status' }); return }
    res.json({ invoice: inv })
  } catch (e) { res.status(500).json({ error: 'Failed to submit invoice' }) }
})

subcontractsRouter.post('/sc-invoices/:id/approve', async (req: Request, res: Response) => {
  const r = req as R
  const { reviewNotes } = req.body as { reviewNotes?: string }
  try {
    const inv = await reviewInvoice(r.tenantId!, p(req, 'id'), true, r.auth?.sub ?? 'unknown', reviewNotes)
    if (!inv) { res.status(404).json({ error: 'Invoice not found or not in submitted status' }); return }
    res.json({ invoice: inv })
  } catch (e) { res.status(500).json({ error: 'Failed to approve invoice' }) }
})

subcontractsRouter.post('/sc-invoices/:id/reject', async (req: Request, res: Response) => {
  const r = req as R
  const { reviewNotes } = req.body as { reviewNotes?: string }
  try {
    const inv = await reviewInvoice(r.tenantId!, p(req, 'id'), false, r.auth?.sub ?? 'unknown', reviewNotes)
    if (!inv) { res.status(404).json({ error: 'Invoice not found or not in submitted status' }); return }
    res.json({ invoice: inv })
  } catch (e) { res.status(500).json({ error: 'Failed to reject invoice' }) }
})
