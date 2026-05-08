// Denver Engineering — Agent Approval Routes (v5.0.0)
import { Router, Request, Response } from 'express'
import {
  listPendingApprovals,
  getApproval,
  approveAction,
  rejectAction,
  expireStaleApprovals,
} from '../services/agents/agentGovernanceService'
import { resumeFromApproval } from '../services/agents/agentTaskQueue'

export const agentApprovalsRouter = Router()

// GET /api/v1/agents/approvals — list pending approvals
agentApprovalsRouter.get('/', async (req: Request, res: Response) => {
  const { tenantId, agentType } = req.query
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const approvals = await listPendingApprovals(
    tenantId as string,
    agentType as string | undefined
  )
  res.json({ approvals })
})

// GET /api/v1/agents/approvals/:id — get approval detail
agentApprovalsRouter.get('/:id', async (req: Request, res: Response) => {
  const { tenantId } = req.query
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const approval = await getApproval(req.params.id, tenantId as string)
  if (!approval) return res.status(404).json({ error: 'Approval not found' })
  res.json(approval)
})

// POST /api/v1/agents/approvals/:id/approve
agentApprovalsRouter.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const { tenantId, reviewedBy, notes } = req.body
    if (!tenantId || !reviewedBy) {
      return res.status(400).json({ error: 'tenantId, reviewedBy required' })
    }

    const approval = await approveAction(req.params.id, tenantId, reviewedBy, notes)

    // Resume the blocked task
    await resumeFromApproval(approval.taskId, tenantId)

    res.json(approval)
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/v1/agents/approvals/:id/reject
agentApprovalsRouter.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const { tenantId, reviewedBy, notes } = req.body
    if (!tenantId || !reviewedBy) {
      return res.status(400).json({ error: 'tenantId, reviewedBy required' })
    }

    const approval = await rejectAction(req.params.id, tenantId, reviewedBy, notes)
    res.json(approval)
  } catch (err: unknown) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// POST /api/v1/agents/approvals/expire — expire stale approvals (admin/cron)
agentApprovalsRouter.post('/expire', async (req: Request, res: Response) => {
  const { tenantId } = req.body
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const expired = await expireStaleApprovals(tenantId)
  res.json({ expired })
})
