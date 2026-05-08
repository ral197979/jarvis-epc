// Denver Engineering — Anomaly Classification Service (v6.0.0)
// Classification, severity escalation, and false-positive filtering for detected anomalies.

import { OperationalAnomaly, AnomalySeverity } from './twinTypes'

// ─── Anomaly taxonomy ─────────────────────────────────────────────────────────

export const ANOMALY_CLASSES = {
  score_deviation: {
    label: 'Score Deviation',
    description: 'Unexpected change in readiness, risk, or health scores',
    category: 'metric',
  },
  high_state_velocity: {
    label: 'High State Velocity',
    description: 'Unusually frequent state changes',
    category: 'behavior',
  },
  blocker_cluster: {
    label: 'Blocker Cluster',
    description: 'Concentration of blocked actions in a short window',
    category: 'operational',
  },
  readiness_score_spike: {
    label: 'Readiness Score Spike',
    description: 'Sudden statistically significant change in readiness score',
    category: 'metric',
  },
  sla_breach_pattern: {
    label: 'SLA Breach Pattern',
    description: 'Recurring SLA breach events suggesting systemic issues',
    category: 'compliance',
  },
  resource_contention: {
    label: 'Resource Contention',
    description: 'Multiple entities competing for shared resources',
    category: 'operational',
  },
} as const

export type AnomalyClass = keyof typeof ANOMALY_CLASSES

// ─── Classify anomaly ─────────────────────────────────────────────────────────

export function classifyAnomaly(anomaly: OperationalAnomaly): {
  class: AnomalyClass | 'unknown'
  category: string
  label: string
  confidence: number
} {
  const type = anomaly.anomalyType as AnomalyClass
  const info = ANOMALY_CLASSES[type]
  if (info) {
    return {
      class: type,
      category: info.category,
      label: info.label,
      confidence: anomaly.anomalyScore / 100,
    }
  }
  return { class: 'unknown', category: 'unknown', label: anomaly.anomalyType, confidence: 0.5 }
}

// ─── Severity escalation ──────────────────────────────────────────────────────

export function shouldEscalate(anomaly: OperationalAnomaly): boolean {
  if (anomaly.falsePositive) return false
  if (anomaly.severity === 'critical') return true
  if (anomaly.severity === 'high' && anomaly.anomalyScore >= 75) return true
  return false
}

export function escalatedSeverity(
  current: AnomalySeverity,
  contextualRisk: number
): AnomalySeverity {
  if (contextualRisk >= 90) return 'critical'
  if (contextualRisk >= 70) {
    if (current === 'low') return 'medium'
    if (current === 'medium') return 'high'
    return 'critical'
  }
  return current
}

// ─── False positive filtering ─────────────────────────────────────────────────

export function likelyFalsePositive(anomaly: OperationalAnomaly): boolean {
  // Low score + low severity + no impacted entities = likely noise
  if (anomaly.anomalyScore < 20 && anomaly.severity === 'low') return true
  if (anomaly.impactedEntities.length === 0 && anomaly.severity === 'low') return true
  return false
}

// ─── Group related anomalies ──────────────────────────────────────────────────

export function groupAnomalies(
  anomalies: OperationalAnomaly[]
): Map<string, OperationalAnomaly[]> {
  const groups = new Map<string, OperationalAnomaly[]>()
  for (const a of anomalies) {
    const classification = classifyAnomaly(a)
    const key = classification.category
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(a)
  }
  return groups
}

// ─── Anomaly summary ──────────────────────────────────────────────────────────

export function summarizeAnomalies(anomalies: OperationalAnomaly[]): {
  total: number
  bySeverity: Record<AnomalySeverity, number>
  byCategory: Record<string, number>
  escalationCount: number
  topAnomalyScore: number
} {
  const bySeverity: Record<AnomalySeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 }
  const byCategory: Record<string, number> = {}
  let escalationCount = 0
  let topScore = 0

  for (const a of anomalies) {
    bySeverity[a.severity]++
    if (shouldEscalate(a)) escalationCount++
    if (a.anomalyScore > topScore) topScore = a.anomalyScore

    const cls = classifyAnomaly(a)
    byCategory[cls.category] = (byCategory[cls.category] ?? 0) + 1
  }

  return {
    total: anomalies.length,
    bySeverity,
    byCategory,
    escalationCount,
    topAnomalyScore: topScore,
  }
}

export const __testHooks = {
  classifyAnomaly,
  shouldEscalate,
  likelyFalsePositive,
  groupAnomalies,
  summarizeAnomalies,
}
