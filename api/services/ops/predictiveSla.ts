/**
 * Denver Engineering — Predictive SLA Breach Detection (v4.35.0)
 * ───────────────────────────────────────────────────────────────
 * Ava Phase 3 — Deterministic breach probability models.
 * ML-ready: ScoringInput/Output interfaces ready for model plug-in.
 *
 * Outputs are explainable — every score is traceable to input signals.
 */
import { pool } from '../../db/pool'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BreachPredictionInput {
  actionId:            string
  priority:            string
  actionType:          string
  slaRemainingMinutes: number | null
  escalationLevel:     number
  blockerCount:        number
  assigneeOpenCount:   number
  reopenCount:         number
  historicalP50Hours:  number | null  // median resolution for this type+priority
  historicalP90Hours:  number | null
  ageHours:            number
}

export interface BreachPrediction {
  actionId:            string
  breachProbability:   number   // 0.0 – 1.0
  predictedDelayHours: number | null
  staffingRiskScore:   number   // 0-100
  bottleneckFactors:   BottleneckFactor[]
  modelVersion:        string
  featureVector:       Record<string, number>
}

export interface BottleneckFactor {
  type:        string
  weight:      number
  description: string
}

// ─── Feature engineering ──────────────────────────────────────────────────────

export function buildFeatureVector(input: BreachPredictionInput): Record<string, number> {
  const slaUrgency = input.slaRemainingMinutes === null ? 0
    : input.slaRemainingMinutes <= 0   ? 1.0
    : input.slaRemainingMinutes < 60   ? 0.9
    : input.slaRemainingMinutes < 240  ? 0.7
    : input.slaRemainingMinutes < 480  ? 0.5
    : input.slaRemainingMinutes < 1440 ? 0.3
    : 0.1

  const priorityWeight = { critical: 1.0, high: 0.75, medium: 0.45, low: 0.2 }[input.priority] ?? 0.45

  const escalationWeight = Math.min(input.escalationLevel / 3, 1.0)

  const blockerWeight = Math.min(input.blockerCount / 5, 1.0)

  const workloadPressure = Math.min(input.assigneeOpenCount / 30, 1.0)

  const reopenSignal = Math.min(input.reopenCount / 3, 1.0)

  // Historical comparison: if current age already exceeds P90, high risk
  const ageRisk = input.historicalP90Hours !== null && input.historicalP90Hours > 0
    ? Math.min(input.ageHours / input.historicalP90Hours, 1.0)
    : 0.3

  return {
    sla_urgency:       slaUrgency,
    priority_weight:   priorityWeight,
    escalation_weight: escalationWeight,
    blocker_weight:    blockerWeight,
    workload_pressure: workloadPressure,
    reopen_signal:     reopenSignal,
    age_risk:          ageRisk,
  }
}

// ─── Breach probability model ─────────────────────────────────────────────────

const FEATURE_WEIGHTS = {
  sla_urgency:       0.35,
  priority_weight:   0.15,
  escalation_weight: 0.15,
  blocker_weight:    0.15,
  workload_pressure: 0.10,
  reopen_signal:     0.05,
  age_risk:          0.05,
}

export function computeBreachProbability(features: Record<string, number>): number {
  let score = 0
  for (const [k, w] of Object.entries(FEATURE_WEIGHTS)) {
    score += (features[k] ?? 0) * w
  }
  return Math.round(Math.min(1.0, Math.max(0.0, score)) * 10000) / 10000
}

// ─── Staffing risk ────────────────────────────────────────────────────────────

export function computeStaffingRisk(openCount: number, overdueCount: number, criticalCount: number): number {
  const base     = Math.min(openCount     / 20, 1.0) * 40
  const overdue  = Math.min(overdueCount  / 10, 1.0) * 40
  const critical = Math.min(criticalCount /  5, 1.0) * 20
  return Math.round(base + overdue + critical)
}

// ─── Bottleneck factor extraction ────────────────────────────────────────────

export function identifyBottlenecks(input: BreachPredictionInput): BottleneckFactor[] {
  const factors: BottleneckFactor[] = []

  if (input.slaRemainingMinutes !== null && input.slaRemainingMinutes < 120) {
    factors.push({ type: 'sla_near_breach', weight: 0.35, description: 'Less than 2 hours of SLA remaining' })
  }
  if (input.blockerCount > 0) {
    factors.push({ type: 'dependency_blockers', weight: input.blockerCount * 0.15, description: `${input.blockerCount} blocking dependency${input.blockerCount > 1 ? 's' : ''}` })
  }
  if (input.assigneeOpenCount > 20) {
    factors.push({ type: 'assignee_overload', weight: 0.10, description: `Assignee has ${input.assigneeOpenCount} open actions` })
  }
  if (input.reopenCount >= 2) {
    factors.push({ type: 'reopen_pattern', weight: 0.05, description: `Action reopened ${input.reopenCount} times` })
  }
  if (input.historicalP50Hours !== null && input.ageHours > input.historicalP50Hours * 1.5) {
    factors.push({ type: 'age_outlier', weight: 0.05, description: 'Action age exceeds 150% of historical median resolution time' })
  }

  return factors.sort((a, b) => b.weight - a.weight)
}

