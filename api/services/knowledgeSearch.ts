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
  score:         number         // post-weight final score
  lexical_score: number         // raw FTS score (pre-weight)
  tier:          SourceTier
  rank_type:     'lexical' | 'tier_weighted'
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Build an OR-joined tsquery text from a natural-language question.
// Rationale: websearch_to_tsquery's default AND semantics make long
// questions fail (every term must co-occur in one chunk). Rewriting to
// OR lets ts_rank_cd rank by how many + how close the terms match — which
// is what we actually want for RAG. For short "strict" queries like
// 'Carrier 30XA' the OR form still finds the exact same chunk at the top.
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
  return candidates.slice(0, topK)
}
