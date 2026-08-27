/**
 * Denver Engineering — AI Execution Governance (v4.40.0)
 * ────────────────────────────────────────────────────────
 * Ava Phase 4 — Human-in-the-loop AI recommendation approval.
 * Every AI-suggested operational action must pass through this
 * queue. No autonomous execution without explicit human approval.
 *
 * Non-negotiable rules:
 * - approval_required defaults to true
 * - All approvals / rejections / executions are immutable audit events
 * - Confidence below min threshold → auto-reject
 * - Preview returns projected impact without any mutation
 * - Execution gated by approved status check
 */

import { tenantQuery } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QueuedRecommendation {
  id:                  string
  tenantId:            string
  actionId?:           string
  recommendedAction:   string
  category:            string
  confidenceScore:     number
  impactScore:         number
  urgencyScore:        number
  reason:              string
  dataSignals:         string[]
  affectedEntities:    AffectedEntity[]
  rollbackPlan:        Record<string, unknown>
  approvalRequired:    boolean
  status:              string
  generatedBy:         string
  previewData:         Record<string, unknown>
  expiresAt:           string
}

export interface AffectedEntity {
  entity_type: string
  entity_id:   string
  impact:      string
}

export interface QueueInput {
  tenantId:          string
  actionId?:         string
  recommendedAction: string
  category:          string
  confidenceScore:   number
  impactScore:       number
  urgencyScore:      number
  reason:            string
  dataSignals?:      string[]
  affectedEntities?: AffectedEntity[]
  rollbackPlan?:     Record<string, unknown>
  approvalRequired?: boolean
  generatedBy?:      string
  minConfidenceThreshold?: number
}

// ─── Default Configuration ────────────────────────────────────────────────────

export const DEFAULT_CONFIDENCE_THRESHOLD = 70
export const DEFAULT_APPROVAL_REQUIRED    = true

// ─── Queue Recommendation ─────────────────────────────────────────────────────

export async function queueRecommendation(
  input: QueueInput
): Promise<{ recommendationId: string; autoRejected: boolean }> {
  const threshold = input.minConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD

  // Auto-reject below confidence threshold before persisting
  if (input.confidenceScore < threshold) {
    const { rows } = await tenantQuery(input.tenantId, `
      INSERT INTO ai_recommendation_queue
        (tenant_id, action_id, recommended_action, category,
         confidence_score, impact_score, urgency_score, reason,
         data_signals, affected_entities, rollback_plan, approval_required,
         generated_by, min_confidence_threshold, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,'rejected')
      RETURNING id
    `, [input.tenantId, input.actionId ?? null, input.recommendedAction, input.category,
        input.confidenceScore, input.impactScore, input.urgencyScore, input.reason,
        JSON.stringify(input.dataSignals ?? []),
        JSON.stringify(input.affectedEntities ?? []),
        JSON.stringify(input.rollbackPlan ?? {}),
        input.approvalRequired ?? DEFAULT_APPROVAL_REQUIRED,
        input.generatedBy ?? 'rule_engine', threshold])
    const id = rows[0]!.id as string
    await _appendAuditEvent(input.tenantId, id, 'queued', 'system',
      { auto_rejected: true, reason: `confidence ${input.confidenceScore} < threshold ${threshold}` })
    return { recommendationId: id, autoRejected: true }
  }

  const { rows } = await tenantQuery(input.tenantId, `
    INSERT INTO ai_recommendation_queue
      (tenant_id, action_id, recommended_action, category,
       confidence_score, impact_score, urgency_score, reason,
       data_signals, affected_entities, rollback_plan, approval_required,
       generated_by, min_confidence_threshold)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14)
    RETURNING id
  `, [input.tenantId, input.actionId ?? null, input.recommendedAction, input.category,
      input.confidenceScore, input.impactScore, input.urgencyScore, input.reason,
      JSON.stringify(input.dataSignals ?? []),
      JSON.stringify(input.affectedEntities ?? []),
      JSON.stringify(input.rollbackPlan ?? {}),
      input.approvalRequired ?? DEFAULT_APPROVAL_REQUIRED,
      input.generatedBy ?? 'rule_engine', threshold])

  const id = rows[0]!.id as string
  await _appendAuditEvent(input.tenantId, id, 'queued', 'system', {})
  return { recommendationId: id, autoRejected: false }
}