// ─── Delay prediction ─────────────────────────────────────────────────────────

export function predictDelayHours(
  input:   BreachPredictionInput,
  prob:    number,
): number | null {
  if (prob < 0.4) return null  // low risk — no meaningful delay prediction
  if (input.slaRemainingMinutes !== null && input.slaRemainingMinutes <= 0) {
    // Already breached
    return Math.abs(input.slaRemainingMinutes) / 60
  }
  // Use historical P90 as upper bound
  if (input.historicalP90Hours !== null && input.historicalP90Hours > 0) {
    const remaining = input.slaRemainingMinutes !== null ? input.slaRemainingMinutes / 60 : 24
    const expected  = input.historicalP90Hours
    return Math.max(0, expected - (input.ageHours + remaining))
  }
  // Fallback: estimate based on probability
  return Math.round(prob * 16 * 10) / 10  // up to 16h at probability=1.0
}

// ─── Main prediction function ─────────────────────────────────────────────────

export function predictBreach(input: BreachPredictionInput): BreachPrediction {
  const featureVector   = buildFeatureVector(input)
  const breachProb      = computeBreachProbability(featureVector)
  const delayHours      = predictDelayHours(input, breachProb)
  const bottlenecks     = identifyBottlenecks(input)
  const staffingRisk    = computeStaffingRisk(input.assigneeOpenCount, 0, 0)

  return {
    actionId:            input.actionId,
    breachProbability:   breachProb,
    predictedDelayHours: delayHours,
    staffingRiskScore:   staffingRisk,
    bottleneckFactors:   bottlenecks,
    modelVersion:        'deterministic-v1',
    featureVector,
  }
}

// ─── Batch predictions ────────────────────────────────────────────────────────

export function batchPredictBreaches(inputs: BreachPredictionInput[]): BreachPrediction[] {
  return inputs.map(predictBreach).sort((a, b) => b.breachProbability - a.breachProbability)
}

// ─── Persist predictions ──────────────────────────────────────────────────────

export async function persistPredictions(
  tenantId: string,
  preds:    BreachPrediction[],
): Promise<void> {
  for (const p of preds) {
    await pool.query(`
      INSERT INTO sla_breach_predictions
        (tenant_id, action_id, breach_probability, predicted_delay_hours,
         staffing_risk_score, bottleneck_factors, feature_vector, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + INTERVAL '4 hours')
      ON CONFLICT (tenant_id, action_id) DO UPDATE SET
        breach_probability    = EXCLUDED.breach_probability,
        predicted_delay_hours = EXCLUDED.predicted_delay_hours,
        staffing_risk_score   = EXCLUDED.staffing_risk_score,
        bottleneck_factors    = EXCLUDED.bottleneck_factors,
        feature_vector        = EXCLUDED.feature_vector,
        computed_at           = NOW(),
        expires_at            = NOW() + INTERVAL '4 hours'
    `, [
      tenantId, p.actionId, p.breachProbability, p.predictedDelayHours,
      p.staffingRiskScore,
      JSON.stringify(p.bottleneckFactors),
      JSON.stringify(p.featureVector),
    ])
  }
}

// ─── Historical baseline query ────────────────────────────────────────────────

export async function getHistoricalBaseline(
  tenantId:   string,
  actionType: string,
  priority:   string,
): Promise<{ p50: number | null; p90: number | null }> {
  try {
    const res = await pool.query(`
      SELECT
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY resolution_hours) AS p50,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY resolution_hours) AS p90
      FROM action_resolution_samples
      WHERE tenant_id = $1 AND action_type = $2 AND priority = $3
        AND sampled_at > NOW() - INTERVAL '90 days'
    `, [tenantId, actionType, priority])
    const row = res.rows[0]
    return {
      p50: row?.p50 !== null ? Number(row.p50) : null,
      p90: row?.p90 !== null ? Number(row.p90) : null,
    }
  } catch {
    return { p50: null, p90: null }
  }
}

// ─── Test hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  buildFeatureVector,
  computeBreachProbability,
  computeStaffingRisk,
  identifyBottlenecks,
  predictDelayHours,
  FEATURE_WEIGHTS,
}
