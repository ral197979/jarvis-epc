/**
 * Tests: api/services/askBuilder.ts
 * Unit tests for the deterministic parts: prompt building, truncation.
 * The actual Anthropic call is not exercised here (network + cost).
 */

import { describe, it, expect } from 'vitest'
import { __testHooks } from '../services/askBuilder'
import type { KnowledgeHit } from '../services/knowledgeSearch'
import type { FixSearchHit } from '../services/fixLibrary'

const { _buildContextBlock, _truncate, RECORD_ANSWER_TOOL, SYSTEM_PROMPT } = __testHooks

// ─── _truncate ────────────────────────────────────────────────────────────────

describe('_truncate', () => {
  it('short string unchanged', () => {
    expect(_truncate('hello', 100)).toBe('hello')
  })
  it('long string clipped w/ ellipsis', () => {
    const r = _truncate('a'.repeat(50), 20)
    expect(r.length).toBeLessThanOrEqual(20)
    expect(r.endsWith('...')).toBe(true)
  })
  it('trims trailing whitespace before the ellipsis', () => {
    expect(_truncate('hello        world', 10)).toMatch(/\.\.\.$/)
  })
})

// ─── _buildContextBlock ───────────────────────────────────────────────────────

function mkChunk(over: Partial<KnowledgeHit>): KnowledgeHit {
  return {
    chunk_id: 'c1', source_id: 's1', source_title: 'Carrier 30XA IOM',
    source_kind: 'pdf', license_type: 'owned', page_ref: 'p. 47', ordinal: 3,
    text: 'Check oil pressure before startup.', score: 0.9, lexical_score: 0.6,
    tier: 'oem', rank_type: 'tier_weighted', ...over,
  }
}

function mkFix(): FixSearchHit {
  return {
    fix: {
      id: 'f1', tenant_id: 't', project_id: null,
      asset_system: 'chiller', asset_tag: 'CH-01', symptoms: ['oil_pressure_trip'],
      root_cause: 'Oil filter clogged', resolution_steps: 'Replace filter, bleed circuit.',
      confidence: 'confirmed', verified_by: null, verified_at: null,
      source_url: null, source_note: null, created_by: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    score: 0.82, symptom_overlap: 1, why: 'symptoms 1/1 · confirmed',
  }
}

describe('_buildContextBlock', () => {
  it('renders chunks with chunk_id and tier so Claude can cite precisely', () => {
    const out = _buildContextBlock([mkChunk({})], [], 1200)
    expect(out).toMatch(/# SOURCES/)
    expect(out).toMatch(/\[1\] Carrier 30XA IOM/)
    expect(out).toMatch(/chunk_id=c1/)
    expect(out).toMatch(/tier=oem/)
    expect(out).toMatch(/p\. 47/)
    expect(out).toMatch(/Check oil pressure/)
  })

  it('includes prior fixes section only when fixes are present', () => {
    const withFixes = _buildContextBlock([mkChunk({})], [mkFix()], 1200)
    expect(withFixes).toMatch(/PRIOR FIXES/)
    expect(withFixes).toMatch(/fix_id=f1/)
    const noFixes = _buildContextBlock([mkChunk({})], [], 1200)
    expect(noFixes).not.toMatch(/PRIOR FIXES/)
  })

  it('truncates per-chunk text to the limit', () => {
    const big = mkChunk({ text: 'x'.repeat(5000) })
    const out = _buildContextBlock([big], [], 300)
    // The truncation keeps under 300 chars for the chunk; the full block
    // has headers + metadata so total > 300, but the chunk text line
    // should not exceed 300+ellipsis.
    const longestLine = out.split('\n').map(l => l.length).reduce((a, b) => Math.max(a, b), 0)
    expect(longestLine).toBeLessThan(400)
  })
})

// ─── Schema sanity ────────────────────────────────────────────────────────────

describe('RECORD_ANSWER_TOOL schema', () => {
  it('requires all five top-level fields', () => {
    const req = RECORD_ANSWER_TOOL.input_schema.required ?? []
    expect(req).toEqual(['answer','procedure','possible_causes','confidence','citations'])
  })

  it('confidence is bounded 0–1', () => {
    const p = (RECORD_ANSWER_TOOL.input_schema.properties as Record<string, Record<string, unknown>>)['confidence']!
    expect(p['minimum']).toBe(0)
    expect(p['maximum']).toBe(1)
  })

  it('citations require source, chunk_id, tier', () => {
    const citations = (RECORD_ANSWER_TOOL.input_schema.properties as Record<string, Record<string, unknown>>)['citations']!
    const items = citations['items'] as Record<string, unknown>
    expect(items['required']).toEqual(['source','chunk_id','tier'])
  })
})

describe('SYSTEM_PROMPT', () => {
  it('contains grounding instruction', () => {
    expect(SYSTEM_PROMPT).toMatch(/ONLY from the provided SOURCES/)
  })
  it('forbids free text', () => {
    expect(SYSTEM_PROMPT).toMatch(/record_answer tool exactly once/)
    expect(SYSTEM_PROMPT).toMatch(/Do not produce free text/)
  })
  it('includes safety guardrail', () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER invent/)
    expect(SYSTEM_PROMPT).toMatch(/safety-critical/)
  })
})
