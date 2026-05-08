/**
 * JARVIS EPC — Knowledge Base Retrieval (v4.31.0)
 *
 * v1 retrieval: PostgreSQL full-text search with ts_rank_cd scoring,
 * filtered by tenant + optional tags/asset_system/source_ids. Returns
 * chunks with provenance (source title, page_ref, license) so every
 * result is auditable back to its document.
 *
 * Semantic upgrade path (not active): when embedding_json is populated
 * for chunks, this service blends lexical score w/ cosine rerank. For
 * now the blend is skipped since no embeddings exist.
 */

import { tenantQuery } from '../db/pool'
import { classifySource, TIER_WEIGHT, type SourceTier } from './knowledgeTier'
import { embedTexts, toPgVectorLiteral } from './embed'
import { slog } from '../../src/modules/observability/index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KnowledgeSearchInput {
  tenantId:     string
  query:        string
  topK?:        number        // default 8
  sourceIds?:   string[]
  tags?:        string[]
  assetSystem?: string
  licenseTypes?: string[]
  projectId?:   string        // restrict to sources tied to a project
  // Apply source-tier weighting (OEM > record > other > form).
  // Default off for back-compat with callers that want raw lexical scoring.
  applyTierBoost?: boolean
  // Over-fetch multiplier when tier-boosting: pull more candidates and
  // let the re-rank pick the best topK. Default 4.
  tierOverFetch?: number
  // Phase 3: blend lexical FTS with pgvector cosine similarity.
  // Fails open — if no embedding provider / no embedded chunks, falls
  // back silently to pure lexical. Default true for askBuilder callers.
  useSemantic?: boolean
  // Weight for the semantic contribution (0 = pure lexical, 1 = pure
  // semantic). Default 0.55, slightly favoring semantic once corpus
  // is embedded. Blend happens on candidates present in both result sets.
  semanticWeight?: number
}

export interface KnowledgeHit {
  chunk_id:      string
  source_id:     string
  source_title:  string
  source_kind:   string
  license_type:  string
  page_ref:      string | null
  ordinal:       number
  text:          string
  score:         number         // post-weight final score (blended if semantic on)
  lexical_score: number         // raw FTS score (pre-weight)
  semantic_score?: number       // cosine similarity in 0..1 (higher = closer)
  tier:          SourceTier
  rank_type:     'lexical' | 'tier_weighted' | 'hybrid'
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Build an OR-joined tsquery text from a natural-language question.
// Rationale: websearch_to_tsquery's default AND semantics make long
// questions fail (every term must co-occur in one chunk). Rewriting to
// OR lets ts_rank_cd rank by how many + how close the terms match — which
// is what we actually want for RAG. For short "strict" queries like
// 'Carrier 30XA' the OR form still finds the exact same chunk at the top.
//
// Exported so other FTS-backed services (fixLibrary) can share the fix.
export function buildTsQuery(text: string): string {
  return _buildTsQuery(text)
}
function _buildTsQuery(text: string): string {
  const STOP = new Set([
    'a','an','and','are','as','at','be','by','for','from','has','have','he',
    'in','is','it','its','of','on','or','that','the','to','was','were','will',
    'with','i','my','do','does','did','how','what','when','where','which','who',
    'why','this','these','those','than','there','their','them','can','could',
    'should','would','shall','may','might','must','not','no','you','your',
  ])
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^-+|-+$/g, ''))   // trim stray hyphens
    .filter(w => w.length >= 2 && !STOP.has(w))
  if (words.length === 0) return text        // fallback: original string

  // websearch_to_tsquery reads `or` as OR (since PG 11). Dedupe to avoid
  // `foo or foo or bar` bloat when users repeat terms.
  return Array.from(new Set(words)).join(' or ')
}

