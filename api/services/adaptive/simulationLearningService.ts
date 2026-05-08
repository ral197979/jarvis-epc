// Denver Engineering — Simulation Learning Service (v7.0.0)
// Tracks scenario simulation outcomes to improve future planning accuracy.

import { tenantQuery } from '../../db/pool'
import { SimulationOutcome } from './adaptiveTypes'

// ─── Record simulation outcome ────────────────────────────────────────────────

export async function recordSimulationOutcome(
  tenantId: string,
  opts: {
    scenarioId: string
    predictedDelta: number
    mitigationsApplied?: string[]
  },
): Promise<SimulationOutcome> {
  const { scenarioId, predictedDelta, mitigationsApplied = [] } = opts

  // Store as learning feedback
  await tenantQuery(
    tenantId,
    `INSERT INTO learning_feedback
      (tenant_id, feedback_type, source_id, source_type, signal, outcome, context, recorded_by)
     VALUES ($1, 'scenario', $2, 'scenario_simulations', 'neutral', 'unknown', $3, 'system')
     ON CONFLICT DO NOTHING`,
    [
      tenantId,
      scenarioId,
      JSON.stringify({ predictedDelta, mitigationsApplied }),
    ],
  )

  return {
    scenarioId,
    tenantId,
    predictedDelta,
    mitigationsApplied,
    recordedAt: new Date(),
  }
}

// ─── Record actual outcome (for a previously simulated scenario) ──────────────

export async function recordActualOutcome(
  tenantId: string,
  scenarioId: string,
  actualDelta: number,
): Promise<SimulationOutcome> {
  // Update the existing feedback record
  await tenantQuery(
    tenantId,
    `UPDATE learning_feedback
     SET
       signal = CASE
         WHEN ABS((context->>'predictedDelta')::float - $2) < 10 THEN 'positive'
         WHEN ABS((context->>'predictedDelta')::float - $2) < 25 THEN 'neutral'
         ELSE 'negative'
       END,
       outcome = 'accepted',
       context = context || jsonb_build_object('actualDelta', $2, 'measuredAt', now()::text),
       metadata = metadata || jsonb_build_object('predictionError',
         ABS((context->>'predictedDelta')::float - $2))
     WHERE tenant_id = $1
       AND source_id = $3
       AND feedback_type = 'scenario'`,
    [tenantId, actualDelta, scenarioId],
  )

  // Fetch original record
  const res = await tenantQuery(
    tenantId,
    `SELECT context, metadata
     FROM learning_feedback
     WHERE tenant_id = $1 AND source_id = $2 AND feedback_type = 'scenario'
     LIMIT 1`,
    [tenantId, scenarioId],
  )

  const ctx = (res.rows[0]?.context ?? {}) as Record<string, unknown>
  const meta = (res.rows[0]?.metadata ?? {}) as Record<string, unknown>

  return {
    scenarioId,
    tenantId,
    predictedDelta: Number(ctx.predictedDelta ?? 0),
    actualDelta,
    predictionError: meta.predictionError != null ? Number(meta.predictionError) : undefined,
    mitigationsApplied: (ctx.mitigationsApplied as string[]) ?? [],
    recordedAt: new Date(),
  }
}

// ─── Get scenario accuracy stats ─────────────────────────────────────────────

export interface ScenarioAccuracyStats {
  totalSimulations: number
  measuredSimulations: number
  meanPredictionError: number
  accurateCount: number        // within 10 points
  inaccurateCount: number      // > 25 points off
  accuracyRate: number
}

export async function getScenarioAccuracyStats(
  tenantId: string,
  windowDays = 90,
): Promise<ScenarioAccuracyStats> {
  const res = await tenantQuery(
    tenantId,
    `SELECT
       COUNT(*)::int AS total,
       COUNT(CASE WHEN outcome != 'unknown' THEN 1 END)::int AS measured,
       COALESCE(AVG((metadata->>'predictionError')::float)
         FILTER (WHERE metadata->>'predictionError' IS NOT NULL), 0)::float AS mean_error,
       COUNT(CASE WHEN (metadata->>'predictionError')::float <= 10 THEN 1 END)::int AS accurate,
       COUNT(CASE WHEN (metadata->>'predictionError')::float > 25 THEN 1 END)::int AS inaccurate
     FROM learning_feedback
     WHERE tenant_id = $1
       AND feedback_type = 'scenario'
       AND created_at >= now() - ($2 || ' days')::interval`,
    [tenantId, windowDays],
  )

  const row = res.rows[0]
  const total = Number(row?.total ?? 0)
  const measured = Number(row?.measured ?? 0)
  const accurate = Number(row?.accurate ?? 0)

  return {
    totalSimulations: total,
    measuredSimulations: measured,
    meanPredictionError: Number(row?.mean_error ?? 0),
    accurateCount: accurate,
    inaccurateCount: Number(row?.inaccurate ?? 0),
    accuracyRate: measured > 0 ? accurate / measured : 0,
  }
}

// ─── List simulation outcomes ─────────────────────────────────────────────────

export async function listSimulationOutcomes(
  tenantId: string,
  limit = 20,
): Promise<SimulationOutcome[]> {
  const res = await tenantQuery(
    tenantId,
    `SELECT source_id, context, metadata, created_at
     FROM learning_feedback
     WHERE tenant_id = $1 AND feedback_type = 'scenario'
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, limit],
  )

  return res.rows.map(row => {
    const ctx = (row.context ?? {}) as Record<string, unknown>
    const meta = (row.metadata ?? {}) as Record<string, unknown>
    return {
      scenarioId: row.source_id as string,
      tenantId,
      predictedDelta: Number(ctx.predictedDelta ?? 0),
      actualDelta: ctx.actualDelta != null ? Number(ctx.actualDelta) : undefined,
      predictionError: meta.predictionError != null ? Number(meta.predictionError) : undefined,
      mitigationsApplied: (ctx.mitigationsApplied as string[]) ?? [],
      recordedAt: new Date(row.created_at as string),
    }
  })
}
