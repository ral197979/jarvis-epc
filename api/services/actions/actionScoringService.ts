/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Denver Engineering — Action Scoring Service (v4.34.0)
 * ───────────────────────────────────────────────────────
 * Ava Phase 2H — Provider-agnostic AI prioritization foundation.
 *
 * Computes deterministic risk and priority scores WITHOUT calling any LLM.
 * All scores are 0–100. Higher = more urgent / more risk.
 *
 * Score components:
 *   1. severityScore        — from priority field
 *   2. slaRiskScore         — how close to due_at (or overdue factor)
 *   3. escalationScore      — current escalation level
 *   4. downstreamScore      — how many actions are blocked downstream
 *   5. moduleCriticalityScore — criticality weight by action_type
 *   6. reopenPenalty        — history of reopens (via escalation_count proxy)
 *
 * Final:
 *   operational_risk_score = weighted average of all components
 *   ai_priority_score      = placeholder for future LLM re-rank
 *
 * Design is provider-agnostic: supports OpenAI, Anthropic, Together.ai,
 * or local inference via the ScoringProvider interface.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActionScoreInput {
  action_id:             string
  priority:              'low' | 'medium' | 'high' | 'critical'
  action_type:           string
  due_at:                string | null
  escalation_level:      number   // max escalation level reached (0 = none)
  escalation_count:      number   // total escalation events
  downstream_impact_count: number // blocked actions downstream
  remaining_minutes:     number | null  // from SLA state; negative = overdue
  reopen_count?:         number   // how many times reopened (optional)
}

export interface ActionScore {
  action_id:              string
  operational_risk_score: number   // 0–100
  ai_priority_score:      number   // 0–100 (same as operational for now; AI stub)
  recommendation_reason:  string   // human-readable explanation
  score_components: {
    severity:          number
    sla_risk:          number
    escalation:        number
    downstream:        number
    module_criticality: number
    reopen_penalty:    number
  }
  scored_at: string
}

// ─── Provider interface (AI-ready) ────────────────────────────────────────────

export interface ScoringProvider {
  name: string
  rerank(actions: ActionScoreInput[], context?: Record<string, unknown>): Promise<number[]>
}

// Registry — plug in Anthropic / OpenAI / Together.ai at boot
const _providers = new Map<string, ScoringProvider>()

export function registerScoringProvider(provider: ScoringProvider): void {
  _providers.set(provider.name, provider)
}

export function getActiveScoringProvider(): ScoringProvider | null {
  return _providers.values().next().value ?? null
}

// ─── Component calculators ────────────────────────────────────────────────────

const PRIORITY_SCORES: Record<string, number> = {
  critical: 100,
  high:     75,
  medium:   40,
  low:      15,
}

const MODULE_CRITICALITY: Record<string, number> = {
  // Safety / compliance first
  COMPLIANCE_TASK:     90,
  INSPECTION:          80,
  PUNCH_ITEM:          70,
  // Design / coordination
  BIM_ISSUE:           65,
  RFI:                 60,
  SUBMITTAL:           55,
  // Operations
  WORK_ORDER:          50,
  ALARM:               85,   // alarms are high-criticality
  DAILY_LOG:           25,
  TEMPLATE_ASSIGNMENT: 20,
}

function _severityScore(input: ActionScoreInput): number {
  return PRIORITY_SCORES[input.priority] ?? 40
}

function _slaRiskScore(input: ActionScoreInput): number {
  if (input.remaining_minutes == null) return 20  // no SLA data
  if (input.remaining_minutes <= 0) {
    // Overdue: score grows with how long overdue, capped at 100
    const hoursOverdue = Math.abs(input.remaining_minutes) / 60
    return Math.min(100, 60 + hoursOverdue * 2)
  }
  const hoursRemaining = input.remaining_minutes / 60
  if (hoursRemaining <= 2)  return 95
  if (hoursRemaining <= 8)  return 75
  if (hoursRemaining <= 24) return 50
  if (hoursRemaining <= 72) return 25
  return 10
}

function _escalationScore(input: ActionScoreInput): number {
  return Math.min(100, input.escalation_level * 30 + input.escalation_count * 5)
}

function _downstreamScore(input: ActionScoreInput): number {
  if (input.downstream_impact_count === 0) return 0
  return Math.min(100, 20 + input.downstream_impact_count * 10)
}

function _moduleCriticalityScore(input: ActionScoreInput): number {
  return MODULE_CRITICALITY[input.action_type] ?? 40
}

function _reopenPenalty(input: ActionScoreInput): number {
  const reopens = input.reopen_count ?? 0
  return Math.min(50, reopens * 15)
}

// ─── Weighted aggregation ─────────────────────────────────────────────────────

const WEIGHTS = {
  severity:           0.25,
  sla_risk:           0.30,
  escalation:         0.15,
  downstream:         0.15,
  module_criticality: 0.10,
  reopen_penalty:     0.05,
}

function _buildReason(components: ActionScore['score_components'], score: number): string {
  const parts: string[] = []
  if (components.sla_risk >= 75)           parts.push('SLA breach imminent or overdue')
  if (components.escalation >= 60)         parts.push('escalated to senior stakeholders')
  if (components.downstream >= 40)         parts.push('blocking downstream work')
  if (components.severity >= 75)           parts.push('high/critical priority')
  if (components.module_criticality >= 80) parts.push('safety-critical module')
  if (components.reopen_penalty >= 15)     parts.push('recurring issue (reopened)')
  if (parts.length === 0)                  parts.push('standard operational priority')
  return parts.join('; ')
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function scoreAction(input: ActionScoreInput): ActionScore {
  const components = {
    severity:           _severityScore(input),
    sla_risk:           _slaRiskScore(input),
    escalation:         _escalationScore(input),
    downstream:         _downstreamScore(input),
    module_criticality: _moduleCriticalityScore(input),
    reopen_penalty:     _reopenPenalty(input),
  }

  const operational_risk_score = Math.round(
    components.severity           * WEIGHTS.severity +
    components.sla_risk           * WEIGHTS.sla_risk +
    components.escalation         * WEIGHTS.escalation +
    components.downstream         * WEIGHTS.downstream +
    components.module_criticality * WEIGHTS.module_criticality +
    components.reopen_penalty     * WEIGHTS.reopen_penalty
  )

  return {
    action_id:              input.action_id,
    operational_risk_score,
    ai_priority_score:      operational_risk_score,  // stub: equals deterministic score until AI provider registered
    recommendation_reason:  _buildReason(components, operational_risk_score),
    score_components:       components,
    scored_at:              new Date().toISOString(),
  }
}

/** Score a batch and sort by operational_risk_score descending */
export function scoreAndRankActions(inputs: ActionScoreInput[]): ActionScore[] {
  return inputs
    .map(scoreAction)
    .sort((a, b) => b.operational_risk_score - a.operational_risk_score)
}

/** Test-only */
export const __testHooks = {
  severityScore:           _severityScore,
  slaRiskScore:            _slaRiskScore,
  escalationScore:         _escalationScore,
  downstreamScore:         _downstreamScore,
  moduleCriticalityScore:  _moduleCriticalityScore,
  reopenPenalty:           _reopenPenalty,
  WEIGHTS,
}
