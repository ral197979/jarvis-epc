/**
 * Denver Engineering — Policy Routes (v4.40.0)
 * ──────────────────────────────────────────────
 * Ava Phase 4 — Governance policy CRUD and evaluation endpoints.
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { TenantRequest } from '../middleware/tenant'
import { tenantQuery } from '../db/pool'
import { createPolicy, updatePolicy, evaluatePolicy } from '../services/policy/policyEngine'

export const policiesRouter = Router()
const auth = requireAuth as never
type PolicyReq = Request & AuthenticatedRequest & TenantRequest

policiesRouter.use(auth)

// ─── List policies ────────────────────────────────────────────────────────────
policiesRouter.get('/', async (req: Request, res: Response) => {
  const r = req as PolicyReq
  const { type, scope, status = 'active' } = req.query
  const params: unknown[] = [r.tenantId, status]
  let q = `SELECT id, name, description, scope, scope_id, policy_type, rules, priority, status, version, created_at
           FROM governance_policies WHERE tenant_id = $1 AND status = $2`
  if (type) { params.push(type); q += ` AND policy_type = $${params.length}` }
  if (scope) { params.push(scope); q += ` AND scope = $${params.length}` }
  q += ` ORDER BY priority ASC, created_at DESC`
  const { rows } = await tenantQuery(r.tenantId!, q, params)
  res.json({ data: rows })
})

// ─── Create policy ────────────────────────────────────────────────────────────
policiesRouter.post('/', async (req: Request, res: Response) => {
  const r = req as PolicyReq
  const { name, description, scope = 'tenant', scope_id, policy_type, rules, priority = 100 } = req.body
  if (!name || !policy_type || !Array.isArray(rules)) {
    res.status(400).json({ error: 'name, policy_type, and rules[] are required' }); return
  }
  const id = await createPolicy(r.tenantId!, {
    name, scope, scopeId: scope_id, policyType: policy_type,
    rules, priority, createdBy: r.auth!.sub,
  })
  res.status(201).json({ data: { policy_id: id } })
})

// ─── Update policy ────────────────────────────────────────────────────────────
policiesRouter.patch('/:id', async (req: Request, res: Response) => {
  const r = req as PolicyReq
  const { rules, priority, status } = req.body
  const ok = await updatePolicy(r.tenantId!, req.params['id'] as string, { rules, priority, status })
  if (!ok) { res.status(404).json({ error: 'Policy not found' }); return }
  res.json({ data: { updated: true } })
})

// ─── Evaluate policy (dry test) ───────────────────────────────────────────────
policiesRouter.post('/evaluate', async (req: Request, res: Response) => {
  const r = req as PolicyReq
  const { policy_type, payload, project_id, module, role } = req.body
  if (!policy_type || !payload) {
    res.status(400).json({ error: 'policy_type and payload required' }); return
  }
  const result = await evaluatePolicy(policy_type, {
    tenantId: r.tenantId!, projectId: project_id, module, role,
    actorId: r.auth!.sub, payload,
  })
  res.json({ data: result })
})

// ─── Policy audit log ─────────────────────────────────────────────────────────
policiesRouter.get('/audit', async (req: Request, res: Response) => {
  const r = req as PolicyReq
  const limit = Math.min(Number(req.query['limit'] ?? 50), 200)
  const { rows } = await tenantQuery(r.tenantId!, `
    SELECT p.name as policy_name, l.event_type, l.outcome, l.actor_id, l.resource, l.occurred_at
    FROM policy_audit_log l
    JOIN governance_policies p ON p.id = l.policy_id
    WHERE l.tenant_id = $1
    ORDER BY l.occurred_at DESC LIMIT $2
  `, [r.tenantId, limit])
  res.json({ data: rows })
})
