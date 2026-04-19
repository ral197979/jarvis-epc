/**
 * Tests: api/services/knowledgeSearch.ts
 * Focus: query construction + empty-query short-circuit + filter application.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  tenantQuery: (_tenantId: string, sql: string, params: unknown[]) => mockQuery(sql, params),
  query:       (sql: string, params: unknown[]) => mockQuery(sql, params),
}))

import { searchKnowledge } from '../services/knowledgeSearch'

describe('searchKnowledge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns [] for empty query without hitting the DB', async () => {
    const hits = await searchKnowledge({ tenantId: 't', query: '   ' })
    expect(hits).toEqual([])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('builds a websearch_to_tsquery + ts_rank_cd query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await searchKnowledge({ tenantId: 't', query: 'oil pressure trip' })
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toMatch(/websearch_to_tsquery/)
    expect(sql).toMatch(/ts_rank_cd/)
    expect(params[0]).toBe('oil pressure trip')
  })

  it('applies source_ids / tags / asset_system / license_types filters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await searchKnowledge({
      tenantId: 't', query: 'foo',
      sourceIds: ['a','b'], tags: ['hvac'], assetSystem: 'chiller',
      licenseTypes: ['owned','public_domain'],
    })
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toMatch(/source_id = ANY/)
    expect(sql).toMatch(/asset_system/)
    expect(sql).toMatch(/tags &&/)
    expect(sql).toMatch(/license_type = ANY/)
    expect(params).toContain('chiller')
  })

  it('maps DB rows to KnowledgeHit with numeric score + lexical rank_type', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{
      chunk_id: 'c-1', source_id: 's-1', source_title: 'Manual', source_kind: 'pdf',
      license_type: 'owned', page_ref: 'p. 42', ordinal: 3,
      text: 'Replace filter cartridge.', score: '0.37421',
    }] })
    const hits = await searchKnowledge({ tenantId: 't', query: 'replace filter' })
    expect(hits).toHaveLength(1)
    expect(hits[0]!.score).toBeCloseTo(0.37421, 5)
    expect(hits[0]!.rank_type).toBe('lexical')
    expect(hits[0]!.source_title).toBe('Manual')
  })

  it('clamps topK to [1,50]', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] })
    await searchKnowledge({ tenantId: 't', query: 'foo', topK: 999 })
    const [sql] = mockQuery.mock.calls[0]!
    expect(sql).toMatch(/LIMIT 50/)
  })
})
