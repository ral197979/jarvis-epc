/**
 * Denver Engineering — Fix Library Service (v4.31.0)
 *
 * Engineer-authored troubleshooting corpus. Retrieval ranks by:
 *   symptom_overlap_ratio × confidence_weight × asset_match × recency
 *
 * Not trying to be pgvector-grade — the signal in symptom tags + asset
 * system is surprisingly strong for commissioning. If quality ever
 * plateaus, the `embedding_json` column in the migration is the upgrade
 * path: add a nightly embed job + cosine rerank, no schema breakage.
 */

import { tenantQuery, query } from '../db/pool'
import { normalizeSystemTag } from './systemTagAlias'
import { buildTsQuery } from './knowledgeSearch'
import { slog } from '../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export type FixConfidence = 'confirmed' | 'probable' | 'suspected'

export interface CreateFixInput {
  tenantId:         string
  projectId?:       string | null
  assetSystem?:     string | null
  assetTag?:        string | null
  symptoms:         string[]
  rootCause:        string
  resolutionSteps:  string
  confidence?:      FixConfidence
  sourceUrl?:       string | null
  sourceNote?:      string | null
  createdBy?:       string | null
}

export interface FixRow {
  id:               string
  tenant_id:        string
  project_id:       string | null
  asset_system:     string | null
  asset_tag:        string | null
  symptoms:         string[]
  root_cause:       string
  resolution_steps: string
  confidence:       FixConfidence
  verified_by:      string | null
  verified_at:      string | null
  source_url:       string | null
  source_note:      string | null
  created_by:       string | null
  created_at:       string
  updated_at:       string
}

export interface FixSearchInput {
  tenantId:      string
  symptoms?:     string[]       // preferred — highest-signal field
  assetSystem?:  string
  assetTag?:     string
  query?:        string         // free-text falls back to FTS
  limit?:        number         // default 5
  minConfidence?: FixConfidence // default 'suspected' (all)
}

export interface FixSearchHit {
  fix:                FixRow
  score:              number            // 0..1
  symptom_overlap:    number            // matched / searched
  why:                string            // human-readable score breakdown
}

// ─── Weights — tuned for commissioning use case ──────────────────────────────

const CONFIDENCE_WEIGHT: Record<FixConfidence, number> = {
  confirmed: 1.0,
  probable:  0.75,
  suspected: 0.5,
}

// Recency half-life in days. Fixes don't decay fast — a 2-year-old
// confirmed fix is still probably right. But very fresh ones edge.
const RECENCY_HALF_LIFE_DAYS = 365

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createFix(input: CreateFixInput): Promise<FixRow> {
  // Normalize tag inputs so retrieval is symmetric.
  const assetTag = input.assetTag ? normalizeSystemTag(input.assetTag) : null
  const symptoms = input.symptoms.map(s => s.trim().toLowerCase()).filter(Boolean)

  if (symptoms.length === 0) {
    throw new Error('at least one symptom required')
  }
  if (!input.rootCause?.trim() || !input.resolutionSteps?.trim()) {
    throw new Error('root_cause and resolution_steps required')
  }

  const res = await tenantQuery<FixRow>(input.tenantId, `
    INSERT INTO knowledge_fixes
      (tenant_id, project_id, asset_system, asset_tag, symptoms,
       root_cause, resolution_steps, confidence,
       source_url, source_note, created_by)
    VALUES
      (current_setting('app.current_tenant_id',true)::uuid,
       $1, $2, $3, $4::text[], $5, $6, COALESCE($7, 'probable'),
       $8, $9, $10)
    RETURNING *
  `, [
    input.projectId ?? null,
    input.assetSystem ?? null,
    assetTag,
    symptoms,
    input.rootCause.trim(),
    input.resolutionSteps.trim(),
    input.confidence ?? null,
    input.sourceUrl ?? null,
    input.sourceNote ?? null,
    input.createdBy ?? null,
  ])
  return res.rows[0]!
}

// ─── Search ──────────────────────────────────────────────────────────────────

