// Denver Engineering — Learning Loop Engine (v7.0.0)
// Continuous learning loop: records feedback, aggregates signals, updates system knowledge.

import { tenantQuery } from '../../db/pool'
import {
  LearningFeedback, RecordFeedbackInput,
  LearningSignal, FeedbackOutcome, FeedbackType,
} from './adaptiveTypes'

// ─── Record feedback ──────────────────────────────────────────────────────────

export async function recordFeedback(
  tenantId: string,
  input: RecordFeedbackInput,
): Promise<LearningFeedback> {
  const {
    feedbackType, sourceId, sourceType, agentType,
    signal, outcome, context = {}, metadata = {}, recordedBy,
  } = input

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO learning_feedback
      (tenant_id, feedback_type, source_id, source_type, agent_type,
       signal, outcome, context, metadata, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [tenantId, feedbackType, sourceId, sourceType, agentType ?? null,
     signal, outcome, JSON.stringify(context), JSON.stringify(metadata), recordedBy ?? null],
  )
  return _mapFeedback(res.rows[0])
}

// ─── Aggregate signals ────────────────────────────────────────────────────────

export interface SignalSummary {
  feedbackType: FeedbackType
  total: number
  positive: number
  negative: number
  neutral: number
  mixed: number
  positiveRate: number
  outcomeBreakdown: Record<FeedbackOutcome, number>
}

export async function aggregateSignals(
  tenantId: string,
  feedbackType: FeedbackType,
  windowDays = 30,
): Promise<SignalSummary> {
  const res = await tenantQuery(
    tenantId,
    `SELECT
       signal,
       outcome,
       COUNT(*)::int AS cnt
     FROM learning_feedback
     WHERE tenant_id = $1
       AND feedback_type = $2
       AND created_at >= now() - ($3 || ' days')::interval
     GROUP BY signal, outcome`,
    [tenantId, feedbackType, windowDays],
  )

  const bySignal: Record<string, number> = { positive: 0, negative: 0, neutral: 0, mixed: 0 }
  const byOutcome: Record<string, number> = {}

  for (const row of res.rows) {
    bySignal[row.signal] = (bySignal[row.signal] ?? 0) + Number(row.cnt)
    byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + Number(row.cnt)
  }

  const total = Object.values(bySignal).reduce((s, n) => s + n, 0)
  const positive = bySignal.positive ?? 0

  return {
    feedbackType,
    total,
    positive,
    negative: bySignal.negative ?? 0,
    neutral: bySignal.neutral ?? 0,
    mixed: bySignal.mixed ?? 0,
    positiveRate: total > 0 ? positive / total : 0,
    outcomeBreakdown: byOutcome as Record<FeedbackOutcome, number>,
  }
}

// ─── Get feedback history ─────────────────────────────────────────────────────

export async function getFeedbackHistory(
  tenantId: string,
  sourceType: string,
  sourceId: string,
): Promise<LearningFeedback[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM learning_feedback
     WHERE tenant_id = $1
       AND source_type = $2
       AND source_id = $3
     ORDER BY created_at ASC`,
    [tenantId, sourceType, sourceId],
  )
  return res.rows.map(_mapFeedback)
}

// ─── Get feedback by type ─────────────────────────────────────────────────────

export async function listFeedback(
  tenantId: string,
  opts: {
    feedbackType?: FeedbackType
    signal?: LearningSignal
    agentType?: string
    limit?: number
    windowDays?: number
  } = {},
): Promise<LearningFeedback[]> {
  const { feedbackType, signal, agentType, limit = 100, windowDays = 30 } = opts
  const params: unknown[] = [tenantId, windowDays]
  const clauses: string[] = [
    'tenant_id = $1',
    `created_at >= now() - ($2 || ' days')::interval`,
  ]

  if (feedbackType != null) { params.push(feedbackType); clauses.push(`feedback_type = $${params.length}`) }
  if (signal != null)       { params.push(signal);       clauses.push(`signal = $${params.length}`) }
  if (agentType != null)    { params.push(agentType);    clauses.push(`agent_type = $${params.length}`) }

  params.push(limit)
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM learning_feedback
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  )
  return res.rows.map(_mapFeedback)
}

// ─── Learning health ──────────────────────────────────────────────────────────

export interface LearningHealthReport {
  tenantId: string
  totalFeedback: number
  feedbackLast7Days: number
  overallPositiveRate: number
  byType: Partial<Record<FeedbackType, SignalSummary>>
  generatedAt: Date
}

export async function getLearningHealth(tenantId: string): Promise<LearningHealthReport> {
  const [totalRes, recentRes] = await Promise.all([
    tenantQuery(tenantId,
      `SELECT COUNT(*)::int AS total FROM learning_feedback WHERE tenant_id = $1`,
      [tenantId],
    ),
    tenantQuery(tenantId,
      `SELECT COUNT(*)::int AS cnt FROM learning_feedback
       WHERE tenant_id = $1 AND created_at >= now() - interval '7 days'`,
      [tenantId],
    ),
  ])

  const types: FeedbackType[] = ['recommendation', 'forecast', 'anomaly', 'scenario']
  const summaries = await Promise.all(types.map(t => aggregateSignals(tenantId, t, 30)))
  const byType: Partial<Record<FeedbackType, SignalSummary>> = {}
  for (const s of summaries) { byType[s.feedbackType] = s }

  const total = Number(totalRes.rows[0]?.total ?? 0)
  const totalAll = summaries.reduce((s, x) => s + x.total, 0)
  const totalPos = summaries.reduce((s, x) => s + x.positive, 0)

  return {
    tenantId,
    totalFeedback: total,
    feedbackLast7Days: Number(recentRes.rows[0]?.cnt ?? 0),
    overallPositiveRate: totalAll > 0 ? totalPos / totalAll : 0,
    byType,
    generatedAt: new Date(),
  }
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function _mapFeedback(row: Record<string, unknown>): LearningFeedback {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    feedbackType: row.feedback_type as FeedbackType,
    sourceId: row.source_id as string,
    sourceType: row.source_type as string,
    agentType: row.agent_type != null ? String(row.agent_type) : undefined,
    signal: row.signal as LearningSignal,
    outcome: row.outcome as FeedbackOutcome,
    context: (row.context ?? {}) as Record<string, unknown>,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    recordedBy: row.recorded_by != null ? String(row.recorded_by) : undefined,
    createdAt: new Date(row.created_at as string),
  }
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = { _mapFeedback }
