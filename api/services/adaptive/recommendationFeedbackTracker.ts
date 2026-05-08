// Denver Engineering — Recommendation Feedback Tracker (v7.0.0)
// Records and queries recommendation effectiveness outcomes.

import { tenantQuery } from '../../db/pool'
import {
  RecommendationOutcome, RecordOutcomeInput,
  FeedbackOutcome,
} from './adaptiveTypes'

// ─── Record outcome ───────────────────────────────────────────────────────────

export async function recordOutcome(
  tenantId: string,
  input: RecordOutcomeInput,
): Promise<RecommendationOutcome> {
  const {
    recommendationId, recommendationType, agentType,
    entityId, entityType, outcome, effectivenessScore,
    beforeState, afterState, notes,
  } = input

  const measuredAt = effectivenessScore != null ? new Date() : null

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO recommendation_outcomes
      (tenant_id, recommendation_id, recommendation_type, agent_type,
       entity_id, entity_type, outcome, effectiveness_score,
       before_state, after_state, measured_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      tenantId, recommendationId, recommendationType, agentType,
      entityId ?? null, entityType ?? null, outcome,
      effectivenessScore != null ? effectivenessScore : null,
      beforeState != null ? JSON.stringify(beforeState) : null,
      afterState != null ? JSON.stringify(afterState) : null,
      measuredAt, notes ?? null,
    ],
  )
  return _mapOutcome(res.rows[0])
}

// ─── Update outcome measurement ───────────────────────────────────────────────

export async function updateOutcomeMeasurement(
  tenantId: string,
  outcomeId: string,
  effectivenessScore: number,
  afterState?: Record<string, unknown>,
): Promise<RecommendationOutcome> {
  const res = await tenantQuery(
    tenantId,
    `UPDATE recommendation_outcomes
     SET effectiveness_score = $2,
         after_state = COALESCE($3::jsonb, after_state),
         measured_at = now(),
         updated_at = now()
     WHERE tenant_id = $1 AND id = $4
     RETURNING *`,
    [
      tenantId,
      effectivenessScore,
      afterState != null ? JSON.stringify(afterState) : null,
      outcomeId,
    ],
  )
  if (res.rows.length === 0) throw new Error(`Outcome ${outcomeId} not found`)
  return _mapOutcome(res.rows[0])
}

// ─── Get outcomes by recommendation ──────────────────────────────────────────

export async function getOutcomesByRecommendation(
  tenantId: string,
  recommendationId: string,
): Promise<RecommendationOutcome[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM recommendation_outcomes
     WHERE tenant_id = $1 AND recommendation_id = $2
     ORDER BY created_at DESC`,
    [tenantId, recommendationId],
  )
  return res.rows.map(_mapOutcome)
}

// ─── Get effectiveness by agent ───────────────────────────────────────────────

export interface AgentEffectivenessReport {
  agentType: string
  totalOutcomes: number
  measuredOutcomes: number
  avgEffectiveness: number
  acceptanceRate: number
  rejectionRate: number
}

export async function getAgentEffectiveness(
  tenantId: string,
  windowDays = 30,
): Promise<AgentEffectivenessReport[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT
       agent_type,
       COUNT(*)::int AS total,
       COUNT(effectiveness_score)::int AS measured,
       COALESCE(AVG(effectiveness_score), 0)::float AS avg_eff,
       COALESCE(
         SUM(CASE WHEN outcome IN ('accepted','partially_accepted') THEN 1 ELSE 0 END)::float
         / NULLIF(COUNT(*), 0), 0
       )::float AS acceptance_rate,
       COALESCE(
         SUM(CASE WHEN outcome = 'rejected' THEN 1 ELSE 0 END)::float
         / NULLIF(COUNT(*), 0), 0
       )::float AS rejection_rate
     FROM recommendation_outcomes
     WHERE tenant_id = $1
       AND created_at >= now() - ($2 || ' days')::interval
     GROUP BY agent_type
     ORDER BY avg_eff DESC`,
    [tenantId, windowDays],
  )

  return res.rows.map(row => ({
    agentType: row.agent_type as string,
    totalOutcomes: Number(row.total),
    measuredOutcomes: Number(row.measured),
    avgEffectiveness: Number(row.avg_eff),
    acceptanceRate: Number(row.acceptance_rate),
    rejectionRate: Number(row.rejection_rate),
  }))
}

// ─── Get top effective recommendations ───────────────────────────────────────

export async function getTopEffectiveOutcomes(
  tenantId: string,
  limit = 10,
): Promise<RecommendationOutcome[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM recommendation_outcomes
     WHERE tenant_id = $1
       AND effectiveness_score IS NOT NULL
     ORDER BY effectiveness_score DESC
     LIMIT $2`,
    [tenantId, limit],
  )
  return res.rows.map(_mapOutcome)
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function _mapOutcome(row: Record<string, unknown>): RecommendationOutcome {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    recommendationId: row.recommendation_id as string,
    recommendationType: row.recommendation_type as string,
    agentType: row.agent_type as string,
    entityId: row.entity_id != null ? String(row.entity_id) : undefined,
    entityType: row.entity_type != null ? String(row.entity_type) : undefined,
    outcome: row.outcome as FeedbackOutcome,
    effectivenessScore: row.effectiveness_score != null ? Number(row.effectiveness_score) : undefined,
    beforeState: row.before_state != null ? row.before_state as Record<string, unknown> : undefined,
    afterState: row.after_state != null ? row.after_state as Record<string, unknown> : undefined,
    measuredAt: row.measured_at != null ? new Date(row.measured_at as string) : undefined,
    feedbackLagMs: row.feedback_lag_ms != null ? Number(row.feedback_lag_ms) : undefined,
    notes: row.notes != null ? String(row.notes) : undefined,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

export const __testHooks = { _mapOutcome }
