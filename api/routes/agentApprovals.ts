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

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}

export const agentApprovalsRouter = Router()
agentApprovalsRouter.use(requireAuth as never, requireTenant() as never)

// GET /api/v1/agents/approvals — list pending approvals
agentApprovalsRouter.get('/', async (req: Request, res: Response) => {
  const r = req as R
  const { agentType } = req.query

  const approvals = await listPendingApprovals(
    r.tenantId!,
    agentType as AgentType | undefined
  )
  res.json({ approvals })
})

// GET /api/v1/agents/approvals/:id — get approval detail
agentApprovalsRouter.get('/:id', async (req: Request, res: Response) => {
  const r = req as R
  const approval = await getApproval(p(req, 'id'), r.tenantId!)
  if (!approval) return res.status(404).json({ error: 'Approval not found' })
  res.json(approval)
})

// POST /api/v1/agents/approvals/:id/approve
agentApprovalsRouter.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const r = req as R
    const { reviewedBy, notes } = req.body
    if (!reviewedBy) {
      return res.status(400).json({ error: 'reviewedBy required' })
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
agentApprovalsRouter.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const r = req as R
    const { reviewedBy, notes } = req.body
    if (!reviewedBy) {
      return res.status(400).json({ error: 'reviewedBy required' })
    }

    const approval = await rejectAction(p(req, 'id'), r.tenantId!, reviewedBy, notes)
    res.json(approval)
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/v1/agents/approvals/expire — expire stale approvals (admin/cron)
agentApprovalsRouter.post('/expire', async (req: Request, res: Response) => {
  const r = req as R
  const expired = await expireStaleApprovals(r.tenantId!)
  res.json({ expired })
})
