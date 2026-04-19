/**
 * Tests: api/services/knowledgeIngest.ts
 * Focus: the pure chunker. DB path is covered by integration-level smoke.
 */

import { describe, it, expect } from 'vitest'
import { __testHooks } from '../services/knowledgeIngest'

const { chunkText } = __testHooks

describe('chunkText — boundaries and overlap', () => {
  it('returns a single chunk when text is shorter than target', () => {
    const out = chunkText('short text', 1000, 100)
    expect(out).toHaveLength(1)
    expect(out[0]!.text).toBe('short text')
  })

  it('returns empty array for empty input', () => {
    expect(chunkText('', 1000, 100)).toEqual([])
    expect(chunkText('   \n\n\t  ', 1000, 100)).toEqual([])
  })

  it('splits long text with overlap between consecutive chunks', () => {
    const t = 'A'.repeat(3000)
    const out = chunkText(t, 1000, 200)
    expect(out.length).toBeGreaterThan(1)
    // Each successive chunk should start before the previous one ended
    // (i.e., have overlap).
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.start).toBeLessThan(out[i - 1]!.end)
    }
  })

  it('prefers sentence boundaries when splitting', () => {
    const paragraph =
      'First sentence. ' +
      'Second sentence that is a bit longer. '.repeat(30) +
      'Final sentence.'
    const out = chunkText(paragraph, 400, 50)
    expect(out.length).toBeGreaterThan(1)
    // At least one chunk should end with a terminator plus trimmed.
    const trimmed = out.map(c => c.text.trim())
    const endsOnBoundary = trimmed.some(s => /[.!?]$/.test(s))
    expect(endsOnBoundary).toBe(true)
  })

  it('normalizes CRLF and collapses runs of whitespace', () => {
    const raw = 'line1\r\n\r\nline2\t\t\there   we   go'
    const out = chunkText(raw, 1000, 100)
    expect(out[0]!.text).not.toContain('\r')
    expect(out[0]!.text).not.toMatch(/ {2,}/)
  })

  it('does not produce zero-length chunks', () => {
    const t = ('paragraph. '.repeat(500))
    const out = chunkText(t, 800, 150)
    for (const c of out) {
      expect(c.text.length).toBeGreaterThan(0)
    }
  })
})