export async function searchKnowledge(input: KnowledgeSearchInput): Promise<KnowledgeHit[]> {
  const q = input.query?.trim()
  if (!q) return []

  const tsQuery = _buildTsQuery(q)
  const topK = Math.min(50, Math.max(1, input.topK ?? 8))

  // Build filter clauses. Start with the tenant + FTS match as hard
  // filters; layer optional filters on top.
  const conds: string[] = [
    `c.tenant_id = current_setting('app.current_tenant_id',true)::uuid`,
    `c.search_tsv @@ websearch_to_tsquery('english', $1)`,
    `s.status = 'ready'`,
  ]
  const vals: unknown[] = [tsQuery]
  let i = 2

  if (input.sourceIds && input.sourceIds.length > 0) {
    conds.push(`c.source_id = ANY($${i++}::uuid[])`)
    vals.push(input.sourceIds)
  }
  if (input.assetSystem) {
    conds.push(`s.asset_system = $${i++}`)
    vals.push(input.assetSystem)
  }
  if (input.tags && input.tags.length > 0) {
    conds.push(`s.tags && $${i++}::text[]`)
    vals.push(input.tags)
  }
  if (input.licenseTypes && input.licenseTypes.length > 0) {
    conds.push(`s.license_type = ANY($${i++}::text[])`)
    vals.push(input.licenseTypes)
  }

  if (input.projectId) {
    conds.push(`s.project_id = $${i++}`)
    vals.push(input.projectId)
  }

  // When tier-boosting, over-fetch so re-rank has room to promote low-
  // lexical-rank OEM hits over high-lexical-rank form hits.
  const applyBoost = !!input.applyTierBoost
  const overFetch  = applyBoost ? Math.max(1, input.tierOverFetch ?? 4) : 1
  const fetchLimit = Math.min(200, topK * overFetch)

  const res = await tenantQuery<{
    chunk_id:     string
    source_id:    string
    source_title: string
    source_kind:  string
    license_type: string
    page_ref:     string | null
    ordinal:      number
    text:         string
    score:        string
  }>(input.tenantId, `
    SELECT
      c.id              AS chunk_id,
      c.source_id       AS source_id,
      s.title           AS source_title,
      s.kind            AS source_kind,
      s.license_type    AS license_type,
      c.page_ref        AS page_ref,
      c.ordinal         AS ordinal,
      c.text            AS text,
      ts_rank_cd(c.search_tsv,
                 websearch_to_tsquery('english', $1))::text AS score
    FROM knowledge_chunks c
    JOIN knowledge_sources s ON s.id = c.source_id
    WHERE ${conds.join(' AND ')}
    ORDER BY score DESC
    LIMIT ${fetchLimit}
  `, vals)

  // Raw mapping from DB rows.
  const candidates: KnowledgeHit[] = res.rows.map(r => {
    const lex  = Number(r.score)
    const tier = classifySource(r.source_title, r.source_kind)
    const finalScore = applyBoost ? lex * TIER_WEIGHT[tier] : lex
    return {
      chunk_id:      r.chunk_id,
      source_id:     r.source_id,
      source_title:  r.source_title,
      source_kind:   r.source_kind,
      license_type:  r.license_type,
      page_ref:      r.page_ref,
      ordinal:       r.ordinal,
      text:          r.text,
      score:         finalScore,
      lexical_score: lex,
      tier,
      rank_type:     applyBoost ? 'tier_weighted' : 'lexical',
    }
  })

  if (applyBoost) {
    candidates.sort((a, b) => b.score - a.score)
  }

  // ── Phase 3 hybrid: blend in semantic similarity when requested ─────────────
  // We compute semantic scores OVER THE LEXICAL CANDIDATE SET plus a
  // semantic-native candidate list; both are unioned. This gives us
  // synonym-recall (chunks that match semantically but not lexically)
  // AND preserves precision (strong lexical matches rank high regardless).
  // Provider-agnostic check — we're happy if EITHER OpenAI or Together
  // has a key. The embed service auto-picks the right one.
  const hasEmbedProvider = !!process.env['OPENAI_API_KEY'] || !!process.env['TOGETHER_AI_API_KEY']
  const wantSemantic = input.useSemantic !== false && hasEmbedProvider
  if (wantSemantic) {
    const blended = await _applySemanticBlend(input, candidates, tsQuery, conds, vals, i, fetchLimit, topK)
    if (blended) return blended
  }
  return candidates.slice(0, topK)
}

