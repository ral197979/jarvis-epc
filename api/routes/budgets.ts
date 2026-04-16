/**
 * JARVIS EPC — Budgets & Change Orders API Route
 * ─────────────────────────────────────────────────────────────────────────────
 * v4.31.0 — Procore Financials-parity budget, cost codes, and change orders.
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
 *   GET    /api/v1/projects/:projectId/change-orders
 *   POST   /api/v1/projects/:projectId/change-orders
 *   PATCH  /api/v1/change-orders/:id
 */
import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { requireTenant, type TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'

type AuthTenantReq = Request & AuthenticatedRequest & TenantRequest
const router = Router()
router.use(requireAuth   as any)
router.use(requireTenant as any)

// ─── Budget (one per project) ────────────────────────────────────────────────
router.get('/projects/:projectId/budget', async (req: Request, res: Response) => {
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

router.post('/projects/:projectId/budget', async (req: Request, res: Response) => {
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

router.patch('/budgets/:id', async (req: Request, res: Response) => {
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
router.get('/budgets/:id/items', async (req: Request, res: Response) => {
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

router.post('/budgets/:id/items', async (req: Request, res: Response) => {
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

router.patch('/budget-items/:itemId', async (req: Request, res: Response) => {
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

router.delete('/budget-items/:itemId', async (req: Request, res: Response) => {
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

router.get('/projects/:projectId/budget/rollup', async (req: Request, res: Response) => {
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

// ─── Change Orders ───────────────────────────────────────────────────────────
router.get('/projects/:projectId/change-orders', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const { status, co_type } = req.query
  const params: unknown[] = [r.tenantId!, req.params.projectId]
  const filters: string[] = []
  if (status)  { params.push(status);  filters.push(`status=$${params.length}`) }
  if (co_type) { params.push(co_type); filters.push(`co_type=$${params.length}`) }
  const where = filters.length ? `AND ${filters.join(' AND ')}` : ''
  try {
    const result = await tenantQuery(r.tenantId!,
      `SELECT * FROM change_orders WHERE tenant_id=$1 AND project_id=$2 ${where}
        ORDER BY created_at DESC`, params)
    res.json({ change_orders: result.rows })
  } catch (e) {
    res.status(500).json({ error: 'Failed to list change orders' })
  }
})

router.post('/projects/:projectId/change-orders', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const b = req.body ?? {}
  if (!b.title) return res.status(400).json({ error: 'title required' })
  const countRes = await tenantQuery(r.tenantId!,
    'SELECT COUNT(*) AS n FROM change_orders WHERE tenant_id=$1 AND project_id=$2',
    [r.tenantId!, req.params.projectId])
  const n = parseInt(countRes.rows[0]?.n ?? '0') + 1
  const co_number = b.co_number ?? `${(b.co_type ?? 'PCO')}-${String(n).padStart(3, '0')}`
  try {
    const result = await tenantQuery(r.tenantId!,
      `INSERT INTO change_orders
        (tenant_id, project_id, co_number, co_type, title, description, reason_code,
         amount, schedule_days, status, cost_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [r.tenantId!, req.params.projectId, co_number, b.co_type ?? 'PCO',
       b.title, b.description ?? null, b.reason_code ?? null,
       b.amount ?? 0, b.schedule_days ?? 0,
       b.status ?? 'draft', b.cost_code ?? null, (r as any).auth?.sub ?? null])
    res.status(201).json({ change_order: result.rows[0] })
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ error: 'co_number exists' })
    console.error('[change-orders] create error', e)
    res.status(500).json({ error: 'Failed to create change order' })
  }
})

router.patch('/change-orders/:id', async (req: Request, res: Response) => {
  const r = req as AuthTenantReq
  const allowed = ['title','description','reason_code','amount','schedule_days',
                   'status','cost_code','co_type']
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'No updatable fields' })
  const setClauses = updates.map(([k], i) => `${k} = $${i + 3}`)
  const s = updates.find(([k]) => k === 'status')
  if (s && s[1] === 'submitted') setClauses.push(`submitted_by='${(r as any).auth?.sub ?? ''}'::uuid`, `submitted_at=NOW()`)
  if (s && s[1] === 'approved')  setClauses.push(`approved_by='${(r as any).auth?.sub ?? ''}'::uuid`,  `approved_at=NOW()`)
  if (s && s[1] === 'executed')  setClauses.push(`executed_at=NOW()`)
  setClauses.push(`updated_at = NOW()`)
  try {
    const result = await tenantQuery(r.tenantId!,
      `UPDATE change_orders SET ${setClauses.join(', ')} WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, r.tenantId!, ...updates.map(([, v]) => v as any)])
    if (!result.rows[0]) return res.status(404).json({ error: 'Change order not found' })
    res.json({ change_order: result.rows[0] })
  } catch (e) {
    console.error('[change-orders] patch error', e)
    res.status(500).json({ error: 'Failed to update change order' })
  }
})

export { router as budgetsRouter }
