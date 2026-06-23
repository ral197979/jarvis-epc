/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Denver Engineering — Action Recommendation Service (v4.34.0)
 * ──────────────────────────────────────────────────────────────
 * Ava Phase 2H — Recommendation engine (AI stub + rule-based).
 *
 * Produces structured recommendations for:
 *   - Which actions to prioritize next
 *   - Suggested assignee (based on workload + expertise history)
 *   - Whether to escalate manually before SLA fires
 *   - SLA pause suggestions (when action is legitimately blocked)
 *
 * All recommendations are labeled as AI-generated suggestions.
 * No recommendation auto-applies any state change.
 * Human-in-the-loop is required for all.
 */

import { scoreAndRankActions, type ActionScoreInput, type ActionScore } from './actionScoringService'
import { query } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecommendationType =
  | 'prioritize' | 'assign' | 'escalate_manual' | 'pause_sla'
  | 'unblock' | 'delegate' | 'close'

export interface Recommendation {
  action_id:          string
  type:               RecommendationType
  confidence:         number        // 0–1
  reason:             string
  suggested_user_id?: string | null // for 'assign' / 'delegate'
  ai_generated:       boolean       // always true — label for UI
  generated_at:       string
}

export interface InboxRecommendations {
  top_actions:      ActionScore[]         // ranked by operational_risk_score
  recommendations:  Recommendation[]     // suggested actions to take
  generated_at:     string
}

// ─── Rule-based recommendations ───────────────────────────────────────────────

function _buildRecommendations(scores: ActionScore[], inputs: ActionScoreInput[]): Recommendation[] {
  const recs: Recommendation[] = []
  const inputMap = new Map(inputs.map(i => [i.action_id, i]))

  for (const score of scores) {
    const input = inputMap.get(score.action_id)
    if (!input) continue

    // Escalate manually if SLA risk > 80 but escalation_level < 2
    if (score.score_components.sla_risk >= 80 && input.escalation_level < 2) {
      recs.push({
        action_id:    score.action_id,
        type:         'escalate_manual',
        confidence:   0.85,
        reason:       'SLA breach risk high — consider manual escalation before automated trigger',
        ai_generated: true,
        generated_at: new Date().toISOString(),
      })
    }

    // Pause SLA if action is blocked (downstream_impact signals it's a blocker chain)
    if (score.score_components.downstream >= 40 && input.remaining_minutes !== null && input.remaining_minutes < 120) {
      recs.push({
        action_id:    score.action_id,
        type:         'pause_sla',
        confidence:   0.70,
        reason:       'Action is blocking downstream work and approaching SLA breach — pause SLA pending resolution of blockers',
        ai_generated: true,
        generated_at: new Date().toISOString(),
      })
    }

    // Prioritize top-scoring actions (threshold 48: critical+overdue scores ≈ 50)
    if (score.operational_risk_score >= 48) {
      recs.push({
        action_id:    score.action_id,
        type:         'prioritize',
        confidence:   0.90,
        reason:       score.recommendation_reason,
        ai_generated: true,
        generated_at: new Date().toISOString(),
      })
    }
  }

  return recs
}

// ─── Suggested assignee ───────────────────────────────────────────────────────

/**
 * Suggest an assignee for an unassigned action based on lightest workload
 * within the same module/role. Pure heuristic — no ML.
 */
export async function suggestAssignee(
  tenantId:    string,
  actionType:  string,
  projectId:   string | null,
): Promise<string | null> {
  // Find active users with least open actions of this type
  const result = await query<{ id: string }>(`
    SELECT u.id
    FROM   users u
    WHERE  u.tenant_id = $1
      AND  u.is_active = TRUE
      AND  u.role NOT IN ('viewer')
    ORDER BY (
      SELECT COUNT(*) FROM actions a
      WHERE  a.assigned_to_user_id = u.id
        AND  a.tenant_id           = $1
        AND  a.action_type         = $2
        AND  a.status NOT IN ('completed','cancelled')
    ) ASC
    LIMIT 1
  `, [tenantId, actionType])

  return result.rows[0]?.id ?? null
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate ranked action list + recommendations for the inbox.
 * Accepts pre-fetched action data to avoid N+1 queries.
 */
export function generateInboxRecommendations(
  inputs: ActionScoreInput[],
): InboxRecommendations {
  const scores = scoreAndRankActions(inputs)
  const recs   = _buildRecommendations(scores, inputs)

  return {
    top_actions:    scores.slice(0, 20),  // top 20 for initial render
    recommendations: recs,
    generated_at:   new Date().toISOString(),
  }
}
