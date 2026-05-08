/**
 * Denver Engineering — Agent Action Log (v4.31.0)
 *
 * Thin wrapper over the `agent_actions` table. Every automated decision
 * writes one row: ciArbiter records each arbitration, morning digest
 * records each notification, draft generators record each draft, etc.
 *
 * Keeping this as a helper module (not embedded in each agent) means
 * the row schema stays consistent across all emitters and the log
 * reader (GET /api/v1/agent-actions) has a single source of truth.
 */

import { query } from '../db/pool'
import { slog } from '../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentDecision =
  | 'auto_pass'
  | 'auto_fail'
  | 'queued'
  | 'sent'
  | 'suppressed'

export interface RecordInput {
  tenantId:          string
  projectId?:        string | null
  agentName:         string
  actionType:        string
  targetType?:       string | null
  targetId?:         string | null
  decision:          AgentDecision
  rationale:         string
  ruleId?:           string | null
  evidence?:         Record<string, unknown>
  confidence?:       number | null
  humanReviewable?:  boolean
}

export interface ActionRow {
  id:                string
  tenant_id:         string
  project_id:        string | null
  agent_name:        string
  action_type:       string
  target_type:       string | null
  target_id:         string | null
  decision:          string
  rationale:         string
  rule_id:           string | null
  evidence:          Record<string, unknown>
  confidence:        number | null
  human_reviewable:  boolean
  reviewed_by:       string | null
  reviewed_at:       string | null
  review_outcome:    string | null
  review_notes:      string | null
  created_at:        string
}

// ─── Record ──────────────────────────────────────────────────────────────────

/**
 * Insert one action row. Returns the new id. Never throws — failure to
 * record should not block the primary work. A failed insert is logged.
 */
export async function record(input: RecordInput): Promise<string | null> {
  try {
    const res = await query<{ id: string }>(`
      INSERT INTO agent_actions
        (tenant_id, project_id, agent_name, action_type,
         target_type, target_id, decision, rationale,
         rule_id, evidence, confidence, human_reviewable)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
      RETURNING id
    `, [
      input.tenantId,
      input.projectId ?? null,
      input.agentName,
      input.actionType,
      input.targetType ?? null,
      input.targetId ?? null,
      input.decision,
      input.rationale,
      input.ruleId ?? null,
      JSON.stringify(input.evidence ?? {}),
      input.confidence ?? null,
      input.humanReviewable ?? true,
    ])
    return res.rows[0]?.id ?? null
  } catch (err) {
    slog('ERROR', 'agentActions', '[record] Failed to write action log', {
      tenantId: input.tenantId, agent: input.agentName,
      message: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// ─── Stats (for morning digest) ──────────────────────────────────────────────

export interface StatsWindow {
  tenantId:   string
  projectId?: string
  from:       string            // ISO
  to:         string            // ISO
}

export interface StatsRollup {
  total:             number
  by_decision:       Record<string, number>
  by_agent:          Record<string, number>
  unreviewed_count:  number
  top_rationales:    Array<{ rationale: string; count: number }>
}

export async function stats(w: StatsWindow): Promise<StatsRollup> {
  const conds: string[] = ['tenant_id = $1', 'created_at >= $2', 'created_at <= $3']
  const vals: unknown[] = [w.tenantId, w.from, w.to]
  let i = 4
  if (w.projectId) {
    conds.push(`project_id = $${i++}`)
    vals.push(w.projectId)
  }
  const where = conds.join(' AND ')

  const [totalRow, byDecision, byAgent, unreviewed, topRationales] = await Promise.all([
    query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM agent_actions WHERE ${where}`, vals),
    query<{ decision: string; count: string }>(
      `SELECT decision, COUNT(*)::text AS count FROM agent_actions WHERE ${where} GROUP BY decision`, vals),
    query<{ agent_name: string; count: string }>(
      `SELECT agent_name, COUNT(*)::text AS count FROM agent_actions WHERE ${where} GROUP BY agent_name`, vals),
    query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM agent_actions
       WHERE ${where} AND reviewed_at IS NULL AND human_reviewable = TRUE`, vals),
    query<{ rationale: string; count: string }>(
      `SELECT rationale, COUNT(*)::text AS count FROM agent_actions
       WHERE ${where}
       GROUP BY rationale
       ORDER BY COUNT(*) DESC
       LIMIT 5`, vals),
  ])

  const by_decision: Record<string, number> = {}
  for (const r of byDecision.rows) by_decision[r.decision] = parseInt(r.count, 10)

  const by_agent: Record<string, number> = {}
  for (const r of byAgent.rows) by_agent[r.agent_name] = parseInt(r.count, 10)

  return {
    total:            parseInt(totalRow.rows[0]?.count ?? '0', 10),
    by_decision,
    by_agent,
    unreviewed_count: parseInt(unreviewed.rows[0]?.count ?? '0', 10),
    top_rationales:   topRationales.rows.map(r => ({ rationale: r.rationale, count: parseInt(r.count, 10) })),
  }
}

// ─── Review ───────────────────────────────────────────────────────────────────

export async function markReviewed(
  tenantId: string,
  id:       string,
  outcome:  'confirmed' | 'overridden' | 'reversed',
  userId:   string,
  notes?:   string,
): Promise<ActionRow | null> {
  const res = await query<ActionRow>(`
    UPDATE agent_actions
    SET reviewed_by    = $1,
        reviewed_at    = NOW(),
        review_outcome = $2,
        review_notes   = $3
    WHERE id = $4 AND tenant_id = $5
    RETURNING *
  `, [userId, outcome, notes ?? null, id, tenantId])
  return res.rows[0] ?? null
}
