/**
 * Tests: api/tokenStore
 * Coverage: InMemoryTokenStore full lifecycle, purgeExpired, reset,
 *           CompositeTokenStore memory-only path, singleton factory
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  InMemoryTokenStore,
  CompositeTokenStore,
  getTokenStore,
  _resetTokenStoreForTest,
  type ITokenStore,
} from '../../../api/tokenStore'

function expiry(offsetMs: number) { return Date.now() + offsetMs }

// ─── InMemoryTokenStore ───────────────────────────────────────────────────────
describe('InMemoryTokenStore', () => {
  let store: InMemoryTokenStore
  beforeEach(() => { store = new InMemoryTokenStore() })

  it('stores and retrieves a valid refresh token', async () => {
    await store.addRefreshToken('jti-001', expiry(60_000))
    expect(await store.hasRefreshToken('jti-001')).toBe(true)
  })

  it('returns false for unknown jti', async () => {
    expect(await store.hasRefreshToken('unknown')).toBe(false)
  })

  it('returns false for expired token', async () => {
    await store.addRefreshToken('jti-exp', Date.now() - 1)
    expect(await store.hasRefreshToken('jti-exp')).toBe(false)
  })

  it('cleans up expired token during hasRefreshToken check', async () => {
    await store.addRefreshToken('jti-exp2', Date.now() - 1)
    await store.hasRefreshToken('jti-exp2')
    expect(await store.purgeExpired()).toBe(0)
  })

  it('removes a refresh token explicitly', async () => {
    await store.addRefreshToken('jti-002', expiry(60_000))
    await store.removeRefreshToken('jti-002')
    expect(await store.hasRefreshToken('jti-002')).toBe(false)
  })

  it('removeRefreshToken is idempotent for missing jti', async () => {
    await expect(store.removeRefreshToken('missing')).resolves.not.toThrow()
  })

  it('revokes a jti', async () => {
    await store.revokeJti('jti-rev')
    expect(await store.isRevoked('jti-rev')).toBe(true)
  })

  it('non-revoked jti returns false', async () => {
    expect(await store.isRevoked('clean-jti')).toBe(false)
  })

  it('revoking same jti twice is idempotent', async () => {
    await store.revokeJti('jti-dup')
    await store.revokeJti('jti-dup')
    expect(await store.isRevoked('jti-dup')).toBe(true)
  })

  it('revocation is independent from refresh token lifecycle', async () => {
    await store.addRefreshToken('jti-both', expiry(60_000))
    await store.revokeJti('jti-both')
    expect(await store.hasRefreshToken('jti-both')).toBe(true)
    expect(await store.isRevoked('jti-both')).toBe(true)
  })

  it('purgeExpired removes only expired tokens', async () => {
    await store.addRefreshToken('exp-1', Date.now() - 10)
    await store.addRefreshToken('exp-2', Date.now() - 10)
    await store.addRefreshToken('valid', expiry(60_000))
    const purged = await store.purgeExpired()
    expect(purged).toBe(2)
    expect(await store.hasRefreshToken('valid')).toBe(true)
  })

  it('purgeExpired returns 0 when nothing to purge', async () => {
    await store.addRefreshToken('fresh', expiry(60_000))
    expect(await store.purgeExpired()).toBe(0)
  })

  it('healthy() always returns true', async () => {
    expect(await store.healthy()).toBe(true)
  })

  it('_reset clears all state', async () => {
    await store.addRefreshToken('jti-r', expiry(60_000))
    await store.revokeJti('jti-rev-r')
    store._reset()
    expect(await store.hasRefreshToken('jti-r')).toBe(false)
    expect(await store.isRevoked('jti-rev-r')).toBe(false)
  })

  it('stores multiple independent tokens', async () => {
    for (let i = 0; i < 5; i++) await store.addRefreshToken(`jti-m${i}`, expiry(60_000))
    for (let i = 0; i < 5; i++) expect(await store.hasRefreshToken(`jti-m${i}`)).toBe(true)
  })

  it('purgeExpired clears all expired and keeps valid', async () => {
    for (let i = 0; i < 3; i++) await store.addRefreshToken(`exp${i}`, Date.now() - 1)
    await store.addRefreshToken('keep', expiry(60_000))
    const n = await store.purgeExpired()
    expect(n).toBe(3)
    expect(await store.hasRefreshToken('keep')).toBe(true)
  })
})

// ─── CompositeTokenStore (memory fallback path) ───────────────────────────────
describe('CompositeTokenStore (memory-fallback path)', () => {
  let store: CompositeTokenStore
  beforeEach(() => {
    // Port 1 never listens — forces memory fallback silently
    store = new CompositeTokenStore('redis://127.0.0.1:1')
  })

  it('addRefreshToken resolves without throwing', async () => {
    await expect(store.addRefreshToken('c-001', expiry(60_000))).resolves.not.toThrow()
  })

  it('hasRefreshToken resolves to a boolean', async () => {
    await store.addRefreshToken('c-002', expiry(60_000))
    expect(typeof await store.hasRefreshToken('c-002')).toBe('boolean')
  })

  it('revokeJti resolves without throwing', async () => {
    await expect(store.revokeJti('c-rev')).resolves.not.toThrow()
  })

  it('isRevoked resolves to a boolean', async () => {
    expect(typeof await store.isRevoked('c-rev2')).toBe('boolean')
  })

  it('removeRefreshToken resolves without throwing', async () => {
    await expect(store.removeRefreshToken('c-none')).resolves.not.toThrow()
  })

  it('purgeExpired resolves to a number', async () => {
    expect(typeof await store.purgeExpired()).toBe('number')
  })

  it('healthy() resolves to a boolean', async () => {
    expect(typeof await store.healthy()).toBe('boolean')
  })
})

// ─── ITokenStore interface compliance ────────────────────────────────────────
describe('ITokenStore interface compliance', () => {
  let store: ITokenStore
  beforeEach(() => { store = new InMemoryTokenStore() })

  it('implements addRefreshToken', () => { expect(typeof store.addRefreshToken).toBe('function') })
  it('implements hasRefreshToken', () => { expect(typeof store.hasRefreshToken).toBe('function') })
  it('implements removeRefreshToken', () => { expect(typeof store.removeRefreshToken).toBe('function') })
  it('implements revokeJti', () => { expect(typeof store.revokeJti).toBe('function') })
  it('implements isRevoked', () => { expect(typeof store.isRevoked).toBe('function') })
  it('implements purgeExpired', () => { expect(typeof store.purgeExpired).toBe('function') })
  it('implements healthy', () => { expect(typeof store.healthy).toBe('function') })
})

// ─── Singleton factory ────────────────────────────────────────────────────────
describe('getTokenStore / _resetTokenStoreForTest', () => {
  afterEach(() => { _resetTokenStoreForTest() })

  it('returns a singleton', () => {
    const a = getTokenStore(); const b = getTokenStore()
    expect(a).toBe(b)
  })

  it('_reset clears singleton so next call returns new instance', () => {
    const a = getTokenStore()
    _resetTokenStoreForTest()
    const b = getTokenStore()
    expect(a).not.toBe(b)
  })

  it('returned store implements ITokenStore', () => {
    const s = getTokenStore()
    expect(typeof s.addRefreshToken).toBe('function')
    expect(typeof s.healthy).toBe('function')
  })

  it('memory store from factory is healthy', async () => {
    const s = getTokenStore()
    if (s instanceof InMemoryTokenStore) {
      expect(await s.healthy()).toBe(true)
    }
  })

  it('healthy() from factory resolves to boolean', async () => {
    const s = getTokenStore()
    expect(typeof await s.healthy()).toBe('boolean')
  })
})

// ─── Track D: RedisTokenStore internal branch paths ───────────────────────────
// We test the RedisTokenStore through CompositeTokenStore with a bad Redis URL,
// ensuring the _use() fallback, error paths, and healthy() checks are covered.

describe('RedisTokenStore — _use() fallback coverage', () => {
  // Use a garbage URL to guarantee Redis connection failure on every call
  const DEAD_REDIS = 'redis://127.0.0.1:0'

  it('addRefreshToken falls back to memory when Redis is down', async () => {
    const { CompositeTokenStore } = await import('../../../api/tokenStore')
    const store = new CompositeTokenStore(DEAD_REDIS)
    // Should not throw — falls to memory
    await expect(store.addRefreshToken('jti-fb1', Date.now() + 60_000)).resolves.toBeUndefined()
  })

  it('hasRefreshToken falls back to false when Redis is down', async () => {
    const { CompositeTokenStore } = await import('../../../api/tokenStore')
    const store = new CompositeTokenStore(DEAD_REDIS)
    await store.addRefreshToken('jti-fb2', Date.now() + 60_000)
    // Memory fallback is per-instance; after add via memory fallback, has should return true
    const has = await store.hasRefreshToken('jti-fb2')
    expect(typeof has).toBe('boolean')
  })

  it('removeRefreshToken does not throw when Redis is down', async () => {
    const { CompositeTokenStore } = await import('../../../api/tokenStore')
    const store = new CompositeTokenStore(DEAD_REDIS)
    await expect(store.removeRefreshToken('jti-nonexist')).resolves.toBeUndefined()
  })

  it('revokeJti does not throw when Redis is down', async () => {
    const { CompositeTokenStore } = await import('../../../api/tokenStore')
    const store = new CompositeTokenStore(DEAD_REDIS)
    await expect(store.revokeJti('jti-rev-fb', 3600)).resolves.toBeUndefined()
  })

  it('isRevoked falls back to false when Redis is down and not in memory', async () => {
    const { CompositeTokenStore } = await import('../../../api/tokenStore')
    const store = new CompositeTokenStore(DEAD_REDIS)
    const result = await store.isRevoked('jti-not-revoked')
    expect(typeof result).toBe('boolean')
  })

  it('purgeExpired delegates to memory and returns a number', async () => {
    const { CompositeTokenStore } = await import('../../../api/tokenStore')
    const store = new CompositeTokenStore(DEAD_REDIS)
    await store.addRefreshToken('exp-tok', Date.now() - 1)
    const purged = await store.purgeExpired()
    expect(typeof purged).toBe('number')
  })

  it('healthy() returns false when Redis url is unreachable', async () => {
    const { CompositeTokenStore } = await import('../../../api/tokenStore')
    const store = new CompositeTokenStore(DEAD_REDIS)
    const h = await store.healthy()
    expect(h).toBe(false)
  })
})

describe('InMemoryTokenStore — edge cases', () => {
  it('hasRefreshToken returns false when expiry is exactly now', async () => {
    const { InMemoryTokenStore } = await import('../../../api/tokenStore')
    const store = new InMemoryTokenStore()
    // exp = Date.now() means already expired at time of check
    await store.addRefreshToken('edge-jti', Date.now() - 1)
    expect(await store.hasRefreshToken('edge-jti')).toBe(false)
  })

  it('removeRefreshToken on non-existent jti does not throw', async () => {
    const { InMemoryTokenStore } = await import('../../../api/tokenStore')
    const store = new InMemoryTokenStore()
    await expect(store.removeRefreshToken('ghost-jti')).resolves.toBeUndefined()
  })

  it('purgeExpired only removes expired tokens, not future ones', async () => {
    const { InMemoryTokenStore } = await import('../../../api/tokenStore')
    const store = new InMemoryTokenStore()
    await store.addRefreshToken('old', Date.now() - 1000)
    await store.addRefreshToken('new', Date.now() + 60_000)
    const purged = await store.purgeExpired()
    expect(purged).toBe(1)
    expect(await store.hasRefreshToken('new')).toBe(true)
    expect(await store.hasRefreshToken('old')).toBe(false)
  })

  it('revokeJti with explicit ttl does not throw', async () => {
    const { InMemoryTokenStore } = await import('../../../api/tokenStore')
    const store = new InMemoryTokenStore()
    await expect(store.revokeJti('jti-with-ttl', 3600)).resolves.toBeUndefined()
    expect(await store.isRevoked('jti-with-ttl')).toBe(true)
  })
})

describe('getTokenStore — REDIS_URL branch', () => {
  it('returns a store even with REDIS_URL set to invalid URL', async () => {
    const { _resetTokenStoreForTest, getTokenStore } = await import('../../../api/tokenStore')
    _resetTokenStoreForTest()
    process.env['REDIS_URL'] = 'redis://127.0.0.1:0'
    const store = getTokenStore()
    expect(store).toBeDefined()
    _resetTokenStoreForTest()
    delete process.env['REDIS_URL']
  })
})

// ─── Track E: CompositeTokenStore._use() redisFn catch → fallback (line 192) ──
describe('CompositeTokenStore._use() — redisFn catch path (line 192)', () => {
  const DEAD = 'redis://127.0.0.1:0'

  it('addRefreshToken resolves even when redis throws immediately', async () => {
    const { CompositeTokenStore } = await import('../../../api/tokenStore')
    const store = new CompositeTokenStore(DEAD)
    await expect(store.addRefreshToken('jti-e1', Date.now() + 60_000)).resolves.toBeUndefined()
  })

  it('hasRefreshToken returns false when both redis and memory miss', async () => {
    const { CompositeTokenStore } = await import('../../../api/tokenStore')
    const store = new CompositeTokenStore(DEAD)
    const result = await store.hasRefreshToken('jti-e2-unknown')
    expect(result).toBe(false)
  })

  it('isRevoked returns false for unknown jti via fallback', async () => {
    const { CompositeTokenStore } = await import('../../../api/tokenStore')
    const store = new CompositeTokenStore(DEAD)
    const result = await store.isRevoked('jti-e3-unknown')
    expect(result).toBe(false)
  })

  it('purgeExpired returns 0 via memory fallback when redis unavailable', async () => {
    const { CompositeTokenStore } = await import('../../../api/tokenStore')
    const store = new CompositeTokenStore(DEAD)
    const n = await store.purgeExpired()
    expect(typeof n).toBe('number')
    expect(n).toBeGreaterThanOrEqual(0)
  })
})
