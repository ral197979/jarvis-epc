/**
 * Denver Engineering — Integration Hub Routes (v4.40.0)
 * ───────────────────────────────────────────────────────
 * Ava Phase 4 — Enterprise connector management and sync.
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { TenantRequest } from '../middleware/tenant'
import {
  registerConnector, listConnectors, getConnectorHealth,
  enqueueIntegrationJob, claimIntegrationJob,
  completeIntegrationJob, failIntegrationJob,
} from '../services/integration/connectorFramework'

export const integrationHubRouter = Router()
const auth = requireAuth as never
type IntReq = Request & AuthenticatedRequest & TenantRequest

integrationHubRouter.use(auth)

// ─── Register connector ───────────────────────────────────────────────────────
integrationHubRouter.post('/connect', async (req: Request, res: Response) => {
  const r = req as IntReq
  const { name, type, config = {}, credential_ref } = req.body
  if (!name || !type) { res.status(400).json({ error: 'name and type required' }); return }
  const id = await registerConnector({
    tenantId: r.tenantId!, name, type, config, credentialRef: credential_ref, createdBy: r.auth!.sub,
  })
  res.status(201).json({ data: { connector_id: id } })
})

// ─── List connectors ──────────────────────────────────────────────────────────
integrationHubRouter.get('/', async (req: Request, res: Response) => {
  const r = req as IntReq
  const connectors = await listConnectors(r.tenantId!)
  res.json({ data: connectors })
})

// ─── Connector health ─────────────────────────────────────────────────────────
integrationHubRouter.get('/health', async (req: Request, res: Response) => {
  const r = req as IntReq
  const connectors = await listConnectors(r.tenantId!)
  const health = await Promise.all(
    (connectors as Array<{ id: string }>).map(c => getConnectorHealth(r.tenantId!, c.id))
  )
  res.json({ data: health })
})

integrationHubRouter.get('/:id/health', async (req: Request, res: Response) => {
  const r = req as IntReq
  try {
    const h = await getConnectorHealth(r.tenantId!, req.params['id'] as string)
    res.json({ data: h })
  } catch { res.status(404).json({ error: 'Connector not found' }) }
})

// ─── Trigger sync ─────────────────────────────────────────────────────────────
integrationHubRouter.post('/sync', async (req: Request, res: Response) => {
  const r = req as IntReq
  const { connector_id, job_type = 'sync', payload = {}, idempotency_key } = req.body
  if (!connector_id) { res.status(400).json({ error: 'connector_id required' }); return }
  const jobId = await enqueueIntegrationJob(r.tenantId!, connector_id, job_type, payload, idempotency_key)
  res.status(202).json({ data: { job_id: jobId, queued: jobId !== null } })
})

// ─── Complete job (worker callback) ──────────────────────────────────────────
integrationHubRouter.post('/jobs/:id/complete', async (req: Request, res: Response) => {
  const r = req as IntReq
  await completeIntegrationJob(req.params['id'] as string, r.tenantId!, req.body.result ?? {})
  res.json({ data: { completed: true } })
})

// ─── Fail job (worker callback) ───────────────────────────────────────────────
integrationHubRouter.post('/jobs/:id/fail', async (req: Request, res: Response) => {
  const r = req as IntReq
  await failIntegrationJob(req.params['id'] as string, r.tenantId!, req.body.error ?? 'unknown')
  res.json({ data: { failed: true } })
})
