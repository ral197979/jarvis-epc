/**
 * JARVIS EPC — Procurement Routes
 * ──────────────────────────────────
 * v4.26.0 | Vendors, Purchase Orders, RFIs, Submittals
 *
 * Routes:
 *   /api/v1/vendors          — GET, POST, PATCH /:id, DELETE /:id
 *   /api/v1/purchase-orders  — GET, POST, PATCH /:id, POST /:id/approve
 *   /api/v1/rfis             — GET, POST, PATCH /:id, POST /:id/respond
 *   /api/v1/submittals       — GET, POST, PATCH /:id, POST /:id/review
 */

import { Router, Response } from 'express'
import { tenantQuery } from '../db/pool'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { slog } from '../../src/modules/observability/index'

type Req = AuthenticatedRequest & TenantRequest

// ─── Shared ───────────────────────────────────────────────────────────────────

function _pagination(q: Record<string, unknown>) {
  const page  = Math.max(1, parseInt(String(q['page']  ?? '1'),  10))
  const limit = Math.min(100, Math.max(1, parseInt(String(q['limit'] ?? '25'), 10)))
  return { page, limit, offset: (page - 1) * limit }
}

function _authMiddleware() { return [requireAuth as never, requireTenant() as never] }

// ═══════════════════════════════════════════════════════════════════════════════
// VENDORS
// ═══════════════════════════════════════════════════════════════════════════════

export const vendorsRouter = Router()
vendorsRouter.use(..._authMiddleware())

vendorsRouter.get('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { status, type, search } = req.query as Record<string, string>

  const conds: string[] = []
  const vals:  unknown[] = []
  let i = 1

  if (status) { conds.push(`status = $${i++}`); vals.push(status) }
  if (type)   { conds.push(`type = $${i++}`);   vals.push(type) }
  if (search) { conds.push(`(name ILIKE $${i} OR code ILIKE $${i} OR email ILIKE $${i})`); vals.push(`%${search}%`); i++ }

  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const [data, count] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT *, (SELECT COUNT(*) FROM purchase_orders WHERE vendor_id = vendors.id) AS po_count
      FROM vendors
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ORDER BY name ASC LIMIT $${i} OFFSET $${i+1}
    `, [...vals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM vendors
      WHERE tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    `, vals),
  ])

  const total = parseInt(count.rows[0]?.count ?? '0', 10)
  res.json({ data: data.rows, meta: { page, limit, total, pages: Math.ceil(total / limit) } })
})

vendorsRouter.get('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery(tenantId, `
    SELECT v.*,
      (SELECT COUNT(*) FROM purchase_orders WHERE vendor_id = v.id) AS po_count,
      (SELECT COALESCE(SUM(total_amount),0) FROM purchase_orders WHERE vendor_id = v.id AND status NOT IN ('cancelled')) AS total_committed,
      ab.display_name AS approved_by_name
    FROM vendors v
    LEFT JOIN users ab ON ab.id = v.approved_by
    WHERE v.id = $1 AND v.tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['id']])

  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

vendorsRouter.post('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const b = req.body as Record<string, unknown>
  if (!b['code'] || !b['name']) { res.status(422).json({ error: 'validation', message: 'code and name required' }); return }

  const result = await tenantQuery(tenantId, `
    INSERT INTO vendors (tenant_id,code,name,type,status,country,address,primary_contact,email,phone,website,tax_id,payment_terms,currency,categories,metadata)
    VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    RETURNING *
  `, [b['code'],b['name'],b['type']??null,b['status']??'prospect',b['country']??null,b['address']??null,b['primary_contact']??null,b['email']??null,b['phone']??null,b['website']??null,b['tax_id']??null,b['payment_terms']??null,b['currency']??'USD',b['categories']??[],JSON.stringify(b['metadata']??{})])
  res.status(201).json({ data: result.rows[0] })
})

