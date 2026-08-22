/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Denver Engineering — Budgets API Route
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.31.0 — Procore Financials-parity budget and cost codes.
 *
 * Change-order CRUD lives in api/routes/changeOrders.ts (changeOrdersRouter),
 * which is service-backed and matches the reconciled change_orders schema
 * (migration 083). The inline change-order routes that used to live here were
 * removed: they shadowed changeOrdersRouter (mounted on the same /api/v1
 * prefix) and used the pre-083 column shape (co_type/amount/schedule_days),
 * returning the wrong response envelope and writing lossy rows.
 *
 * Endpoints:
 *   GET    /api/v1/projects/:projectId/budget
 *   POST   /api/v1/projects/:projectId/budget                 — create/baseline
 *   PATCH  /api/v1/budgets/:id
 *   GET    /api/v1/budgets/:id/items
 *   POST   /api/v1/budgets/:id/items
 *   PATCH  /api/v1/budget-items/:itemId
 *   DELETE /api/v1/budget-items/:itemId
 *   GET    /api/v1/projects/:projectId/budget/rollup
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import { requireCapability } from '../authz/requireCapability'
import { requireProjectScope } from '../authz/recordScope'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth   as any)
router.use(requireTenant() as any)

// ─── Budget (one per project) ────────────────────────────────────────────────
router.get('/projects/:projectId/budget', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT * FROM budgets WHERE tenant_id=$1 AND project_id=$2`,
      [r.tenantId!, req.params.projectId])
    res.json({ budget: result.rows[0] ?? null })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch budget' })
  }
})

router.post('/projects/:projectId/budget', requireCapability('cost.write') as never, requireProjectScope() as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body ?? {}
  try {
    const result = await tenantQuery(r.tenantId!,
      `INSERT INTO budgets (tenant_id, project_id, name, currency, created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, project_id) DO UPDATE SET updated_at=NOW()
       RETURNING *`,
      [r.tenantId!, req.params.projectId,
       b.name ?? 'Project Budget', b.currency ?? 'USD', (r as any).auth?.sub ?? null])
    res.status(201).json({ budget: result.rows[0] })
  } catch (e) {
    console.error('[budget] create error', e)
    res.status(500).json({ error: 'Failed to create budget' })
  }
})

router.patch('/budgets/:id', requireCapability('cost.write') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['name','currency','status','baseline_date',
                   'original_total','revised_total','committed_total','actual_total','forecast_total']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(r.tenantId!,
      `UPDATE budgets SET ${setClauses.join(', ')} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, ...updates.map(([, v]) => v as any)])
    if (!result.rows[0]) return res.status(404).json({ error: 'Budget not found' })
    res.json({ budget: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Failed to update budget' })
  }
})

// ─── Budget Items ────────────────────────────────────────────────────────────
router.get('/budgets/:id/items', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT * FROM budget_items WHERE budget_id=$1 AND tenant_id=$2
        ORDER BY sort_order, cost_code`,
      [req.params.id, r.tenantId!])
    res.json({ items: result.rows })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list budget items' })
  }
})

router.post('/budgets/:id/items', requireCapability('cost.write') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body ?? {}
  if (!b.cost_code || !b.description) return res.status(400).json({ error: 'cost_code and description required' })
  const qty = Number(b.qty ?? 0), uc = Number(b.unit_cost ?? 0)
  const original = b.original_amount != null ? Number(b.original_amount) : qty * uc
  try {
    const result = await tenantQuery(r.tenantId!,
      `INSERT INTO budget_items
        (tenant_id, budget_id, cost_code, description, category, unit, qty, unit_cost,
         original_amount, revised_amount, committed_amount, actual_amount, forecast_amount,
         notes, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [r.tenantId!, req.params.id, b.cost_code, b.description,
       b.category ?? null, b.unit ?? null, qty, uc,
       original, b.revised_amount ?? original, b.committed_amount ?? 0,
       b.actual_amount ?? 0, b.forecast_amount ?? original,
       b.notes ?? null, b.sort_order ?? 0])
    res.status(201).json({ item: result.rows[0] })
  } catch (e) {
    console.error('[budget-items] create error', e)
    res.status(500).json({ error: 'Failed to create budget item' })
  }
})

router.patch('/budget-items/:itemId', requireCapability('cost.write') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['cost_code','description','category','unit','qty','unit_cost',
                   'original_amount','revised_amount','committed_amount','actual_amount',
                   'forecast_amount','notes','sort_order']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(r.tenantId!,
      `UPDATE budget_items SET ${setClauses.join(', ')} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.itemId, r.tenantId!, ...updates.map(([, v]) => v as any)])
    if (!result.rows[0]) return res.status(404).json({ error: 'Item not found' })
    res.json({ item: result.rows[0] })
  } catch (e) {
    res.status(500).json({ error: 'Failed to update budget item' })
  }
})

router.delete('/budget-items/:itemId', requireCapability('cost.write') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    await tenantQuery(r.tenantId!,
      'DELETE FROM budget_items WHERE id=$1 AND tenant_id=$2',
      [req.params.itemId, r.tenantId!])
    res.json({ deleted: true })
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete budget item' })
  }
})

router.get('/projects/:projectId/budget/rollup', requireCapability('cost.view') as never, async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT br.* FROM budget_rollup br
        JOIN budgets b ON b.id = br.budget_id
        WHERE b.tenant_id=$1 AND b.project_id=$2`,
      [r.tenantId!, req.params.projectId])
    res.json({ rollup: result.rows[0] ?? null })
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch rollup' })
  }
})

export { router as budgetsRouter }