// ─── Semantic blend helper ────────────────────────────────────────────────────
//
// Pulls a second candidate set using pgvector cosine distance, merges
// with the lexical candidates, normalizes + blends scores, and applies
// the tier boost (same as the lexical path).
//
// Returns null if no embeddings exist yet or the embedder isn't
// reachable — caller then falls back to pure lexical.
async function _applySemanticBlend(
  input:         KnowledgeSearchInput,
  lexical:       KnowledgeHit[],
  _tsQuery:      string,
  _baseConds:    string[],
  _baseVals:     unknown[],
  _nextParamIdx: number,
  fetchLimit:    number,
  topK:          number,
): Promise<KnowledgeHit[] | null> {
  const semanticWeight = Math.min(1, Math.max(0, input.semanticWeight ?? 0.55))
  const applyBoost = !!input.applyTierBoost

  let queryVec: number[]
  try {
    const r = await embedTexts([input.query])
    queryVec = r.vectors[0] ?? []
    if (queryVec.length === 0) return null
  } catch (err) {
    slog('WARN', 'knowledgeSearch',
      `[hybrid] embedding call failed (${err instanceof Error ? err.message.slice(0, 200) : String(err)}) — falling back to lexical`)
    return null
  }

  // Build the vector query with FRESH parameters. We cannot reuse the
  // lexical path's vals[] because it includes the tsQuery at $1 — if
  // we drop the tsvector condition but keep that param, Postgres can't
  // infer its type and the query errors. So re-thread filters here.
  const semConds: string[] = [
    `c.tenant_id = current_setting('app.current_tenant_id',true)::uuid`,
    `c.embedding IS NOT NULL`,
    `s.status = 'ready'`,
  ]
  const semVals: unknown[] = []
  let pi = 1
  if (input.sourceIds && input.sourceIds.length > 0) {
    semConds.push(`c.source_id = ANY($${pi++}::uuid[])`)
    semVals.push(input.sourceIds)
  }
  if (input.assetSystem) {
    semConds.push(`s.asset_system = $${pi++}`)
    semVals.push(input.assetSystem)
  }
  if (input.tags && input.tags.length > 0) {
    semConds.push(`s.tags && $${pi++}::text[]`)
    semVals.push(input.tags)
  }
  if (input.licenseTypes && input.licenseTypes.length > 0) {
    semConds.push(`s.license_type = ANY($${pi++}::text[])`)
    semVals.push(input.licenseTypes)
  }
  if (input.projectId) {
    semConds.push(`s.project_id = $${pi++}`)
    semVals.push(input.projectId)
  }
  const semIdx = pi
  semVals.push(toPgVectorLiteral(queryVec))

  let semRes
  const vecSqlParams = semVals.slice()
  try {
    semRes = await tenantQuery<{
      chunk_id:     string
      source_id:    string
      source_title: string
      source_kind:  string
      license_type: string
      page_ref:     string | null
      ordinal:      number
      text:         string
      cosine_dist:  string
    }>(input.tenantId, `
      SELECT
        c.id              AS chunk_id,
        c.source_id       AS source_id,
        s.title           AS source_title,
        s.kind            AS source_kind,
        s.license_type    AS license_type,
        c.page_ref        AS page_ref,
        c.ordinal         AS ordinal,
        c.text            AS text,
        (c.embedding <=> $${semIdx}::vector)::text AS cosine_dist
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      WHERE ${semConds.join(' AND ')}
      ORDER BY c.embedding <=> $${semIdx}::vector
      LIMIT ${fetchLimit}
    `, semVals)
  } catch (err) {
    // Put full error text into msg since slog doesn't print the context obj
    const emsg = err instanceof Error ? err.message : String(err)
    slog('WARN', 'knowledgeSearch', `[hybrid] vector query failed (${emsg.slice(0, 300)}) — falling back to lexical. paramCount=${vecSqlParams.length} semIdx=${semIdx}`)
    return null
  }

  if (semRes.rows.length === 0) return null        // corpus not embedded yet

  // Convert distance → similarity in 0..1.
  // pgvector's `<=>` returns 0 for identical, up to 2 for opposite.
  // sim = 1 - dist/2 bounds it in [0,1].
  const semanticHits: KnowledgeHit[] = semRes.rows.map(r => {
    const dist = Number(r.cosine_dist)
    const sim  = Math.max(0, 1 - dist / 2)
    const tier = classifySource(r.source_title, r.source_kind)
    return {
      chunk_id:       r.chunk_id,
      source_id:      r.source_id,
      source_title:   r.source_title,
      source_kind:    r.source_kind,
      license_type:   r.license_type,
      page_ref:       r.page_ref,
      ordinal:        r.ordinal,
      text:           r.text,
      score:          sim,                   // placeholder; blend computed below
      lexical_score:  0,
      semantic_score: sim,
      tier,
      rank_type:      'hybrid',
    }
  })

  // Merge by chunk_id; lexical score + semantic score live on the same row.
  const byId = new Map<string, KnowledgeHit>()
  for (const h of lexical) {
    byId.set(h.chunk_id, { ...h, rank_type: 'hybrid', semantic_score: 0 })
  }
  for (const s of semanticHits) {
    const existing = byId.get(s.chunk_id)
    if (existing) {
      existing.semantic_score = s.semantic_score
    } else {
      byId.set(s.chunk_id, s)
    }
  }

  // Normalize lexical score to 0..1 relative to the max in this result set.
  const maxLex = Math.max(
    ...Array.from(byId.values()).map(h => h.lexical_score),
    0.0001,
  )
  // Blend + apply tier boost.
  for (const h of byId.values()) {
    const lex   = h.lexical_score / maxLex
    const sem   = h.semantic_score ?? 0
    const blend = (1 - semanticWeight) * lex + semanticWeight * sem
    h.score = applyBoost ? blend * TIER_WEIGHT[h.tier] : blend
  }

  const merged = Array.from(byId.values())
  merged.sort((a, b) => b.score - a.score)
  return merged.slice(0, topK)
}