vendorsRouter.patch('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const fields = ['name','type','status','country','address','primary_contact','email','phone','website','tax_id','payment_terms','currency','categories','rating','metadata']
  const sets: string[] = []; const vals: unknown[] = []; let i = 1
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      sets.push(`${f} = $${i++}`)
      vals.push(f === 'metadata' ? JSON.stringify(req.body[f]) : req.body[f])
    }
  }
  if (!sets.length) { res.status(422).json({ error: 'validation', message: 'No valid fields' }); return }

  // Auto-set approved fields when status changes to 'approved'
  if (req.body['status'] === 'approved') {
    sets.push(`approved_by = $${i++}`, `approved_at = NOW()`)
    vals.push(req.auth?.sub ?? null)
  }

  vals.push(req.params['id'])
  const result = await tenantQuery(tenantId, `
    UPDATE vendors SET ${sets.join(',')}
    WHERE id = $${i} AND tenant_id = current_setting('app.current_tenant_id',true)::uuid RETURNING *
  `, vals)
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PURCHASE ORDERS
// ═══════════════════════════════════════════════════════════════════════════════

export const purchaseOrdersRouter = Router()
purchaseOrdersRouter.use(..._authMiddleware())

purchaseOrdersRouter.get('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { status, project_id, vendor_id, search } = req.query as Record<string, string>

  const conds: string[] = []; const vals: unknown[] = []; let i = 1
  if (status)     { conds.push(`po.status = $${i++}`);     vals.push(status) }
  if (project_id) { conds.push(`po.project_id = $${i++}`); vals.push(project_id) }
  if (vendor_id)  { conds.push(`po.vendor_id = $${i++}`);  vals.push(vendor_id) }
  if (search)     { conds.push(`(po.po_number ILIKE $${i} OR po.title ILIKE $${i})`); vals.push(`%${search}%`); i++ }

  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const [data, count] = await Promise.all([
    tenantQuery(tenantId, `
      SELECT po.*, v.name AS vendor_name, p.code AS project_code, p.name AS project_name,
             ab.display_name AS approved_by_name
      FROM purchase_orders po
      JOIN vendors v ON v.id = po.vendor_id
      JOIN projects p ON p.id = po.project_id
      LEFT JOIN users ab ON ab.id = po.approved_by
      WHERE po.tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
      ORDER BY po.created_at DESC LIMIT $${i} OFFSET $${i+1}
    `, [...vals, limit, offset]),
    tenantQuery<{ count: string }>(tenantId, `
      SELECT COUNT(*)::text AS count FROM purchase_orders po
      WHERE po.tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    `, vals),
  ])

  const total = parseInt(count.rows[0]?.count ?? '0', 10)
  res.json({ data: data.rows, meta: { page, limit, total, pages: Math.ceil(total / limit) } })
})

purchaseOrdersRouter.get('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const result = await tenantQuery(tenantId, `
    SELECT po.*, v.name AS vendor_name, v.email AS vendor_email,
           p.code AS project_code, p.name AS project_name,
           c.contract_number, ab.display_name AS approved_by_name
    FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id
    JOIN projects p ON p.id = po.project_id
    LEFT JOIN contracts c ON c.id = po.contract_id
    LEFT JOIN users ab ON ab.id = po.approved_by
    WHERE po.id = $1 AND po.tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [req.params['id']])

  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

purchaseOrdersRouter.post('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const b = req.body as Record<string, unknown>
  if (!b['po_number'] || !b['project_id'] || !b['vendor_id'] || !b['title']) {
    res.status(422).json({ error: 'validation', message: 'po_number, project_id, vendor_id, title required' }); return
  }

  const result = await tenantQuery(tenantId, `
    INSERT INTO purchase_orders (tenant_id,project_id,vendor_id,contract_id,po_number,title,status,currency,subtotal,tax_amount,total_amount,required_date,line_items,shipping_to,notes,metadata,created_by)
    VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    RETURNING *
  `, [b['project_id'],b['vendor_id'],b['contract_id']??null,b['po_number'],b['title'],b['status']??'draft',b['currency']??'USD',b['subtotal']??0,b['tax_amount']??0,b['total_amount']??0,b['required_date']??null,JSON.stringify(b['line_items']??[]),b['shipping_to']??null,b['notes']??null,JSON.stringify(b['metadata']??{}),req.auth?.sub??null])
  res.status(201).json({ data: result.rows[0] })
})

