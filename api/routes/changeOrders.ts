/**
 * Denver Engineering — Change Orders API Routes (v10.7.0)
 *
 * POST   /api/v1/projects/:projectId/change-orders            — create CO
 * GET    /api/v1/projects/:projectId/change-orders            — list COs (filterable)
 * GET    /api/v1/projects/:projectId/change-orders/summary    — project CO summary
 * GET    /api/v1/change-orders/:id                            — get CO detail
 * PATCH  /api/v1/change-orders/:id                            — update (draft only)
 * POST   /api/v1/change-orders/:id/submit                     — draft → submitted
 * POST   /api/v1/change-orders/:id/approve                    — submitted → approved
 * POST   /api/v1/change-orders/:id/reject                     — submitted → rejected
 * POST   /api/v1/change-orders/:id/void                       — approved|rejected → void
 * GET    /api/v1/change-orders/:id/tasks                      — list linked schedule tasks
 * POST   /api/v1/change-orders/:id/tasks                      — link schedule tasks
 * DELETE /api/v1/change-orders/:id/tasks/:taskId              — unlink a schedule task
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope, requireRecordScope } from '../authz/recordScope'
import {
  createChangeOrder, getChangeOrder, listChangeOrders, updateChangeOrder,
  submitChangeOrder, approveChangeOrder, rejectChangeOrder, voidChangeOrder,
  linkTasks, unlinkTask, listLinkedTasks, getChangeOrderSummary,
  type CoStatus, type CoType,
} from '../services/changeOrders/changeOrderService'

type R = Request & AuthenticatedRequest & TenantRequest
const p = (req: Request, key: string) => {
  const v = (req.params as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : (v ?? '')
}
const q = (req: Request, key: string) => {
  const v = (req.query as Record<string, string | string[]>)[key]
  return Array.isArray(v) ? v[0] : v
}

export const changeOrdersRouter = Router()
changeOrdersRouter.use(requireAuth    as never)
changeOrdersRouter.use(requireTenant() as never)

// ─── Create ───────────────────────────────────────────────────────────────────

changeOrdersRouter.post('/projects/:projectId/change-orders', requireCapability('cost.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  const { title } = req.body as Record<string, unknown>
  if (!title) { res.status(400).json({ error: 'title is required' }); return }
  try {
    const co = await createChangeOrder(r.tenantId!, {
      projectId: p(req, 'projectId'),
      createdBy: r.auth?.sub,
      ...req.body,
    })
    res.status(201).json({ changeOrder: co })
  } catch (e) {
    res.status(500).json({ error: 'Failed to create change order' })
  }
})

// ─── List ─────────────────────────────────────────────────────────────────────

changeOrdersRouter.get('/projects/:projectId/change-orders', requireCapability('cost.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const result = await listChangeOrders(r.tenantId!, {
      projectId: p(req, 'projectId'),
      status:    q(req, 'status') as CoStatus | undefined,
      type:      q(req, 'type')   as CoType   | undefined,
      limit:     q(req, 'limit')  ? Number(q(req, 'limit'))  : undefined,
      offset:    q(req, 'offset') ? Number(q(req, 'offset')) : undefined,
    })
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: 'Failed to list change orders' })
  }
})

// ─── Summary ──────────────────────────────────────────────────────────────────

changeOrdersRouter.get('/projects/:projectId/change-orders/summary', requireCapability('cost.view') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const summary = await getChangeOrderSummary(r.tenantId!, p(req, 'projectId'))
    res.json({ summary })
  } catch (e) {
    res.status(500).json({ error: 'Failed to get change order summary' })
  }
})

// ─── Get detail ───────────────────────────────────────────────────────────────

changeOrdersRouter.get('/change-orders/:id', requireCapability('cost.view') as never, requireRecordScope('changeorder') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const co = await getChangeOrder(r.tenantId!, p(req, 'id'))
    if (!co) { res.status(404).json({ error: 'Change order not found' }); return }
    res.json({ changeOrder: co })
  } catch (e) {
    res.status(500).json({ error: 'Failed to get change order' })
  }
})

// ─── Update (draft only) ──────────────────────────────────────────────────────

changeOrdersRouter.patch('/change-orders/:id', requireCapability('cost.write') as never, requireRecordScope('changeorder') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const co = await updateChangeOrder(r.tenantId!, p(req, 'id'), req.body)
    if (!co) { res.status(404).json({ error: 'Change order not found or not in draft status' }); return }
    res.json({ changeOrder: co })
  } catch (e) {
    res.status(500).json({ error: 'Failed to update change order' })
  }
})

// ─── Workflow transitions ─────────────────────────────────────────────────────

changeOrdersRouter.post('/change-orders/:id/submit', requireCapability('cost.write') as never, requireRecordScope('changeorder') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const co = await submitChangeOrder(r.tenantId!, p(req, 'id'), r.auth?.sub ?? 'unknown')
    if (!co) { res.status(404).json({ error: 'Change order not found or not in draft status' }); return }
    res.json({ changeOrder: co })
  } catch (e) {
    res.status(500).json({ error: 'Failed to submit change order' })
  }
})

// AUDIT-P1-12: approve/reject were gated only by requireAuth+requireTenant —
// any authenticated tenant member, including a 'viewer', could approve or
// reject a budget/contract-impacting change order. owner/admin/project_manager
// matches the roles with approval authority elsewhere in the RBAC hierarchy
// (README.md: owner → admin → project_manager → engineer → viewer).
changeOrdersRouter.post('/change-orders/:id/approve', requireCapability('cost.approve') as never, requireRecordScope('changeorder') as never, async (req: Request, res: Response) => {
  const r = req as R
  const { reviewNotes } = req.body as { reviewNotes?: string }
  try {
    const co = await approveChangeOrder(r.tenantId!, p(req, 'id'), r.auth?.sub ?? 'unknown', reviewNotes)
    if (!co) { res.status(404).json({ error: 'Change order not found or not in submitted status' }); return }
    res.json({ changeOrder: co })
  } catch (e) {
    res.status(500).json({ error: 'Failed to approve change order' })
  }
})

changeOrdersRouter.post('/change-orders/:id/reject', requireCapability('cost.approve') as never, requireRecordScope('changeorder') as never, async (req: Request, res: Response) => {
  const r = req as R
  const { reviewNotes } = req.body as { reviewNotes?: string }
  try {
    const co = await rejectChangeOrder(r.tenantId!, p(req, 'id'), r.auth?.sub ?? 'unknown', reviewNotes)
    if (!co) { res.status(404).json({ error: 'Change order not found or not in submitted status' }); return }
    res.json({ changeOrder: co })
  } catch (e) {
    res.status(500).json({ error: 'Failed to reject change order' })
  }
})

changeOrdersRouter.post('/change-orders/:id/void', requireCapability('cost.approve') as never, requireRecordScope('changeorder') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const co = await voidChangeOrder(r.tenantId!, p(req, 'id'))
    if (!co) { res.status(404).json({ error: 'Change order not found or cannot be voided in current status' }); return }
    res.json({ changeOrder: co })
  } catch (e) {
    res.status(500).json({ error: 'Failed to void change order' })
  }
})

// ─── Linked tasks ─────────────────────────────────────────────────────────────

changeOrdersRouter.get('/change-orders/:id/tasks', requireCapability('cost.view') as never, requireRecordScope('changeorder') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    const tasks = await listLinkedTasks(r.tenantId!, p(req, 'id'))
    res.json({ tasks })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list linked tasks' })
  }
})

changeOrdersRouter.post('/change-orders/:id/tasks', requireCapability('cost.write') as never, requireRecordScope('changeorder') as never, async (req: Request, res: Response) => {
  const r = req as R
  const { taskIds } = req.body as { taskIds?: string[] }
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    res.status(400).json({ error: 'taskIds[] is required' }); return
  }
  try {
    const tasks = await linkTasks(r.tenantId!, p(req, 'id'), taskIds)
    res.status(201).json({ tasks })
  } catch (e) {
    res.status(500).json({ error: 'Failed to link tasks' })
  }
})

changeOrdersRouter.delete('/change-orders/:id/tasks/:taskId', requireCapability('cost.write') as never, requireRecordScope('changeorder') as never, async (req: Request, res: Response) => {
  const r = req as R
  try {
    await unlinkTask(r.tenantId!, p(req, 'id'), p(req, 'taskId'))
    res.status(204).end()
  } catch (e) {
    res.status(500).json({ error: 'Failed to unlink task' })
  }
})
