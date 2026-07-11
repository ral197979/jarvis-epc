/* eslint-disable @typescript-eslint/no-unused-vars */
// Denver Engineering — Enterprise Platform Routes (v8.0.0)
// Tenant lifecycle, feature gates, usage, AI cost, support, compliance, API keys.

import { Router, Request, Response, NextFunction } from 'express'
import { requireAuth, AuthenticatedRequest } from '../auth'
import { requireTenant, TenantRequest } from '../middleware/tenant'
import { provisionTenant, getSubscription, transitionLifecycle, getLifecycleHistory, listSubscriptions } from '../services/enterprise/tenantProvisioningService'
import { isFeatureEnabled, getFeatureConfig, setFeatureFlag, listFeatureFlags, checkApiQuota, checkSeatQuota, resolveEntitlements } from '../services/enterprise/featureGateService'
import { recordUsage, getUsageRecords, getCurrentMonthSummary } from '../services/enterprise/tenantUsageTracker'
import { recordAiUsage, getAiUsageRecords, getAiBudgetStatus, getAiCostByAgent } from '../services/enterprise/aiCostTracker'
import { computeHealthScore } from '../services/enterprise/customerHealthEngine'
import { createTicket, getTicket, listTickets, updateTicketStatus, escalateTicket, getSlaBreaches } from '../services/enterprise/supportOperationsService'
import { requestExport, getExport, listExports } from '../services/enterprise/complianceExportEngine'
import { generateHealthReport, runPlatformChecks, recordHealthCheck } from '../services/enterprise/deploymentHealthService'
import { createDemoTenant, listDemoTenants, resetDemoTenant } from '../services/enterprise/demoTenantGenerator'
import { createApiKey, listApiKeys, revokeApiKey } from '../services/enterprise/apiGatewayService'
import { archiveTenant, suspendTenant, reactivateTenant } from '../services/enterprise/tenantArchivalService'

type Req = AuthenticatedRequest & TenantRequest

const router = Router()

// ─── AUD-001: tenant-lifecycle authorization ───────────────────────────────────
// Lifecycle operations (provision/suspend/reactivate/archive/transition) are
// privileged platform actions. Previously these routes had only `requireAuth`
// and read the TARGET tenant from the URL, so any authenticated user could
// suspend or archive ANY tenant. Restrict to:
//   1. platform operators (user id listed in PLATFORM_ADMIN_USER_IDS), OR
//   2. an owner/admin acting on their OWN tenant (param tenantId === JWT tid).
const PLATFORM_ADMINS = new Set(
  (process.env['PLATFORM_ADMIN_USER_IDS'] ?? '').split(',').map(s => s.trim()).filter(Boolean),
)

function requireTenantAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = (req as AuthenticatedRequest).auth
  if (!auth?.sub) { res.status(401).json({ error: 'unauthenticated' }); return }
  if (PLATFORM_ADMINS.has(auth.sub)) { next(); return }
  const targetTenant = req.params.tenantId
  const isOwnTenant  = !!targetTenant && targetTenant === auth.tid
  const isPrivileged = auth.role === 'owner' || auth.role === 'admin'
  if (isOwnTenant && isPrivileged) { next(); return }
  res.status(403).json({
    error: 'forbidden',
    message: 'Tenant lifecycle operations require platform-admin, or owner/admin of the target tenant.',
  })
}

function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = (req as AuthenticatedRequest).auth
  if (!auth?.sub) { res.status(401).json({ error: 'unauthenticated' }); return }
  if (PLATFORM_ADMINS.has(auth.sub)) { next(); return }
  res.status(403).json({ error: 'forbidden', message: 'Platform-admin only.' })
}

// ─── Tenant Lifecycle ─────────────────────────────────────────────────────────

// POST /enterprise/tenants/:tenantId/provision
router.post('/tenants/:tenantId/provision', requireAuth, requireTenantAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = req.params.tenantId as string
    const result = await provisionTenant(tenantId, req.body as never)
    res.status(201).json(result)
  } catch (err) {
    res.status(500).json({ error: 'provisioning_failed', message: String(err) })
  }
})