purchaseOrdersRouter.patch('/:id', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const fields = ['title','status','currency','subtotal','tax_amount','total_amount','received_amount','required_date','issued_date','delivery_date','line_items','shipping_to','notes','metadata']
  const sets: string[] = []; const vals: unknown[] = []; let i = 1
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      sets.push(`${f} = $${i++}`)
      vals.push(['line_items','metadata'].includes(f) ? JSON.stringify(req.body[f]) : req.body[f])
    }
  }
  if (!sets.length) { res.status(422).json({ error: 'validation', message: 'No valid fields' }); return }
  vals.push(req.params['id'])
  const result = await tenantQuery(tenantId, `
    UPDATE purchase_orders SET ${sets.join(',')}
    WHERE id = $${i} AND tenant_id = current_setting('app.current_tenant_id',true)::uuid RETURNING *
  `, vals)
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

purchaseOrdersRouter.post('/:id/approve', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  if (!['owner','admin','project_manager'].includes(req.auth?.role ?? '')) {
    res.status(403).json({ error: 'forbidden' }); return
  }

  const result = await tenantQuery(tenantId, `
    UPDATE purchase_orders
    SET status = 'approved', approved_by = $1, approved_at = NOW()
    WHERE id = $2
      AND status = 'pending_approval'
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING *
  `, [req.auth?.sub, req.params['id']])

  if (!result.rows[0]) {
    res.status(409).json({ error: 'conflict', message: 'PO not in pending_approval status or not found.' }); return
  }
  slog('INFO', 'procurement', '[po] Approved', { tenantId, poId: req.params['id'], by: req.auth?.sub })
  res.json({ data: result.rows[0] })
})

// ═══════════════════════════════════════════════════════════════════════════════
// RFIs
// ═══════════════════════════════════════════════════════════════════════════════

export const rfisRouter = Router()
rfisRouter.use(..._authMiddleware())

rfisRouter.get('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { status, project_id, priority } = req.query as Record<string, string>

  const conds: string[] = []; const vals: unknown[] = []; let i = 1
  if (status)     { conds.push(`r.status = $${i++}`);     vals.push(status) }
  if (project_id) { conds.push(`r.project_id = $${i++}`); vals.push(project_id) }
  if (priority)   { conds.push(`r.priority = $${i++}`);   vals.push(priority) }

  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const data = await tenantQuery(tenantId, `
    SELECT r.*, p.code AS project_code,
           rb.display_name AS raised_by_name, at.display_name AS assigned_to_name
    FROM rfis r
    JOIN projects p ON p.id = r.project_id
    LEFT JOIN users rb ON rb.id = r.raised_by
    LEFT JOIN users at ON at.id = r.assigned_to
    WHERE r.tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    ORDER BY r.created_at DESC LIMIT $${i} OFFSET $${i+1}
  `, [...vals, limit, offset])

  res.json({ data: data.rows })
})

rfisRouter.post('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const b = req.body as Record<string, unknown>
  if (!b['project_id'] || !b['rfi_number'] || !b['title']) {
    res.status(422).json({ error: 'validation', message: 'project_id, rfi_number, title required' }); return
  }

  const result = await tenantQuery(tenantId, `
    INSERT INTO rfis (tenant_id,project_id,rfi_number,title,description,status,priority,discipline,raised_by,assigned_to,due_date,metadata)
    VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING *
  `, [b['project_id'],b['rfi_number'],b['title'],b['description']??null,'open',b['priority']??'medium',b['discipline']??null,req.auth?.sub??null,b['assigned_to']??null,b['due_date']??null,JSON.stringify(b['metadata']??{})])
  res.status(201).json({ data: result.rows[0] })
})