export async function searchFixes(input: FixSearchInput): Promise<FixSearchHit[]> {
  const limit = input.limit ?? 5
  const symptomsQ = (input.symptoms ?? []).map(s => s.trim().toLowerCase()).filter(Boolean)
  const assetTag  = input.assetTag ? normalizeSystemTag(input.assetTag) : null

  // Build candidate query. Order of precedence (each OR'd):
  //   - symptom overlap via array &&
  //   - asset_system match
  //   - FTS over narrative if `query` provided
  // A row passing ANY signal is a candidate; ranking happens in JS.
  const conds: string[] = [
    `tenant_id = current_setting('app.current_tenant_id',true)::uuid`,
  ]
  const vals: unknown[] = []
  let i = 1

  const ors: string[] = []
  if (symptomsQ.length > 0) {
    ors.push(`symptoms && $${i++}::text[]`)
    vals.push(symptomsQ)
  }
  if (input.assetSystem) {
    ors.push(`asset_system = $${i++}`)
    vals.push(input.assetSystem)
  }
  if (assetTag) {
    ors.push(`asset_tag = $${i++}`)
    vals.push(assetTag)
  }
  if (input.query && input.query.trim()) {
    // Use OR-rewriter so long natural-language questions still find fixes.
    // Engineering terms are well-defined so lexical + OR-rank works well.
    ors.push(`search_tsv @@ websearch_to_tsquery('english', $${i++})`)
    vals.push(buildTsQuery(input.query.trim()))
  }
  if (ors.length === 0) {
    return []        // no search signal provided — refuse to return the whole corpus
  }
  conds.push(`(${ors.join(' OR ')})`)

  if (input.minConfidence && input.minConfidence !== 'suspected') {
    const allowed = input.minConfidence === 'confirmed'
      ? ['confirmed']
      : ['confirmed','probable']
    conds.push(`confidence = ANY($${i++}::text[])`)
    vals.push(allowed)
  }

  // Limit raw candidate set to keep scoring cheap. Over-select so the
  // ranker has enough to pick from.
  const candidateLimit = Math.max(50, limit * 10)

  // When a free-text query is present, pull ts_rank_cd alongside the row
  // so the JS ranker can use it instead of a flat 0.5 baseline — this
  // lets FTS relevance drive ordering for NL questions.
  const queryParamIdx = input.query?.trim()
    ? vals.findIndex(v => v === buildTsQuery(input.query!.trim())) + 1
    : 0
  const fts = queryParamIdx > 0
    ? `, ts_rank_cd(search_tsv, websearch_to_tsquery('english', $${queryParamIdx}))::float8 AS fts_score`
    : `, 0::float8 AS fts_score`

  const res = await tenantQuery<FixRow & { fts_score: number }>(input.tenantId, `
    SELECT *${fts}
    FROM knowledge_fixes
    WHERE ${conds.join(' AND ')}
    ORDER BY ${queryParamIdx > 0 ? 'fts_score DESC, ' : ''}created_at DESC
    LIMIT ${candidateLimit}
  `, vals)

  const now = Date.now()
  const scored: FixSearchHit[] = res.rows.map(row => {
    const searchedCount = Math.max(symptomsQ.length, 1)
    const matched = symptomsQ.length
      ? row.symptoms.filter(s => symptomsQ.includes(s)).length
      : 0
    const symptomOverlap = symptomsQ.length > 0 ? matched / searchedCount : 0

    const confidenceW = CONFIDENCE_WEIGHT[row.confidence] ?? 0.5

    // Asset match is a multiplier: exact system + tag = 1.0; system only
    // = 0.75; nothing matches = 0.5. Tag alone without system = 0.7.
    let assetMatch = 0.5
    if (input.assetSystem && row.asset_system === input.assetSystem) {
      assetMatch = assetTag && row.asset_tag === assetTag ? 1.0 : 0.75
    } else if (assetTag && row.asset_tag === assetTag) {
      assetMatch = 0.7
    }

    // Recency — exponential half-life
    const ageDays = (now - new Date(row.created_at).getTime()) / 86_400_000
    const recency = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS)

    // Base score prefers symptom overlap; falls back to raw FTS rank
    // when the caller passed a free-text query (NL question from
    // askBuilder). We do NOT clamp fts_score — clamping flattens
    // rank differences and caused ties in production. Multipliers
    // still act as tiebreakers within the same FTS tier.
    const rawFts  = row.fts_score ?? 0
    const baseScore = symptomsQ.length > 0
      ? symptomOverlap
      : (input.query ? rawFts : 0.5)
    const score = baseScore * confidenceW * assetMatch * (0.5 + 0.5 * recency)

    const parts: string[] = []
    if (symptomsQ.length > 0) parts.push(`symptoms ${matched}/${searchedCount}`)
    parts.push(`confidence=${row.confidence}`)
    if (assetMatch > 0.5) parts.push(`asset match=${assetMatch.toFixed(2)}`)
    if (recency < 0.9)   parts.push(`age=${Math.round(ageDays)}d`)

    return { fix: row, score, symptom_overlap: symptomOverlap, why: parts.join(' · ') }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

// ─── Read/delete helpers ─────────────────────────────────────────────────────

export async function getFix(tenantId: string, id: string): Promise<FixRow | null> {
  const res = await tenantQuery<FixRow>(tenantId, `
    SELECT * FROM knowledge_fixes
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
  `, [id])
  return res.rows[0] ?? null
}

export async function deleteFix(tenantId: string, id: string): Promise<boolean> {
  const res = await tenantQuery<{ id: string }>(tenantId, `
    DELETE FROM knowledge_fixes
    WHERE id = $1
      AND tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING id
  `, [id])
  return res.rows.length > 0
}

// ─── Verify (promote confidence) ──────────────────────────────────────────────

export async function verifyFix(
  tenantId: string, id: string, userId: string,
  confidence: FixConfidence = 'confirmed',
): Promise<FixRow | null> {
  const res = await tenantQuery<FixRow>(tenantId, `
    UPDATE knowledge_fixes
    SET    verified_by = $1,
           verified_at = NOW(),
           confidence  = $2
    WHERE  id = $3
      AND  tenant_id = current_setting('app.current_tenant_id',true)::uuid
    RETURNING *
  `, [userId, confidence, id])
  return res.rows[0] ?? null
}

// ─── Distinct tag helper (for UI autocomplete) ────────────────────────────────

/**
 * ADR-014 Phase 3F §52. This is a FACET — the filter options offered for the
 * fix library — derived from the same project-bound rows the list returns. A
 * facet built over rows the caller cannot see leaks their existence just as the
 * rows would, so it takes the same predicate. `scope` is built by the ROUTE
 * from the live principal; the service composes SQL and decides nothing.
 */
export async function listUsedSymptoms(
  tenantId: string,
  scope: { sql: string; params: unknown[] } = { sql: '', params: [] },
): Promise<string[]> {
  const scopeSql = scope.sql.replace(/\$SCOPE_USER/g, '$1')
  const res = await tenantQuery<{ s: string }>(tenantId, `
    SELECT DISTINCT unnest(symptoms) AS s
    FROM   knowledge_fixes
    WHERE  tenant_id = current_setting('app.current_tenant_id',true)::uuid
    ${scopeSql}
    ORDER  BY s
    LIMIT  500
  `, scope.params)
  return res.rows.map(r => r.s)
}

// ─── Tenant-context-free search (for server-side integrations) ───────────────
//
// ciArbiter calls this during commit within an existing tenantTransaction.
// Using `query` directly here would violate RLS; but since the arbiter
// already set app.current_tenant_id inside its transaction, this wrapper
// just reuses that context via `query` — which DOES honor the RLS policy
// because RLS reads the same session variable.
//
// Separated from searchFixes() (which opens its own tenantQuery) to avoid
// nested transactions when called from inside an existing one.
export async function searchFixesInContext(
  input: Omit<FixSearchInput, 'tenantId'>,
  tenantIdForRanking: string,
): Promise<FixSearchHit[]> {
  try {
    return await searchFixes({ ...input, tenantId: tenantIdForRanking })
  } catch (err) {
    slog('WARN', 'fixLibrary', '[searchFixesInContext] failed, returning empty', {
      message: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

// ─── Test-only ────────────────────────────────────────────────────────────────

export const __testHooks = {
  CONFIDENCE_WEIGHT,
  RECENCY_HALF_LIFE_DAYS,
}

// Keep `query` imported so bundlers don't drop it (used by searchFixesInContext's future variants)
void query