// GET /enterprise/tenants/:tenantId/subscription
router.get('/tenants/:tenantId/subscription', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const sub = await getSubscription(tenantId)
    if (sub == null) { res.status(404).json({ error: 'not_found' }); return }
    res.json(sub)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// POST /enterprise/tenants/:tenantId/lifecycle
router.post('/tenants/:tenantId/lifecycle', requireAuth, requireTenantAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = req.params.tenantId as string
    const { toStatus, actor, reason, metadata } = req.body as Record<string, unknown>
    if (!toStatus) { res.status(422).json({ error: 'validation', message: 'toStatus required' }); return }
    const result = await transitionLifecycle(tenantId, toStatus as never, { actor: actor as string, reason: reason as string, metadata: metadata as never })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/tenants/:tenantId/lifecycle/history
router.get('/tenants/:tenantId/lifecycle/history', requireAuth, requireTenantAdmin, async (req: Request, res: Response) => {
  try {
    const history = await getLifecycleHistory(req.params.tenantId as string)
    res.json(history)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// POST /enterprise/tenants/:tenantId/suspend
router.post('/tenants/:tenantId/suspend', requireAuth, requireTenantAdmin, async (req: Request, res: Response) => {
  try {
    const { actor, reason } = req.body as Record<string, unknown>
    const result = await suspendTenant(req.params.tenantId as string, { actor: actor as string, reason: reason as string })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// POST /enterprise/tenants/:tenantId/reactivate
router.post('/tenants/:tenantId/reactivate', requireAuth, requireTenantAdmin, async (req: Request, res: Response) => {
  try {
    const { actor, reason } = req.body as Record<string, unknown>
    const result = await reactivateTenant(req.params.tenantId as string, { actor: actor as string, reason: reason as string })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// POST /enterprise/tenants/:tenantId/archive
router.post('/tenants/:tenantId/archive', requireAuth, requireTenantAdmin, async (req: Request, res: Response) => {
  try {
    const { actor, reason } = req.body as Record<string, unknown>
    const result = await archiveTenant(req.params.tenantId as string, { actor: actor as string, reason: reason as string })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/subscriptions (admin list)
router.get('/subscriptions', requireAuth, requirePlatformAdmin, async (req: Request, res: Response) => {
  try {
    const { lifecycleStatus, tier, limit } = req.query as Record<string, string>
    const subs = await listSubscriptions({ lifecycleStatus: lifecycleStatus as never, tier, limit: limit != null ? Number(limit) : undefined })
    res.json(subs)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// ─── Feature Flags ────────────────────────────────────────────────────────────

// GET /enterprise/features
router.get('/features', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const flags = await listFeatureFlags(tenantId)
    res.json(flags)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/features/:featureKey
router.get('/features/:featureKey', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const enabled = await isFeatureEnabled(tenantId, req.params.featureKey as string)
    const config = enabled ? await getFeatureConfig(tenantId, req.params.featureKey as string) : null
    res.json({ featureKey: req.params.featureKey, enabled, config })
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// PUT /enterprise/features/:featureKey
router.put('/features/:featureKey', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const flag = await setFeatureFlag(tenantId, { featureKey: req.params.featureKey as string, ...(req.body as Record<string, unknown>) } as never)
    res.json(flag)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/entitlements
router.get('/entitlements', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const summary = await resolveEntitlements(tenantId)
    res.json(summary)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/quota/api
router.get('/quota/api', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const result = await checkApiQuota(tenantId)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/quota/seats
router.get('/quota/seats', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const result = await checkSeatQuota(tenantId)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// ─── Usage ────────────────────────────────────────────────────────────────────

// POST /enterprise/usage
router.post('/usage', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const record = await recordUsage(tenantId, req.body as never)
    res.status(201).json(record)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/usage
router.get('/usage', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const { eventType, limit } = req.query as Record<string, string>
    const records = await getUsageRecords(tenantId, { eventType: eventType as never, limit: limit != null ? Number(limit) : undefined })
    res.json(records)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/usage/summary
router.get('/usage/summary', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const summary = await getCurrentMonthSummary(tenantId)
    res.json(summary)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// ─── AI Cost / Budget ─────────────────────────────────────────────────────────

// POST /enterprise/ai-usage
router.post('/ai-usage', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const record = await recordAiUsage(tenantId, req.body as never)
    res.status(201).json(record)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/ai-usage
router.get('/ai-usage', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const { agentType, model, limit } = req.query as Record<string, string>
    const records = await getAiUsageRecords(tenantId, { agentType, model, limit: limit != null ? Number(limit) : undefined })
    res.json(records)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/ai-usage/budget
router.get('/ai-usage/budget', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const status = await getAiBudgetStatus(tenantId)
    res.json(status)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/ai-usage/by-agent
router.get('/ai-usage/by-agent', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const breakdown = await getAiCostByAgent(tenantId)
    res.json(breakdown)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// ─── Customer Health ──────────────────────────────────────────────────────────

// GET /enterprise/health-score
router.get('/health-score', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const score = await computeHealthScore(tenantId)
    res.json(score)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// ─── Support Tickets ──────────────────────────────────────────────────────────

// POST /enterprise/tickets
router.post('/tickets', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const ticket = await createTicket(tenantId, req.body as never)
    res.status(201).json(ticket)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/tickets
router.get('/tickets', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const { status, priority, assignee, limit } = req.query as Record<string, string>
    const tickets = await listTickets(tenantId, { status: status as never, priority: priority as never, assignee, limit: limit != null ? Number(limit) : undefined })
    res.json(tickets)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/tickets/sla-breaches
router.get('/tickets/sla-breaches', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const breaches = await getSlaBreaches(tenantId)
    res.json(breaches)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/tickets/:id
router.get('/tickets/:id', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const ticket = await getTicket(tenantId, req.params.id as string)
    if (ticket == null) { res.status(404).json({ error: 'not_found' }); return }
    res.json(ticket)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// PATCH /enterprise/tickets/:id/status
router.patch('/tickets/:id/status', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const { status, assignee, reason } = req.body as Record<string, unknown>
    if (!status) { res.status(422).json({ error: 'validation', message: 'status required' }); return }
    const ticket = await updateTicketStatus(tenantId, req.params.id as string, status as never, { assignee: assignee as string, reason: reason as string })
    res.json(ticket)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// POST /enterprise/tickets/:id/escalate
router.post('/tickets/:id/escalate', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const { reason } = req.body as Record<string, unknown>
    const ticket = await escalateTicket(tenantId, req.params.id as string, String(reason ?? 'Escalated'))
    res.json(ticket)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// ─── Compliance Exports ───────────────────────────────────────────────────────

// POST /enterprise/exports
router.post('/exports', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const exportRec = await requestExport(tenantId, req.body as never)
    res.status(201).json(exportRec)
  } catch (err) {
    const msg = String(err)
    if (msg.includes('not enabled')) { res.status(403).json({ error: 'feature_gate', message: msg }); return }
    res.status(500).json({ error: 'internal', message: msg })
  }
})

// GET /enterprise/exports
router.get('/exports', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const { status, limit } = req.query as Record<string, string>
    const exports = await listExports(tenantId, { status: status as never, limit: limit != null ? Number(limit) : undefined })
    res.json(exports)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/exports/:id
router.get('/exports/:id', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const exportRec = await getExport(tenantId, req.params.id as string)
    if (exportRec == null) { res.status(404).json({ error: 'not_found' }); return }
    res.json(exportRec)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// ─── Deployment Health ────────────────────────────────────────────────────────
// AUDIT-P1-01: these were requireAuth-only — any authenticated user of any
// tenant could trigger platform-wide health checks or provision/reset demo
// tenants. Same bug class as AUD-001 above (missing authorization, not
// missing authentication); requirePlatformAdmin was already defined for the
// lifecycle routes but these were missed in that hardening pass.

// GET /enterprise/deployment/health
router.get('/deployment/health', requireAuth, requirePlatformAdmin, async (_req: Request, res: Response) => {
  try {
    const report = await generateHealthReport()
    res.json(report)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// POST /enterprise/deployment/health/run
router.post('/deployment/health/run', requireAuth, requirePlatformAdmin, async (_req: Request, res: Response) => {
  try {
    const report = await runPlatformChecks()
    res.json(report)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// POST /enterprise/deployment/health/check
router.post('/deployment/health/check', requireAuth, requirePlatformAdmin, async (req: Request, res: Response) => {
  try {
    const check = await recordHealthCheck(req.body as never)
    res.status(201).json(check)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// ─── Demo Tenants ─────────────────────────────────────────────────────────────

// POST /enterprise/demo
router.post('/demo', requireAuth, requirePlatformAdmin, async (req: Request, res: Response) => {
  try {
    const { templateKey, createdBy } = req.body as Record<string, unknown>
    if (!templateKey) { res.status(422).json({ error: 'validation', message: 'templateKey required' }); return }
    const demo = await createDemoTenant(String(templateKey), { createdBy: createdBy as string })
    res.status(201).json(demo)
  } catch (err) {
    const msg = String(err)
    if (msg.includes('Unknown demo template')) { res.status(422).json({ error: 'validation', message: msg }); return }
    res.status(500).json({ error: 'internal', message: msg })
  }
})

// GET /enterprise/demo
router.get('/demo', requireAuth, requirePlatformAdmin, async (req: Request, res: Response) => {
  try {
    const { industry, status } = req.query as Record<string, string>
    const demos = await listDemoTenants({ industry, status })
    res.json(demos)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// POST /enterprise/demo/:tenantId/reset
router.post('/demo/:tenantId/reset', requireAuth, requirePlatformAdmin, async (req: Request, res: Response) => {
  try {
    const demo = await resetDemoTenant(req.params.tenantId as string)
    res.json(demo)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// ─── API Keys ─────────────────────────────────────────────────────────────────

// POST /enterprise/api-keys
router.post('/api-keys', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const result = await createApiKey(tenantId, req.body as never)
    res.status(201).json(result)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// GET /enterprise/api-keys
router.get('/api-keys', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const { status, limit } = req.query as Record<string, string>
    const keys = await listApiKeys(tenantId, { status: status as never, limit: limit != null ? Number(limit) : undefined })
    res.json(keys)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

// DELETE /enterprise/api-keys/:id
router.delete('/api-keys/:id', requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const tenantId = (req as unknown as Req).tenantId!
    const { revokedBy } = req.body as Record<string, unknown>
    const key = await revokeApiKey(tenantId, req.params.id as string, revokedBy as string)
    res.json(key)
  } catch (err) {
    res.status(500).json({ error: 'internal', message: String(err) })
  }
})

export default router
