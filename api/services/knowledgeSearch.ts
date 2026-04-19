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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KnowledgeSearchInput {
  tenantId:    string
  query:       string
  topK?:       number        // default 8
  sourceIds?:  string[]
  tags?:       string[]
  assetSystem?: string
  licenseTypes?: string[]
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
  score:         number
  rank_type:     'lexical'    // reserved for future 'semantic' | 'blended'
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function searchKnowledge(input: KnowledgeSearchInput): Promise<KnowledgeHit[]> {
  const q = input.query?.trim()
  if (!q) return []

  const topK = Math.min(50, Math.max(1, input.topK ?? 8))

  // Build filter clauses. Start with the tenant + FTS match as hard
  // filters; layer optional filters on top.
  const conds: string[] = [
    `c.tenant_id = current_setting('app.current_tenant_id',true)::uuid`,
    `c.search_tsv @@ websearch_to_tsquery('english', $1)`,
    `s.status = 'ready'`,
  ]
  const vals: unknown[] = [q]
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
    LIMIT ${topK}
  `, vals)

  return res.rows.map(r => ({
    chunk_id:     r.chunk_id,
    source_id:    r.source_id,
    source_title: r.source_title,
    source_kind:  r.source_kind,
    license_type: r.license_type,
    page_ref:     r.page_ref,
    ordinal:      r.ordinal,
    text:         r.text,
    score:        Number(r.score),
    rank_type:    'lexical',
  }))
}
