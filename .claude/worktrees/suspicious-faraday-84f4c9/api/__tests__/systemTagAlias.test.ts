/**
 * Tests: api/services/systemTagAlias.ts
 * Pure helpers — no mocks needed.
 */

import { describe, it, expect } from 'vitest'
import { normalizeSystemTag, tagAliases, buildIlikeAliasOr } from '../services/systemTagAlias'

describe('normalizeSystemTag', () => {
  it('handles common variants', () => {
    expect(normalizeSystemTag('CH-01')).toBe('CH-01')
    expect(normalizeSystemTag('ch-01')).toBe('CH-01')
    expect(normalizeSystemTag('ch 01')).toBe('CH-01')
    expect(normalizeSystemTag('ch_01')).toBe('CH-01')
    expect(normalizeSystemTag('Ch--01')).toBe('CH-01')
    expect(normalizeSystemTag('ch  _  01')).toBe('CH-01')
  })

  it('trims leading/trailing separators', () => {
    expect(normalizeSystemTag('  CH-01  ')).toBe('CH-01')
    expect(normalizeSystemTag('-CH-01-')).toBe('CH-01')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeSystemTag('')).toBe('')
  })

  it('preserves tags without separators unchanged', () => {
    expect(normalizeSystemTag('CH01')).toBe('CH01')
  })
})

describe('tagAliases', () => {
  it('produces all common separator variants for multi-part tags', () => {
    const aliases = tagAliases('CH-01')
    expect(aliases).toContain('CH-01')
    expect(aliases).toContain('CH 01')
    expect(aliases).toContain('CH_01')
    expect(aliases).toContain('CH01')
  })

  it('dedupes single-token tags', () => {
    expect(tagAliases('CH01')).toEqual(['CH01'])
  })

  it('returns empty for empty input', () => {
    expect(tagAliases('')).toEqual([])
  })
})

describe('buildIlikeAliasOr', () => {
  it('builds a proper OR clause with sequential param indices', () => {
    const { sql, values, nextIdx } = buildIlikeAliasOr('d.work_performed', 'CH-01', 5)
    expect(sql).toMatch(/^\(d\.work_performed ILIKE \$5/)
    expect(sql).toContain('OR')
    expect(values.every(v => v.startsWith('%') && v.endsWith('%'))).toBe(true)
    expect(nextIdx).toBe(5 + values.length)
  })

  it('returns a FALSE clause when tag is empty', () => {
    const { sql, values, nextIdx } = buildIlikeAliasOr('col', '', 1)
    expect(sql).toBe('FALSE')
    expect(values).toEqual([])
    expect(nextIdx).toBe(1)
  })
})
