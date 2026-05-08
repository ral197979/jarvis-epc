/**
 * JARVIS EPC — Commissioning Arbiter (v4.31.0)
 *
 * Given a test observation for a commissioning pack, decide:
 *   auto_pass, auto_fail, queued_warmup, queued_novelty, no_rule
 *
 * Decision pipeline (numeric criteria):
 *   1. Resolve autosign rule by scope: project > client > global
 *   2. Apply rule tolerance — fail fast on hard band miss
 *   3. Resolve baseline by scope; if not yet established (sample_count
 *      < rule.baseline_min_samples) → queued_warmup
 *   4. Compute z-score with std-dev floor:
 *        effective_std = max(std_dev, tolerance_band * 0.1, 1e-3)
 *      If |z| > rule.novelty_z_threshold → queued_novelty
 *      Else → auto_pass
 *
 * Boolean criteria bypass the baseline entirely — pure expected/observed
 * comparison, no statistics, no warmup period.
 *
 * A durable `decision_trail` string captures the reasoning:
 *     "rule_pass; baseline=24/30 so queued_warmup"
 *     "rule_pass; z=2.83 above 2.5 threshold so queued_novelty"
 *     "rule_pass; z=0.71 within threshold so auto_pass"
 *     "rule_fail; value 6.45 outside 6.00±0.30 so auto_fail"
 *
 * `arbitrate()` is side-effect-free by default (pure read). Pass
 * `commit: true` to persist the observation, update the baseline
 * atomically, and write an agent_actions row.
 */

import { query, tenantTransaction } from '../db/pool'
import { record as recordAction } from './agentActions'
import { searchFixes, type FixSearchHit } from './fixLibrary'
import { slog } from '../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArbitrationDecision =
  | 'auto_pass'
  | 'auto_fail'
  | 'queued_warmup'
  | 'queued_novelty'
  | 'no_rule'

export interface ArbitrationInput {
  tenantId:       string
  projectId?:     string | null     // the project the test belongs to (for scope lookup + rule linkage)
  clientId?:      string | null     // project.client_name; caller resolves
  systemType:     string
  criteriaName:   string
  unit?:          string
  packId?:        string | null
  userId?:        string | null

  // Provide EXACTLY ONE of these:
  numericValue?:  number
  booleanValue?:  boolean
}

export interface ArbitrationResult {
  decision:        ArbitrationDecision
  decision_trail:  string
  rule_id:         string | null
  baseline_id:     string | null
  z_score:         number | null
  evidence:        Record<string, unknown>
  agent_action_id?: string | null  // populated when commit=true
  observation_id?:  string | null
}

interface RuleRow {
  id: string
  scope: 'global'|'client'|'project'
  system_type: string
  criteria_name: string
  criteria_kind: 'numeric'|'boolean'
  target_value:  string | null
  tolerance_pct: string | null
  tolerance_abs: string | null
  unit:          string | null
  expected_bool: boolean | null
  baseline_min_samples: number
  novelty_z_threshold:  string    // numeric comes back as string from pg
}

