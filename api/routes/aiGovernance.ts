/**
 * Denver Engineering — AI Governance Routes (v4.40.0)
 * ──────────────────────────────────────────────────────
 * Ava Phase 4 — Human-in-the-loop AI recommendation approval queue.
 */

import { Router, Request, Response } from 'express'
import { requireAuth, type AuthenticatedRequest } from '../auth'
import { TenantRequest } from '../middleware/tenant'
import { requireCapability } from '../authz/requireCapability'
import {
  listPendingRecommendations,
  queueRecommendation,
  approveRecommendation,
  rejectRecommendation,
  executeRecommendation,
  previewRecommendation,
  expireStaleRecommendations,
} from '../services/ai/aiGovernance'

export const aiGovernanceRouter = Router()
const auth = requireAuth as never
type AiReq = Request & AuthenticatedRequest & TenantRequest

aiGovernanceRouter.use(auth)

// ─── List pending recommendations ────────────────────────────────────────────
aiGovernanceRouter.get('/recommendations', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  const r = req as AiReq
  const limit = Math.min(Number(req.query['limit'] ?? 50), 200)
  const recs = await listPendingRecommendations(r.tenantId!, limit)
  res.json({ data: recs })
})

// ─── Queue recommendation (internal / testing) ────────────────────────────────
aiGovernanceRouter.post('/recommendations', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  const r = req as AiReq
  const { action_id, recommended_action, category, confidence_score, impact_score,
          urgency_score, reason, data_signals, affected_entities, rollback_plan,
          approval_required, generated_by } = req.body
  if (!recommended_action || !category || confidence_score === undefined ||
      impact_score === undefined || urgency_score === undefined || !reason) {
    res.status(400).json({ error: 'required fields missing' }); return
  }
  const result = await queueRecommendation({
    tenantId: r.tenantId!, actionId: action_id, recommendedAction: recommended_action,
    category, confidenceScore: confidence_score, impactScore: impact_score,
    urgencyScore: urgency_score, reason, dataSignals: data_signals,
    affectedEntities: affected_entities, rollbackPlan: rollback_plan,
    approvalRequired: approval_required, generatedBy: generated_by,
  })
  res.status(201).json({ data: result })
})

// ─── Preview recommendation ───────────────────────────────────────────────────
aiGovernanceRouter.get('/recommendations/:id/preview', requireCapability('crossdomain.read') as never, async (req: Request, res: Response) => {
  const r = req as AiReq
  try {
    const preview = await previewRecommendation(r.tenantId!, req.params['id'] as string)
    res.json({ data: preview })
  } catch (err) {
    res.status(404).json({ error: 'Recommendation not found' })
  }
})

// ─── Approve recommendation ───────────────────────────────────────────────────
aiGovernanceRouter.post('/recommendations/:id/approve', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  const r = req as AiReq
  const ok = await approveRecommendation(r.tenantId!, req.params['id'] as string, r.auth!.sub)
  if (!ok) { res.status(404).json({ error: 'Not found or not pending' }); return }
  res.json({ data: { approved: true } })
})

// ─── Reject recommendation ────────────────────────────────────────────────────
aiGovernanceRouter.post('/recommendations/:id/reject', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  const r = req as AiReq
  const { reason } = req.body
  const ok = await rejectRecommendation(r.tenantId!, req.params['id'] as string, r.auth!.sub, reason)
  if (!ok) { res.status(404).json({ error: 'Not found or not pending' }); return }
  res.json({ data: { rejected: true } })
})

// ─── Execute recommendation ───────────────────────────────────────────────────
aiGovernanceRouter.post('/recommendations/:id/execute', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  const r = req as AiReq
  const result = await executeRecommendation(r.tenantId!, req.params['id'] as string, r.auth!.sub)
  if (!result.executed) {
    res.status(400).json({ error: 'Cannot execute', detail: result.output }); return
  }
  res.json({ data: result })
})

// ─── Expire stale recommendations ────────────────────────────────────────────
aiGovernanceRouter.post('/recommendations/expire', requireCapability('ai.govern') as never, async (req: Request, res: Response) => {
  const r = req as AiReq
  const expired = await expireStaleRecommendations(r.tenantId!)
  res.json({ data: { expired } })
})