// ─── Preview (no mutations) ───────────────────────────────────────────────────

export async function previewRecommendation(
  tenantId: string,
  recommendationId: string
): Promise<Record<string, unknown>> {
  const { rows } = await tenantQuery(tenantId, `
    SELECT recommended_action, affected_entities, rollback_plan,
           confidence_score, impact_score, urgency_score, reason, data_signals
    FROM ai_recommendation_queue
    WHERE id = $1 AND tenant_id = $2
  `, [recommendationId, tenantId])
  if (!rows[0]) throw new Error(`Recommendation ${recommendationId} not found`)

  const rec = rows[0]
  // Build projected impact summary without touching production tables
  const preview: Record<string, unknown> = {
    recommendation_id:  recommendationId,
    recommended_action: rec.recommended_action,
    projected_impact: {
      affected_count:  (rec.affected_entities as AffectedEntity[]).length,
      affected_entities: rec.affected_entities,
      impact_score:    rec.impact_score,
      urgency_score:   rec.urgency_score,
    },
    rollback_plan:  rec.rollback_plan,
    data_signals:   rec.data_signals,
    reason:         rec.reason,
    confidence:     rec.confidence_score,
  }

  await _appendAuditEvent(tenantId, recommendationId, 'previewed', 'system', { preview_generated: true })
  return preview
}

// ─── Approve ──────────────────────────────────────────────────────────────────

export async function approveRecommendation(
  tenantId: string,
  recommendationId: string,
  approvedBy: string
): Promise<boolean> {
  const { rows } = await tenantQuery(tenantId, `
    UPDATE ai_recommendation_queue
    SET status = 'approved', approved_by = $1, reviewed_by = $1, reviewed_at = now()
    WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
    RETURNING id
  `, [approvedBy, recommendationId, tenantId])
  if (!rows[0]) return false
  await _appendAuditEvent(tenantId, recommendationId, 'approved', approvedBy, {})
  return true
}

// ─── Reject ───────────────────────────────────────────────────────────────────

export async function rejectRecommendation(
  tenantId: string,
  recommendationId: string,
  rejectedBy: string,
  reason?: string
): Promise<boolean> {
  const { rows } = await tenantQuery(tenantId, `
    UPDATE ai_recommendation_queue
    SET status = 'rejected', reviewed_by = $1, reviewed_at = now(), rejection_reason = $2
    WHERE id = $3 AND tenant_id = $4 AND status = 'pending'
    RETURNING id
  `, [rejectedBy, reason ?? null, recommendationId, tenantId])
  if (!rows[0]) return false
  await _appendAuditEvent(tenantId, recommendationId, 'rejected', rejectedBy, { reason })
  return true
}

// ─── Execute (requires approved status) ──────────────────────────────────────

export async function executeRecommendation(
  tenantId: string,
  recommendationId: string,
  executedBy: string
): Promise<{ executed: boolean; output: Record<string, unknown> }> {
  // Verify approved status — gate enforced in DB check
  const { rows } = await tenantQuery(tenantId, `
    SELECT recommended_action, action_id, approval_required, status
    FROM ai_recommendation_queue
    WHERE id = $1 AND tenant_id = $2
  `, [recommendationId, tenantId])

  if (!rows[0]) return { executed: false, output: { error: 'not_found' } }
  const rec = rows[0]

  if (rec.approval_required && rec.status !== 'approved') {
    return { executed: false, output: { error: 'approval_required', current_status: rec.status } }
  }

  if (rec.status === 'executed') {
    return { executed: false, output: { error: 'already_executed' } }
  }

  // Mark as executing
  await tenantQuery(tenantId, `
    UPDATE ai_recommendation_queue
    SET status = 'executed', executed_by = $1, executed_at = now()
    WHERE id = $2 AND tenant_id = $3
  `, [executedBy, recommendationId, tenantId])

  await _appendAuditEvent(tenantId, recommendationId, 'executed', executedBy,
    { action_id: rec.action_id, recommended_action: rec.recommended_action })

  return { executed: true, output: { recommendation_id: recommendationId, action_id: rec.action_id } }
}