interface BaselineRow {
  id: string
  sample_count: number
  mean_value:   string | null
  std_dev:      string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Absolute minimum for effective std so z-score can't explode on a
// flat-distribution criterion even when tolerance is also zero.
const STD_FLOOR_EPSILON = 0.001

// ─── Public API ───────────────────────────────────────────────────────────────

export async function arbitrate(
  input: ArbitrationInput,
  opts:  { commit?: boolean } = {},
): Promise<ArbitrationResult> {
  const commit = opts.commit ?? false

  // Validate input shape
  const hasNumeric = typeof input.numericValue === 'number' && Number.isFinite(input.numericValue)
  const hasBool    = typeof input.booleanValue === 'boolean'
  if (hasNumeric === hasBool) {
    // either both or neither provided
    return noRule(`invalid input: must provide exactly one of numericValue or booleanValue`)
  }

  // 1. Resolve rule
  const rule = await _lookupRule(input)
  if (!rule) {
    const result: ArbitrationResult = {
      decision:       'no_rule',
      decision_trail: `no autosign rule for (${input.systemType}, ${input.criteriaName}) in any scope`,
      rule_id:        null,
      baseline_id:    null,
      z_score:        null,
      evidence:       { system_type: input.systemType, criteria_name: input.criteriaName },
    }
    if (commit) result.agent_action_id = await _writeAction(input, result)
    return result
  }

  // 2. Route by kind
  const result = rule.criteria_kind === 'boolean'
    ? await _arbitrateBoolean(input, rule, commit)
    : await _arbitrateNumeric(input, rule, commit)

  // 3. Enrich non-pass outcomes with fix-library hits so the PM sees
  //    "here's what fixed this last time" in the review queue.
  //    Pure additive — never changes the decision itself; only annotates.
  if (result.decision === 'auto_fail' || result.decision === 'queued_novelty') {
    await _attachFixHints(input, result)
  }
  return result
}

// ─── Fix-library enrichment ──────────────────────────────────────────────────

async function _attachFixHints(
  input:  ArbitrationInput,
  result: ArbitrationResult,
): Promise<void> {
  try {
    // Symptom derivation: use the criteria_name plus a directional tag
    // ('low_*' / 'high_*' / 'anomalous_*') so a fix tagged 'low_inlet_pressure'
    // matches a below-band failure without exact-name coordination.
    const symptoms = _deriveSymptoms(input, result)
    const hits: FixSearchHit[] = await searchFixes({
      tenantId:    input.tenantId,
      symptoms,
      assetSystem: input.systemType,
      limit:       3,
    })

    if (hits.length === 0) return

    // Attach the top hits to the evidence (JSONB, already a bag).
    const ev = result.evidence as Record<string, unknown>
    ev['fix_hints'] = hits.map(h => ({
      fix_id:       h.fix.id,
      score:        Number(h.score.toFixed(3)),
      confidence:   h.fix.confidence,
      root_cause:   h.fix.root_cause,
      resolution:   h.fix.resolution_steps.slice(0, 240),   // preview, UI shows full
      asset_system: h.fix.asset_system,
      why:          h.why,
    }))

    // Append the best hit to the decision trail so review queue tables
    // surface it without expanding the evidence JSON.
    const top = hits[0]!
    if (top.score >= 0.4) {
      result.decision_trail +=
        ` · prior fix (${top.fix.confidence}, score=${top.score.toFixed(2)}): ` +
        top.fix.root_cause.slice(0, 120)
    }
  } catch (err) {
    // Fix-search is enrichment; never block a decision.
    slog('WARN', 'ciArbiter', '[fix-hints] search failed', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

function _deriveSymptoms(input: ArbitrationInput, result: ArbitrationResult): string[] {
  const base = input.criteriaName.toLowerCase()
  const tags: string[] = [base]

  // Directional tag for numeric failures based on evidence.
  const ev = result.evidence as Record<string, unknown>
  const value  = ev['value']  as number | undefined
  const target = ev['target'] as number | undefined
  if (typeof value === 'number' && typeof target === 'number') {
    if (result.decision === 'auto_fail') {
      tags.push(value < target ? `low_${base}`  : `high_${base}`)
    } else if (result.decision === 'queued_novelty') {
      tags.push(`anomalous_${base}`)
    }
  }
  return tags
}

// ─── Rule lookup ──────────────────────────────────────────────────────────────

async function _lookupRule(input: ArbitrationInput): Promise<RuleRow | null> {
  // Scope-ordered lookup: project > client > global. LIMIT 1 returns
  // the most specific applicable rule.
  const res = await query<RuleRow>(`
    SELECT id, scope, system_type, criteria_name, criteria_kind,
           target_value::text, tolerance_pct::text, tolerance_abs::text,
           unit, expected_bool, baseline_min_samples,
           novelty_z_threshold::text
    FROM   commissioning_autosign_rules
    WHERE  tenant_id    = $1
      AND  enabled      = TRUE
      AND  system_type  = $2
      AND  criteria_name = $3
      AND  (
        (scope = 'project' AND project_id = $4)
        OR (scope = 'client'  AND client_id  = $5)
        OR (scope = 'global')
      )
    ORDER BY CASE scope
               WHEN 'project' THEN 0
               WHEN 'client'  THEN 1
               WHEN 'global'  THEN 2
             END
    LIMIT 1
  `, [
    input.tenantId, input.systemType, input.criteriaName,
    input.projectId ?? null, input.clientId ?? null,
  ])
  return res.rows[0] ?? null
}

// ─── Boolean arbitration ──────────────────────────────────────────────────────

async function _arbitrateBoolean(
  input: ArbitrationInput,
  rule:  RuleRow,
  commit: boolean,
): Promise<ArbitrationResult> {
  const expected = rule.expected_bool!
  const observed = input.booleanValue!
  const pass = observed === expected
  const trail = pass
    ? `boolean rule_pass; observed=${observed} matches expected=${expected} so auto_pass`
    : `boolean rule_fail; observed=${observed} expected=${expected} so auto_fail`

  const result: ArbitrationResult = {
    decision:       pass ? 'auto_pass' : 'auto_fail',
    decision_trail: trail,
    rule_id:        rule.id,
    baseline_id:    null,              // booleans don't use baselines
    z_score:        null,
    evidence:       { expected, observed, criteria_kind: 'boolean' },
  }
  if (commit) {
    result.agent_action_id = await _writeAction(input, result)
  }
  return result
}

// ─── Numeric arbitration ─────────────────────────────────────────────────────

async function _arbitrateNumeric(
  input: ArbitrationInput,
  rule:  RuleRow,
  commit: boolean,
): Promise<ArbitrationResult> {
  const value  = input.numericValue!
  const target = parseFloat(rule.target_value!)
  const tolAbs = rule.tolerance_abs != null ? parseFloat(rule.tolerance_abs) : null
  const tolPct = rule.tolerance_pct != null ? parseFloat(rule.tolerance_pct) : null

  // Compute the effective tolerance band in absolute units.
  const toleranceBand = tolAbs != null
    ? tolAbs
    : Math.abs(target) * (tolPct! / 100)

  const lo = target - toleranceBand
  const hi = target + toleranceBand

  // 1. Hard band check
  if (value < lo || value > hi) {
    const trail = `rule_fail; value ${fmt(value)} outside ${fmt(target)}±${fmt(toleranceBand)} so auto_fail`
    const result: ArbitrationResult = {
      decision:       'auto_fail',
      decision_trail: trail,
      rule_id:        rule.id,
      baseline_id:    null,
      z_score:        null,
      evidence:       { value, target, tolerance_band: toleranceBand, lo, hi },
    }
    if (commit) {
      const written = await _commitNumeric(input, rule, result, value, null)
      result.agent_action_id = written.actionId
      result.observation_id  = written.observationId
      result.baseline_id     = written.baselineId
    }
    return result
  }

  // 2. Rule passed. Look up baseline; may not exist yet.
  const baseline = await _lookupBaseline(input)

  // 3. Warmup gate
  const minSamples = rule.baseline_min_samples
  if (!baseline || baseline.sample_count < minSamples) {
    const have = baseline?.sample_count ?? 0
    const trail = `rule_pass; baseline=${have}/${minSamples} so queued_warmup`
    const result: ArbitrationResult = {
      decision:       'queued_warmup',
      decision_trail: trail,
      rule_id:        rule.id,
      baseline_id:    baseline?.id ?? null,
      z_score:        null,
      evidence:       { value, target, tolerance_band: toleranceBand,
                        baseline_samples: have, baseline_min_samples: minSamples },
    }
    if (commit) {
      const written = await _commitNumeric(input, rule, result, value, null)
      result.agent_action_id = written.actionId
      result.observation_id  = written.observationId
      result.baseline_id     = written.baselineId
    }
    return result
  }

  // 4. Compute z-score with std-dev floor
  const mean   = parseFloat(baseline.mean_value!)
  const rawStd = parseFloat(baseline.std_dev!)
  const effectiveStd = Math.max(rawStd, toleranceBand * 0.1, STD_FLOOR_EPSILON)
  const z = (value - mean) / effectiveStd
  const zThreshold = parseFloat(rule.novelty_z_threshold)

  if (Math.abs(z) > zThreshold) {
    const trail = `rule_pass; z=${z.toFixed(2)} above ${zThreshold.toFixed(2)} threshold so queued_novelty`
    const result: ArbitrationResult = {
      decision:       'queued_novelty',
      decision_trail: trail,
      rule_id:        rule.id,
      baseline_id:    baseline.id,
      z_score:        z,
      evidence:       {
        value, target, tolerance_band: toleranceBand,
        baseline_mean: mean, baseline_std_raw: rawStd, effective_std: effectiveStd,
        z_score: z, z_threshold: zThreshold,
      },
    }
    if (commit) {
      const written = await _commitNumeric(input, rule, result, value, z)
      result.agent_action_id = written.actionId
      result.observation_id  = written.observationId
    }
    return result
  }

  // 5. Auto-pass
  const trail = `rule_pass; z=${z.toFixed(2)} within ${zThreshold.toFixed(2)} threshold so auto_pass`
  const result: ArbitrationResult = {
    decision:       'auto_pass',
    decision_trail: trail,
    rule_id:        rule.id,
    baseline_id:    baseline.id,
    z_score:        z,
    evidence:       {
      value, target, tolerance_band: toleranceBand,
      baseline_mean: mean, baseline_std_raw: rawStd, effective_std: effectiveStd,
      z_score: z, z_threshold: zThreshold,
    },
  }
  if (commit) {
    const written = await _commitNumeric(input, rule, result, value, z)
    result.agent_action_id = written.actionId
    result.observation_id  = written.observationId
  }
  return result
}

// ─── Baseline lookup ──────────────────────────────────────────────────────────

async function _lookupBaseline(input: ArbitrationInput): Promise<BaselineRow | null> {
  // Same scope precedence as rules — most specific wins.
  const res = await query<BaselineRow>(`
    SELECT id, sample_count,
           mean_value::text, std_dev::text
    FROM   commissioning_baselines
    WHERE  tenant_id    = $1
      AND  system_type  = $2
      AND  criteria_name = $3
      AND  (
        (scope = 'project' AND project_id = $4)
        OR (scope = 'client'  AND client_id  = $5)
        OR (scope = 'global')
      )
    ORDER BY CASE scope
               WHEN 'project' THEN 0
               WHEN 'client'  THEN 1
               WHEN 'global'  THEN 2
             END
    LIMIT 1
  `, [
    input.tenantId, input.systemType, input.criteriaName,
    input.projectId ?? null, input.clientId ?? null,
  ])
  return res.rows[0] ?? null
}

// ─── Commit (write observation + refresh baseline + write agent_action) ──────

interface CommitResult {
  actionId:      string | null
  observationId: string | null
  baselineId:    string | null
}

async function _commitNumeric(
  input:  ArbitrationInput,
  rule:   RuleRow,
  result: ArbitrationResult,
  value:  number,
  zScore: number | null,
): Promise<CommitResult> {
  return tenantTransaction(input.tenantId, async (client) => {
    // Ensure a baseline row exists for this scope/criterion tuple. We
    // upsert one at the most-specific applicable scope — if a project
    // is provided, the baseline is project-scoped; otherwise client;
    // otherwise global. Matches where future observations land.
    const scope     = input.projectId ? 'project' : input.clientId ? 'client' : 'global'
    const clientId  = scope === 'client'  ? input.clientId  : null
    const projectId = scope === 'project' ? input.projectId : null

    const upsertRes = await client.query<{ id: string }>(`
      INSERT INTO commissioning_baselines
        (tenant_id, scope, client_id, project_id, system_type, criteria_name)
      VALUES
        (current_setting('app.current_tenant_id',true)::uuid, $1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id, scope, client_id, project_id, system_type, criteria_name)
      DO UPDATE SET updated_at = NOW()
      RETURNING id
    `, [scope, clientId, projectId, input.systemType, input.criteriaName])

    const baselineId = upsertRes.rows[0]!.id

    // Record observation
    const obsRes = await client.query<{ id: string }>(`
      INSERT INTO commissioning_observations
        (tenant_id, baseline_id, pack_id, rule_id, value,
         decision, decision_reason, z_score, created_by)
      VALUES
        (current_setting('app.current_tenant_id',true)::uuid,
         $1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      baselineId, input.packId ?? null, rule.id, value,
      result.decision, result.decision_trail, zScore, input.userId ?? null,
    ])
    const observationId = obsRes.rows[0]!.id

    // Recompute baseline from observations in the rolling window.
    // Cheap query (indexed on baseline_id + created_at) and correct by
    // construction — no incremental-stats drift risk.
    await client.query(`
      WITH win AS (
        SELECT value::float8 AS v FROM commissioning_observations
        WHERE baseline_id = $1
          AND decision IN ('auto_pass','human_pass')
          AND created_at >= NOW() - make_interval(days =>
              (SELECT window_days FROM commissioning_baselines WHERE id = $1))
      ),
      agg AS (
        SELECT
          COUNT(*)                  AS n,
          AVG(v)                    AS mean,
          STDDEV_SAMP(v)            AS std,
          MIN(v)                    AS mn,
          MAX(v)                    AS mx,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY v) AS p25,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY v) AS p75
        FROM win
      )
      UPDATE commissioning_baselines b
      SET    sample_count   = agg.n,
             mean_value     = agg.mean,
             std_dev        = agg.std,
             min_observed   = agg.mn,
             max_observed   = agg.mx,
             p25_value      = agg.p25,
             p75_value      = agg.p75,
             last_sample_at = NOW(),
             updated_at     = NOW()
      FROM   agg
      WHERE  b.id = $1
    `, [baselineId])

    // Emit agent_action. Note: record() opens its own connection and
    // tolerates failure silently; acceptable since the observation +
    // baseline update are already committed in this transaction.
    const actionId = await recordAction({
      tenantId:       input.tenantId,
      projectId:      input.projectId ?? null,
      agentName:      'ci_arbiter',
      actionType:     'commissioning_arbitration',
      targetType:     'observation',
      targetId:       observationId,
      decision:       result.decision === 'auto_pass'     ? 'auto_pass'
                    : result.decision === 'auto_fail'     ? 'auto_fail'
                    : 'queued',
      rationale:      result.decision_trail,
      ruleId:         rule.id,
      evidence:       result.evidence,
      confidence:     zScore != null
                        ? Math.max(0, 1 - Math.abs(zScore) / 5)   // rough: z=0 → 1.0, z=5 → 0
                        : null,
      // Queued outcomes always want human eyeball; clean passes/fails don't.
      humanReviewable: result.decision.startsWith('queued'),
    })

    return { actionId, observationId, baselineId }
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function noRule(reason: string): ArbitrationResult {
  return {
    decision:       'no_rule',
    decision_trail: reason,
    rule_id:        null,
    baseline_id:    null,
    z_score:        null,
    evidence:       {},
  }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(4).replace(/\.?0+$/, '')
}

async function _writeAction(input: ArbitrationInput, result: ArbitrationResult): Promise<string | null> {
  try {
    return await recordAction({
      tenantId:        input.tenantId,
      projectId:       input.projectId ?? null,
      agentName:       'ci_arbiter',
      actionType:      'commissioning_arbitration',
      targetType:      'observation',
      targetId:        null,
      decision:        result.decision === 'auto_pass' ? 'auto_pass'
                     : result.decision === 'auto_fail' ? 'auto_fail'
                     : 'queued',
      rationale:       result.decision_trail,
      ruleId:          result.rule_id,
      evidence:        result.evidence,
      humanReviewable: result.decision !== 'auto_pass',
    })
  } catch (err) {
    slog('ERROR', 'ciArbiter', '[commit] Action log write failed', {
      message: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

// ─── Test-only exports ────────────────────────────────────────────────────────

export const __testHooks = {
  STD_FLOOR_EPSILON,
  fmt,
}
