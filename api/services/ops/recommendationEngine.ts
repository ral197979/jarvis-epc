/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Denver Engineering — AI Next-Best-Action Engine (v4.35.0)
 * ──────────────────────────────────────────────────────────
 * Ava Phase 3 — Rule-based operational recommendation layer.
 * Deterministic. Explainable. No LLM in Phase 3.
 *
 * Provider-agnostic: register an LLMRecommendationProvider in Phase 4
 * to upgrade recommendations without changing callers.
 */
import { pool } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecommendationInput {
  actionId:         string
  actionTitle:      string
  actionType:       string
  priority:         string
  status:           string
  escalationLevel:  number
  slaRemainingMins: number | null
  downstreamCount:  number
  workloadScore:    number  // 0-100: assignee workload pressure
  reopenCount:      number
  readinessImpact:  number  // 0-100: how much this blocks readiness
  projectPhase?:    string
}

export interface Recommendation {
  action_id:          string
  recommended_action: string
  recommendation_reason: string
  impact_score:       number  // 0-100
  urgency_score:      number  // 0-100
  confidence_score:   number  // 0-100
  category:           string
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface RecommendationProvider {
  name: string
  rerank(inputs: RecommendationInput[], recs: Recommendation[]): Promise<Recommendation[]>
}

let _provider: RecommendationProvider | null = null

export function registerRecommendationProvider(p: RecommendationProvider): void {
  _provider = p
}

// ─── Rule definitions ─────────────────────────────────────────────────────────

interface Rule {
  id:       string
  category: string
  matches:  (i: RecommendationInput) => boolean
  build:    (i: RecommendationInput) => Omit<Recommendation, 'action_id'>
}

const RULES: Rule[] = [
  {
    id: 'escalate_manual',
    category: 'escalation',
    matches: (i) => (i.slaRemainingMins !== null && i.slaRemainingMins < 120)
                    && i.escalationLevel < 2,
    build: (i) => ({
      recommended_action:    'escalate',
      recommendation_reason: `Action "${i.actionTitle}" is within 2h of SLA breach and has not yet been escalated to L2.`,
      impact_score:          85,
      urgency_score:         90,
      confidence_score:      92,
      category:              'escalation',
    }),
  },
  {
    id: 'reassign_overloaded',
    category: 'workload',
    matches: (i) => i.workloadScore >= 80 && i.status === 'open',
    build: (i) => ({
      recommended_action:    'reassign',
      recommendation_reason: `Assignee workload is critically high. Reassigning "${i.actionTitle}" could prevent SLA breach.`,
      impact_score:          70,
      urgency_score:         65,
      confidence_score:      78,
      category:              'workload',
    }),
  },
  {
    id: 'resolve_to_unblock',
    category: 'dependency',
    matches: (i) => i.downstreamCount >= 2 && i.status === 'open',
    build: (i) => ({
      recommended_action:    'prioritize',
      recommendation_reason: `Resolving "${i.actionTitle}" will unblock ${i.downstreamCount} downstream action${i.downstreamCount > 1 ? 's' : ''}.`,
      impact_score:          Math.min(100, 50 + i.downstreamCount * 8),
      urgency_score:         i.slaRemainingMins !== null && i.slaRemainingMins < 480 ? 85 : 60,
      confidence_score:      88,
      category:              'dependency',
    }),
  },
  {
    id: 'close_duplicate_cluster',
    category: 'cleanup',
    matches: (i) => i.reopenCount >= 2,
    build: (i) => ({
      recommended_action:    'review_duplicates',
      recommendation_reason: `"${i.actionTitle}" has been reopened ${i.reopenCount} times. Review for duplicate or systematic issue.`,
      impact_score:          45,
      urgency_score:         40,
      confidence_score:      72,
      category:              'cleanup',
    }),
  },
  {
    id: 'compliance_priority',
    category: 'compliance',
    matches: (i) => i.actionType === 'COMPLIANCE_TASK' && i.status === 'open',
    build: (i) => ({
      recommended_action:    'prioritize',
      recommendation_reason: `Compliance task "${i.actionTitle}" requires timely resolution to avoid regulatory exposure.`,
      impact_score:          90,
      urgency_score:         i.slaRemainingMins !== null && i.slaRemainingMins < 0 ? 100 : 75,
      confidence_score:      95,
      category:              'compliance',
    }),
  },
  {
    id: 'readiness_blocker',
    category: 'readiness',
    matches: (i) => i.readinessImpact >= 70,
    build: (i) => ({
      recommended_action:    'prioritize',
      recommendation_reason: `"${i.actionTitle}" is blocking project readiness scoring. Resolving it will significantly improve readiness.`,
      impact_score:          i.readinessImpact,
      urgency_score:         75,
      confidence_score:      85,
      category:              'readiness',
    }),
  },
  {
    id: 'pause_sla_blocked',
    category: 'sla',
    matches: (i) => i.downstreamCount > 0
                    && i.slaRemainingMins !== null
                    && i.slaRemainingMins < 120
                    && i.slaRemainingMins > 0,
    build: (i) => ({
      recommended_action:    'pause_sla',
      recommendation_reason: `"${i.actionTitle}" has downstream blockers and is approaching SLA. Pausing SLA prevents false breach.`,
      impact_score:          60,
      urgency_score:         80,
      confidence_score:      75,
      category:              'sla',
    }),
  },
]

// ─── Generate recommendations for a set of inputs ───────────────────────────

export function generateRecommendations(inputs: RecommendationInput[]): Recommendation[] {
  const recs: Recommendation[] = []

  for (const input of inputs) {
    // Apply all matching rules — collect all that fire
    const matching = RULES.filter(r => r.matches(input))
    for (const rule of matching) {
      recs.push({ ...rule.build(input), action_id: input.actionId })
    }
  }

  // Sort by urgency_score descending
  recs.sort((a, b) => b.urgency_score - a.urgency_score)
  return recs
}

// ─── Main public function with provider reranking ────────────────────────────

export async function generateInboxRecommendations(
  inputs: RecommendationInput[],
): Promise<{
  recommendations: Recommendation[]
  high_impact:     Recommendation[]
}> {
  let recs = generateRecommendations(inputs)

  // If a provider is registered, let it rerank
  if (_provider) {
    try {
      recs = await _provider.rerank(inputs, recs)
    } catch {
      // Fall back to deterministic order
    }
  }

  // Sort by urgency_score desc
  recs.sort((a, b) => b.urgency_score - a.urgency_score)

  return {
    recommendations: recs,
    high_impact:     recs.filter(r => r.impact_score >= 75),
  }
}

// ─── Assignee suggestion ─────────────────────────────────────────────────────

export async function suggestAssignee(
  tenantId:   string,
  actionType: string,
  projectId?: string,
): Promise<string | null> {
  try {
    const res = await pool.query(`
      SELECT
        a.assigned_to_user_id,
        u.email,
        COUNT(*) FILTER (WHERE a.status NOT IN ('completed','cancelled')) AS open_count,
        COUNT(*) FILTER (WHERE a.due_at < NOW() AND a.status NOT IN ('completed','cancelled')) AS overdue_count
      FROM actions a
      JOIN users u ON u.id = a.assigned_to_user_id
      WHERE a.tenant_id = $1
        AND a.assigned_to_user_id IS NOT NULL
        AND ($3::uuid IS NULL OR a.project_id = $3)
      GROUP BY a.assigned_to_user_id, u.email
      ORDER BY open_count ASC, overdue_count ASC
      LIMIT 1
    `, [tenantId, actionType, projectId ?? null])
    return res.rows[0]?.email ?? null
  } catch {
    return null
  }
}

// ─── Fetch recommendation inputs from DB ──────────────────────────────────────

export async function fetchRecommendationInputs(
  tenantId:  string,
  projectId?: string,
  limit      = 50,
): Promise<RecommendationInput[]> {
  const res = await pool.query(`
    SELECT
      a.id, a.title, a.action_type, a.priority, a.status,
      COALESCE(a.max_escalation_level, 0) AS escalation_level,
      s.remaining_minutes AS sla_remaining_mins,
      COALESCE((
        SELECT COUNT(*) FROM action_relations ar
        WHERE ar.source_action_id = a.id AND ar.deleted_at IS NULL
          AND ar.relation_type IN ('blocks','caused_by','spawned_from')
      ), 0) AS downstream_count,
      0 AS reopen_count,
      0 AS workload_score,
      0 AS readiness_impact
    FROM actions a
    LEFT JOIN action_sla_state s ON s.action_id = a.id AND s.tenant_id = a.tenant_id
    WHERE a.tenant_id = $1
      AND a.status NOT IN ('completed','cancelled')
      AND ($2::uuid IS NULL OR a.project_id = $2)
    ORDER BY a.due_at ASC NULLS LAST
    LIMIT $3
  `, [tenantId, projectId ?? null, limit])

  return res.rows.map(r => ({
    actionId:         r.id,
    actionTitle:      r.title,
    actionType:       r.action_type,
    priority:         r.priority,
    status:           r.status,
    escalationLevel:  Number(r.escalation_level),
    slaRemainingMins: r.sla_remaining_mins !== null ? Number(r.sla_remaining_mins) : null,
    downstreamCount:  Number(r.downstream_count),
    workloadScore:    Number(r.workload_score),
    reopenCount:      Number(r.reopen_count),
    readinessImpact:  Number(r.readiness_impact),
  }))
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = { RULES, generateRecommendations }
