/**
 * Denver Engineering — Autonomous Coordination (v4.49.0)
 * ─────────────────────────────────────────────────────────────────────────────
 * Vision Phase 12 — the closed loop: monitor → detect → recommend → execute with
 * approval. It runs the (deterministic) Coordination engine, turns the highest
 * issues into persisted recommendations, and on human approval EXECUTES them by
 * creating a tracked `action` (the platform's real work item) — recording the
 * link for a full audit trail. No autonomous writes happen without approval.
 */
import { tenantQuery } from '../../db/pool'
import { buildProjectCoordination, type CoordinationBriefing } from '../copilot/coordinationService'
import { createAction } from '../actionService'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecommendationDraft {
  dedupeKey: string
  category: string
  source: string
  sourceRef: string
  sourceRecordId: string | null
  title: string
  recommendedAction: string
  rationale: string
  suggestedOwner: string | null
  priority: string
  severity: string
}

const PRIORITY_BY_SEVERITY: Record<string, string> = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' }

// ─── Pure mapping ─────────────────────────────────────────────────────────────

/** Map a Coordination briefing into recommendation drafts (highest issues only). */
export function issuesToRecommendations(
  briefing: CoordinationBriefing,
  opts: { severities?: string[]; limit?: number } = {},
): RecommendationDraft[] {
  const severities = new Set(opts.severities ?? ['critical', 'high'])
  const limit = opts.limit ?? 25
  return briefing.issues
    .filter(i => severities.has(i.severity))
    .slice(0, limit)
    .map(i => ({
      dedupeKey: `${i.category}:${i.source}:${i.sourceId ?? i.reference}`,
      category: i.category,
      source: i.source,
      sourceRef: i.reference,
      sourceRecordId: i.sourceId ?? null,
      title: `${i.reference}: ${i.title}`.slice(0, 480),
      recommendedAction: i.recommendedAction,
      rationale: i.why,
      suggestedOwner: i.owner ?? null,
      priority: PRIORITY_BY_SEVERITY[i.severity] ?? 'medium',
      severity: i.severity,
    }))
}

// ─── Scan: monitor → detect → recommend ───────────────────────────────────────

export async function scanProject(tenantId: string, projectId: string, now: Date = new Date()): Promise<{ generated: number }> {
  const briefing = await buildProjectCoordination(tenantId, projectId, now)
  if (!briefing) return { generated: 0 }
  const drafts = issuesToRecommendations(briefing)

  for (const d of drafts) {
    await tenantQuery(tenantId,
      `INSERT INTO coordination_recommendations
         (tenant_id, project_id, dedupe_key, category, source, source_ref, source_record_id,
          title, recommended_action, rationale, suggested_owner, priority, severity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (tenant_id, dedupe_key) DO UPDATE
         SET title=EXCLUDED.title, recommended_action=EXCLUDED.recommended_action,
             rationale=EXCLUDED.rationale, suggested_owner=EXCLUDED.suggested_owner,
             priority=EXCLUDED.priority, severity=EXCLUDED.severity,
             source_ref=EXCLUDED.source_ref, updated_at=NOW()
         WHERE coordination_recommendations.status = 'proposed'`,
      [tenantId, projectId, d.dedupeKey, d.category, d.source, d.sourceRef, d.sourceRecordId,
        d.title, d.recommendedAction, d.rationale, d.suggestedOwner, d.priority, d.severity])
  }
  return { generated: drafts.length }
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listRecommendations(tenantId: string, projectId: string, status?: string) {
  const params: unknown[] = [tenantId, projectId]
  let where = `tenant_id=$1 AND project_id=$2`
  if (status) { params.push(status); where += ` AND status=$${params.length}` }
  const res = await tenantQuery(tenantId,
    `SELECT id, project_id, category, source, source_ref, source_record_id, title, recommended_action,
            rationale, suggested_owner, priority, severity, status, executed_action_id, decided_at, created_at
       FROM coordination_recommendations WHERE ${where}
      ORDER BY (status='proposed') DESC,
               CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
               created_at DESC`, params)
  return res.rows
}

// ─── Decide: execute-with-approval ────────────────────────────────────────────

interface RecRow {
  id: string; project_id: string; title: string; recommended_action: string; rationale: string | null
  suggested_owner: string | null; priority: string; status: string
}

/** Approve a recommendation → create the tracked action, mark executed. */
export async function approveRecommendation(tenantId: string, id: string, userId: string | null) {
  const recRes = await tenantQuery<RecRow>(tenantId,
    `SELECT id, project_id, title, recommended_action, rationale, suggested_owner, priority, status
       FROM coordination_recommendations WHERE tenant_id=$1 AND id=$2`, [tenantId, id])
  const rec = recRes.rows[0]
  if (!rec) return { notFound: true as const }
  if (rec.status !== 'proposed') return { alreadyDecided: rec.status }

  const action = await createAction(tenantId, {
    title: rec.title,
    description: rec.rationale ? `${rec.recommended_action}\n\n${rec.rationale}` : rec.recommended_action,
    action_type: 'COORDINATION',
    source_module: 'coordination_recommendation',
    source_id: rec.id,
    project_id: rec.project_id,
    priority: (['low', 'medium', 'high', 'critical'].includes(rec.priority) ? rec.priority : 'medium') as 'low' | 'medium' | 'high' | 'critical',
    assigned_to_user_id: rec.suggested_owner,
    created_by: userId,
  })

  const updated = await tenantQuery(tenantId,
    `UPDATE coordination_recommendations
        SET status='executed', executed_action_id=COALESCE($3, executed_action_id),
            decided_by=$4, decided_at=NOW(), updated_at=NOW()
      WHERE tenant_id=$1 AND id=$2 AND status='proposed'
      RETURNING id, status, executed_action_id`, [tenantId, id, action?.id ?? null, userId])

  return { recommendation: updated.rows[0], action: action ?? null }
}

export async function dismissRecommendation(tenantId: string, id: string, userId: string | null) {
  const res = await tenantQuery(tenantId,
    `UPDATE coordination_recommendations
        SET status='dismissed', decided_by=$3, decided_at=NOW(), updated_at=NOW()
      WHERE tenant_id=$1 AND id=$2 AND status='proposed'
      RETURNING id, status`, [tenantId, id, userId])
  if (!res.rows[0]) return { notFoundOrDecided: true as const }
  return { recommendation: res.rows[0] }
}