rfisRouter.post('/:id/respond', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const { response } = req.body as { response?: string }
  if (!response) { res.status(422).json({ error: 'validation', message: 'response text required' }); return }

  const result = await tenantQuery(tenantId, `
    UPDATE rfis SET status='answered', response=$1, response_by=$2, responded_at=NOW()
    WHERE id = $3 AND tenant_id = current_setting('app.current_tenant_id',true)::uuid RETURNING *
  `, [response, req.auth?.sub, req.params['id']])
  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})

// ═══════════════════════════════════════════════════════════════════════════════
// SUBMITTALS
// ═══════════════════════════════════════════════════════════════════════════════

export const submittalsRouter = Router()
submittalsRouter.use(..._authMiddleware())

submittalsRouter.get('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }

  const { page, limit, offset } = _pagination(req.query as Record<string, unknown>)
  const { status, project_id } = req.query as Record<string, string>

  const conds: string[] = []; const vals: unknown[] = []; let i = 1
  if (status)     { conds.push(`s.status = $${i++}`);     vals.push(status) }
  if (project_id) { conds.push(`s.project_id = $${i++}`); vals.push(project_id) }

  const where = conds.length ? `AND ${conds.join(' AND ')}` : ''

  const data = await tenantQuery(tenantId, `
    SELECT s.*, p.code AS project_code,
           sb.display_name AS submitted_by_name, rv.display_name AS reviewed_by_name
    FROM submittals s
    JOIN projects p ON p.id = s.project_id
    LEFT JOIN users sb ON sb.id = s.submitted_by
    LEFT JOIN users rv ON rv.id = s.reviewed_by
    WHERE s.tenant_id = current_setting('app.current_tenant_id',true)::uuid ${where}
    ORDER BY s.created_at DESC LIMIT $${i} OFFSET $${i+1}
  `, [...vals, limit, offset])

  res.json({ data: data.rows })
})

submittalsRouter.post('/', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const b = req.body as Record<string, unknown>
  if (!b['project_id'] || !b['submittal_number'] || !b['title']) {
    res.status(422).json({ error: 'validation', message: 'project_id, submittal_number, title required' }); return
  }

  const result = await tenantQuery(tenantId, `
    INSERT INTO submittals (tenant_id,project_id,submittal_number,title,type,status,discipline,spec_section,submitted_by,due_date,metadata)
    VALUES (current_setting('app.current_tenant_id',true)::uuid,$1,$2,$3,$4,'draft',$5,$6,$7,$8,$9)
    RETURNING *
  `, [b['project_id'],b['submittal_number'],b['title'],b['type']??null,b['discipline']??null,b['spec_section']??null,req.auth?.sub??null,b['due_date']??null,JSON.stringify(b['metadata']??{})])
  res.status(201).json({ data: result.rows[0] })
})

submittalsRouter.post('/:id/review', async (req: Req, res: Response) => {
  const { tenantId } = req
  if (!tenantId) { res.status(400).json({ error: 'tenant_required' }); return }
  const { status, review_notes } = req.body as { status?: string; review_notes?: string }

  const validStatuses = ['approved','approved_as_noted','revise_resubmit','rejected']
  if (!status || !validStatuses.includes(status)) {
    res.status(422).json({ error: 'validation', message: `status must be one of: ${validStatuses.join(', ')}` }); return
  }

  const result = await tenantQuery(tenantId, `
    UPDATE submittals SET status=$1, review_notes=$2, reviewed_by=$3, reviewed_at=NOW()
    WHERE id=$4 AND tenant_id=current_setting('app.current_tenant_id',true)::uuid RETURNING *
  `, [status, review_notes ?? null, req.auth?.sub, req.params['id']])

  if (!result.rows[0]) { res.status(404).json({ error: 'not_found' }); return }
  res.json({ data: result.rows[0] })
})
