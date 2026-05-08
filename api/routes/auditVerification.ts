/**
 * Denver Engineering — Audit Verification Routes (v4.40.0)
 * ──────────────────────────────────────────────────────────
 * Ava Phase 4 — Chain integrity verification and audit export.
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { TenantRequest } from '../middleware/tenant'
import { verifyChainIntegrity, snapshotIntegrity, exportAuditChain, getIntegritySnapshots } from '../services/audit/auditVerifier'

export const auditVerificationRouter = Router()
const auth = requireAuth as never
type AuditReq = Request & AuthenticatedRequest & TenantRequest

auditVerificationRouter.use(auth)

// ─── Verify chain integrity ───────────────────────────────────────────────────
auditVerificationRouter.get('/verify', async (req: Request, res: Response) => {
  const r = req as AuditReq
  const { from, to } = req.query
  const report = await verifyChainIntegrity(r.tenantId,
    from as string | undefined, to as string | undefined)
  res.json({ data: report })
})

// ─── Get integrity snapshots ──────────────────────────────────────────────────
auditVerificationRouter.get('/integrity', async (req: Request, res: Response) => {
  const r = req as AuditReq
  const days = Math.min(Number(req.query['days'] ?? 30), 90)
  const snapshots = await getIntegritySnapshots(r.tenantId, days)
  res.json({ data: snapshots })
})

// ─── Manual snapshot ──────────────────────────────────────────────────────────
auditVerificationRouter.post('/snapshot', async (req: Request, res: Response) => {
  const r = req as AuditReq
  await snapshotIntegrity(r.tenantId)
  res.json({ data: { snapshotted: true } })
})

// ─── Export audit chain ───────────────────────────────────────────────────────
auditVerificationRouter.get('/export', async (req: Request, res: Response) => {
  const r = req as AuditReq
  const limit = Math.min(Number(req.query['limit'] ?? 10000), 50000)
  const events = await exportAuditChain(r.tenantId, limit)
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Content-Disposition', 'attachment; filename="audit-chain.json"')
  res.json({ data: events, meta: { count: events.length, tenant_id: r.tenantId } })
})
