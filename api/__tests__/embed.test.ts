/**
 * Tests: api/services/embed.ts
 * Covers the deterministic parts — input prep + pgvector literal format.
 * Actual OpenAI calls are not exercised (network + cost).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { toPgVectorLiteral, __testHooks } from '../services/embed'

const { _prepInput, MAX_INPUT_CHARS, MAX_BATCH_INPUTS, DEFAULT_MODEL } = __testHooks

describe('_prepInput — normalization', () => {
  it('collapses whitespace runs', () => {
    expect(_prepInput('foo   bar\n\n\tbaz')).toBe('foo bar baz')
  })
  it('trims leading + trailing', () => {
    expect(_prepInput('  hello  ')).toBe('hello')
  })
  it('truncates with ellipsis at MAX_INPUT_CHARS', () => {
    const big = 'a'.repeat(MAX_INPUT_CHARS + 100)
    const out = _prepInput(big)
    expect(out.length).toBeLessThanOrEqual(MAX_INPUT_CHARS)
    expect(out.endsWith('...')).toBe(true)
  })
  it('handles empty / null gracefully', () => {
    expect(_prepInput('')).toBe('')
    expect(_prepInput(null as unknown as string)).toBe('')
  })
})

describe('toPgVectorLiteral', () => {
  it('formats as [n,n,...] with no spaces', () => {
    expect(toPgVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]')
  })
  it('preserves scientific notation', () => {
    const r = toPgVectorLiteral([1e-10, 1.5])
    expect(r).toMatch(/^\[1e-10,1.5\]$/)
  })
  it('empty vector → empty brackets', () => {
    expect(toPgVectorLiteral([])).toBe('[]')
  })
})

describe('config sanity', () => {
  it('default model is an OpenAI embeddings model name', () => {
    expect(DEFAULT_MODEL).toMatch(/^text-embedding-/)
  })
  it('batch size stays under OpenAI request limits', () => {
    expect(MAX_BATCH_INPUTS).toBeGreaterThan(0)
    expect(MAX_BATCH_INPUTS).toBeLessThanOrEqual(2048)
  })
})

describe('embedTexts — provider missing', () => {
  const PREV = process.env['OPENAI_API_KEY']
  beforeEach(() => {
    // Clear vi mocks AND reset env for this test only
    vi.clearAllMocks()
  })

  it('throws helpful error when OPENAI_API_KEY is not set', async () => {
    process.env['OPENAI_API_KEY'] = 'placeholder-missing'
    const { embedTexts } = await import('../services/embed')
    await expect(embedTexts(['hello'])).rejects.toThrow(/OPENAI_API_KEY not configured/)
    if (PREV) process.env['OPENAI_API_KEY'] = PREV
    else delete process.env['OPENAI_API_KEY']
  })
})
