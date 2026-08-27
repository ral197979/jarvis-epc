// Denver Engineering — Agent Approval Routes (v5.0.1)
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { type AgentType } from '../services/agents/agentTypes'
import {
  listPendingApprovals,
  getApproval,
  approveAction,
  rejectAction,
  expireStaleApprovals,
} from '../services/agents/agentGovernanceService'
import { resumeFromApproval } from '../services/agents/agentTaskQueue'
import { requireCapability } from '../authz/requireCapability'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}

export const agentApprovalsRouter = Router()
agentApprovalsRouter.use(requireAuth as never, requireTenant() as never)

// GET /api/v1/agents/approvals — list pending approvals
agentApprovalsRouter.get('/', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  const r = req as R
  const { agentType } = req.query

  const approvals = await listPendingApprovals(
    r.tenantId!,
    agentType as AgentType | undefined
  )
  res.json({ approvals })
})

// GET /api/v1/agents/approvals/:id — get approval detail
agentApprovalsRouter.get('/:id', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  const r = req as R
  const approval = await getApproval(p(req, 'id'), r.tenantId!)
  if (!approval) return res.status(404).json({ error: 'Approval not found' })
  res.json(approval)
})

// POST /api/v1/agents/approvals/:id/approve
agentApprovalsRouter.post('/:id/approve', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  try {
    const r = req as R
    const { notes } = req.body
    // ADR-014 Phase 3I §24/§25: the reviewer is the live authenticated
    // principal, never a body field. `reviewed_by` is the human-in-the-loop
    // record of record for an AI decision; accepting it from the caller let
    // any ai.govern holder attribute their own verdict to someone else.
    const reviewedBy = r.auth?.sub
    if (!reviewedBy) {
      return res.status(401).json({ error: 'unauthenticated' })
    }

    const approval = await approveAction(p(req, 'id'), r.tenantId!, reviewedBy, notes)

    // Resume the blocked task
    await resumeFromApproval(approval.taskId, r.tenantId!)

    res.json(approval)
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/v1/agents/approvals/:id/reject
agentApprovalsRouter.post('/:id/reject', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  try {
    const r = req as R
    const { notes } = req.body
    // ADR-014 Phase 3I §24/§25: the reviewer is the live authenticated
    // principal, never a body field. `reviewed_by` is the human-in-the-loop
    // record of record for an AI decision; accepting it from the caller let
    // any ai.govern holder attribute their own verdict to someone else.
    const reviewedBy = r.auth?.sub
    if (!reviewedBy) {
      return res.status(401).json({ error: 'unauthenticated' })
    }

    const approval = await rejectAction(p(req, 'id'), r.tenantId!, reviewedBy, notes)
    res.json(approval)
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/v1/agents/approvals/expire — expire stale approvals (admin/cron)
agentApprovalsRouter.post('/expire', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  const r = req as R
  const expired = await expireStaleApprovals(r.tenantId!)
  res.json({ expired })
})