// ─── Expire Stale Recommendations ────────────────────────────────────────────

export async function expireStaleRecommendations(tenantId: string): Promise<number> {
  const { rows } = await tenantQuery(tenantId, `
    UPDATE ai_recommendation_queue
    SET status = 'expired'
    WHERE tenant_id = $1 AND status = 'pending' AND expires_at < now()
    RETURNING id
  `, [tenantId])
  for (const row of rows) {
    await _appendAuditEvent(tenantId, row.id as string, 'expired', 'system', {})
  }
  return rows.length
}

// ─── List Pending ─────────────────────────────────────────────────────────────

/**
 * Governance columns — what a recommendation IS, not what it is about.
 *
 * Enough to run the approval queue: which recommendation, what class of action,
 * how confident, how urgent, what state, who decided and when.
 */
const RECOMMENDATION_GOVERNANCE_COLUMNS = [
  'id', 'action_id', 'recommended_action', 'category', 'status',
  'confidence_score', 'impact_score', 'urgency_score', 'min_confidence_threshold',
  'approval_required', 'generated_by', 'generated_at', 'expires_at',
  'reviewed_by', 'approved_by', 'executed_by', 'rejection_reason',
  'reviewed_at', 'executed_at',
] as const

/**
 * Columns that carry the tenant's BUSINESS data rather than the AI decision.
 *
 * `affected_entities` names the records the action would touch, `data_signals`
 * and `reason` are the operational evidence it was derived from, and
 * `rollback_plan`/`preview_data` describe the projected effect on real rows.
 *
 * These are exactly the fields `previewRecommendation` returns, and that
 * endpoint requires `crossdomain.read`. Before ADR-014 Phase 3I this function
 * issued `SELECT *`, so `GET /ai/recommendations` handed every one of them —
 * for every pending recommendation in the tenant — to any `ai.govern` holder,
 * which includes the platform administrator. The list was a strictly larger
 * disclosure than the endpoint deliberately gated above it.
 */
const RECOMMENDATION_BUSINESS_COLUMNS = [
  'reason', 'data_signals', 'affected_entities', 'rollback_plan', 'preview_data',
] as const

export async function listPendingRecommendations(
  tenantId: string,
  limit = 50,
  includeBusinessPayload = false,
): Promise<unknown[]> {
  // Both lists are literals from this module; nothing here comes from a request.
  const columns = includeBusinessPayload
    ? [...RECOMMENDATION_GOVERNANCE_COLUMNS, ...RECOMMENDATION_BUSINESS_COLUMNS]
    : RECOMMENDATION_GOVERNANCE_COLUMNS
  const { rows } = await tenantQuery(tenantId, `
    SELECT ${columns.join(', ')} FROM ai_recommendation_queue
    WHERE tenant_id = $1 AND status = 'pending' AND expires_at > now()
    ORDER BY urgency_score DESC, generated_at ASC
    LIMIT $2
  `, [tenantId, limit])
  return rows
}

export const __recommendationColumns = {
  governance: RECOMMENDATION_GOVERNANCE_COLUMNS,
  business:   RECOMMENDATION_BUSINESS_COLUMNS,
}

// ─── Audit Helper ─────────────────────────────────────────────────────────────

async function _appendAuditEvent(
  tenantId: string,
  recommendationId: string,
  eventType: string,
  actorId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await tenantQuery(tenantId, `
    INSERT INTO ai_approval_events
      (tenant_id, recommendation_id, event_type, actor_id, metadata)
    VALUES ($1,$2,$3,$4,$5::jsonb)
  `, [tenantId, recommendationId, eventType, actorId, JSON.stringify(metadata)])
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  queueRecommendation,
  previewRecommendation,
  approveRecommendation,
  rejectRecommendation,
  executeRecommendation,
  expireStaleRecommendations,
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_APPROVAL_REQUIRED,
}
