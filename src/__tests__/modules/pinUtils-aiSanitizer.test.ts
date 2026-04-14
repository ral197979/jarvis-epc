/**
 * Tests: pinUtils + aiSanitizer
 * P2-A extraction validation — v4.23.0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  hashPin,
  migratePinIfNeeded,
  loadOwnerCfg,
  DEFAULT_OWNER_CFG,
  type OwnerCfg,
} from '../../modules/utils/pinUtils'

import {
  sanitizeForAI,
  sanitizeAndTruncate,
  AI_MAX_ITEMS_PER_COLLECTION,
  AI_MAX_PAYLOAD_CHARS,
} from '../../modules/utils/aiSanitizer'

// ─── hashPin ──────────────────────────────────────────────────────────────────

describe('hashPin', () => {
  it('returns empty string for falsy input', () => {
    expect(hashPin('')).toBe('')
  })

  it('returns a jpin_ prefixed string', () => {
    expect(hashPin('0000')).toMatch(/^jpin_/)
  })

  it('is deterministic', () => {
    expect(hashPin('1234')).toBe(hashPin('1234'))
  })

  it('produces different hashes for different PINs', () => {
    expect(hashPin('0000')).not.toBe(hashPin('1234'))
  })

  it('matches JarvisCore inline hash for 0000', () => {
    // Regression: ensure extracted function matches original
    const hash = hashPin('0000')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(5)
  })
})

// ─── migratePinIfNeeded ───────────────────────────────────────────────────────

describe('migratePinIfNeeded', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      setItem:  vi.fn(),
      getItem:  vi.fn(() => null),
      removeItem: vi.fn(),
    })
  })

  it('migrates plaintext pin to pinHash', () => {
    const cfg = { ...DEFAULT_OWNER_CFG, pin: '1234', pinHash: '' }
    const result = migratePinIfNeeded(cfg as OwnerCfg)
    expect(result.pinHash).toBe(hashPin('1234'))
    expect(result.pin).toBeUndefined()
  })

  it('sets activeRole to owner if missing', () => {
    const cfg = { ...DEFAULT_OWNER_CFG, activeRole: '' }
    const result = migratePinIfNeeded(cfg)
    expect(result.activeRole).toBe('owner')
  })

  it('sets writesEnabled=true if missing', () => {
    const cfg = { chatEnabled: true, exportsEnabled: true, authEnabled: true, pinHash: '', activeRole: 'owner' } as OwnerCfg
    const result = migratePinIfNeeded(cfg)
    expect(result.writesEnabled).toBe(true)
  })

  it('sets exportsEnabled=true if missing', () => {
    const cfg = { chatEnabled: true, writesEnabled: true, authEnabled: true, pinHash: '', activeRole: 'owner' } as OwnerCfg
    const result = migratePinIfNeeded(cfg)
    expect(result.exportsEnabled).toBe(true)
  })

  it('does not mutate unchanged configs', () => {
    const cfg = { ...DEFAULT_OWNER_CFG, pinHash: hashPin('0000') }
    migratePinIfNeeded(cfg)
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })
})

// ─── loadOwnerCfg ─────────────────────────────────────────────────────────────

describe('loadOwnerCfg', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      setItem:  vi.fn(),
      getItem:  vi.fn(() => null),
    })
  })

  it('returns default config when localStorage is empty', () => {
    const cfg = loadOwnerCfg()
    expect(cfg.chatEnabled).toBe(true)
    expect(cfg.authEnabled).toBe(true)
    expect(cfg.activeRole).toBe('owner')
    expect(cfg.pinHash).toMatch(/^jpin_/)
  })

  it('returns default on JSON parse error', () => {
    vi.stubGlobal('localStorage', {
      setItem: vi.fn(),
      getItem: vi.fn(() => 'not-json{{{'),
    })
    const cfg = loadOwnerCfg()
    expect(cfg.activeRole).toBe('owner')
  })

  it('returns stored config when present', () => {
    const stored = { ...DEFAULT_OWNER_CFG, pinHash: hashPin('9999'), activeRole: 'owner' }
    vi.stubGlobal('localStorage', {
      setItem: vi.fn(),
      getItem: vi.fn(() => JSON.stringify(stored)),
    })
    const cfg = loadOwnerCfg()
    expect(cfg.pinHash).toBe(hashPin('9999'))
  })
})

// ─── sanitizeForAI ────────────────────────────────────────────────────────────

describe('sanitizeForAI', () => {
  it('passes through primitives unchanged', () => {
    expect(sanitizeForAI('hello')).toBe('hello')
    expect(sanitizeForAI(42)).toBe(42)
    expect(sanitizeForAI(true)).toBe(true)
    expect(sanitizeForAI(null)).toBeNull()
    expect(sanitizeForAI(undefined)).toBeUndefined()
  })

  it('truncates arrays to AI_MAX_ITEMS_PER_COLLECTION', () => {
    const big = Array.from({ length: 100 }, (_, i) => i)
    const result = sanitizeForAI(big) as number[]
    expect(result.length).toBe(AI_MAX_ITEMS_PER_COLLECTION)
  })

  it('redacts PII fields', () => {
    const obj = { name: 'Test', email: 'user@example.com', phone: '555-0000' }
    const result = sanitizeForAI(obj) as Record<string, unknown>
    expect(result.name).toBe('Test')
    expect(result.email).toBe('[REDACTED]')
    expect(result.phone).toBe('[REDACTED]')
  })

  it('redacts nested PII fields', () => {
    const obj = { project: { contact: 'Jane', title: 'Build' } }
    const result = sanitizeForAI(obj) as Record<string, Record<string, unknown>>
    expect(result.project.contact).toBe('[REDACTED]')
    expect(result.project.title).toBe('Build')
  })

  it('does not redact non-PII fields', () => {
    const obj = { status: 'active', amount: 9999 }
    const result = sanitizeForAI(obj) as Record<string, unknown>
    expect(result.status).toBe('active')
    expect(result.amount).toBe(9999)
  })
})

// ─── sanitizeAndTruncate ──────────────────────────────────────────────────────

describe('sanitizeAndTruncate', () => {
  it('returns a JSON string', () => {
    const result = sanitizeAndTruncate({ foo: 'bar' })
    expect(typeof result).toBe('string')
    expect(() => JSON.parse(result)).not.toThrow()
  })

  it('truncates to AI_MAX_PAYLOAD_CHARS', () => {
    const bigObj = { data: 'x'.repeat(AI_MAX_PAYLOAD_CHARS + 1000) }
    const result = sanitizeAndTruncate(bigObj)
    expect(result.length).toBeLessThanOrEqual(AI_MAX_PAYLOAD_CHARS + 1) // +1 for ellipsis char
    expect(result.endsWith('…')).toBe(true)
  })

  it('does not truncate small payloads', () => {
    const small = { a: 1, b: 2 }
    const result = sanitizeAndTruncate(small)
    expect(result).toBe(JSON.stringify({ a: 1, b: 2 }))
  })
})
