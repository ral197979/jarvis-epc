/**
 * JARVIS EPC — TokenStore
 * ─────────────────────────
 * Phase 11: Persistent JWT token store with Redis backend and in-memory fallback.
 *
 * Abstracts the lifecycle of refresh tokens and JTI revocation lists behind
 * a single interface. When REDIS_URL is set the store uses ioredis; otherwise
 * it degrades gracefully to the Phase-5 in-memory implementation so that local
 * development and tests continue to work with zero extra infrastructure.
 *
 * Interface:
 *   addRefreshToken(jti, expiryMs)  — store a valid refresh token
 *   hasRefreshToken(jti)            — check a jti is still valid + not expired
 *   removeRefreshToken(jti)         — delete on rotation / logout
 *   revokeJti(jti)                  — add to revocation set
 *   isRevoked(jti)                  — check revocation
 *   purgeExpired()                  — clean up stale tokens (memory backend only)
 *   healthy()                       — liveness probe
 */

import { slog } from '../src/modules/observability/index'

// ─── Backend interface ────────────────────────────────────────────────────────
export interface ITokenStore {
  addRefreshToken(jti: string, expiryMs: number): Promise<void>
  hasRefreshToken(jti: string):                   Promise<boolean>
  removeRefreshToken(jti: string):                Promise<void>
  revokeJti(jti: string, ttlSeconds?: number):    Promise<void>
  isRevoked(jti: string):                         Promise<boolean>
  purgeExpired():                                  Promise<number>
  healthy():                                       Promise<boolean>
}

// ─── In-memory implementation (default / fallback) ───────────────────────────
export class InMemoryTokenStore implements ITokenStore {
  private readonly _refreshTokens = new Map<string, number>()   // jti → expiry ms
  private readonly _revokedJtis   = new Set<string>()

  async addRefreshToken(jti: string, expiryMs: number): Promise<void> {
    this._refreshTokens.set(jti, expiryMs)
  }

  async hasRefreshToken(jti: string): Promise<boolean> {
    const exp = this._refreshTokens.get(jti)
    if (exp === undefined) return false
    if (exp < Date.now()) {
      this._refreshTokens.delete(jti)
      return false
    }
    return true
  }

  async removeRefreshToken(jti: string): Promise<void> {
    this._refreshTokens.delete(jti)
  }

  async revokeJti(jti: string, _ttlSeconds?: number): Promise<void> {
    this._revokedJtis.add(jti)
  }

  async isRevoked(jti: string): Promise<boolean> {
    return this._revokedJtis.has(jti)
  }

  async purgeExpired(): Promise<number> {
    const now    = Date.now()
    let   purged = 0
    for (const [jti, exp] of this._refreshTokens.entries()) {
      if (exp < now) { this._refreshTokens.delete(jti); purged++ }
    }
    return purged
  }

  async healthy(): Promise<boolean> { return true }

  /** Test-only: reset state */
  _reset(): void {
    this._refreshTokens.clear()
    this._revokedJtis.clear()
  }
}

// ─── Redis implementation ─────────────────────────────────────────────────────
// Lazy import so that the module loads cleanly even when ioredis is not installed.

const REFRESH_PREFIX  = 'jarvis:rt:'    // jarvis:rt:{jti}   → '1' (exists = valid)
const REVOKED_PREFIX  = 'jarvis:rev:'   // jarvis:rev:{jti}  → '1' with TTL

export class RedisTokenStore implements ITokenStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private redis: any = null
  private _healthy = false

  constructor(redisUrl: string) {
    this._connect(redisUrl)
  }

  private _connect(url: string): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Redis = require('ioredis').default ?? require('ioredis')
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 3,
        lazyConnect:          true,
        enableOfflineQueue:   false,
        connectTimeout:       2000,
      })
      this.redis!.on('ready', () => {
        this._healthy = true
        slog('INFO', 'auth', '[token-store] Redis connected', { url: url.replace(/\/\/.*@/, '//***@') })
      })
      this.redis!.on('error', (err: Error) => {
        this._healthy = false
        slog('WARN', 'auth', '[token-store] Redis error', { message: err.message })
      })
      void this.redis!.connect().catch(() => { /* handled by error event */ })
    } catch (err) {
      slog('WARN', 'auth', '[token-store] ioredis not available — Redis backend disabled', {})
      this.redis = null
    }
  }

  async addRefreshToken(jti: string, expiryMs: number): Promise<void> {
    const ttl = Math.ceil((expiryMs - Date.now()) / 1000)
    if (ttl <= 0 || !this.redis || !this._healthy) return
    await this.redis.set(`${REFRESH_PREFIX}${jti}`, '1', 'EX', ttl)
  }

  async hasRefreshToken(jti: string): Promise<boolean> {
    if (!this.redis || !this._healthy) return false
    const val = await this.redis.get(`${REFRESH_PREFIX}${jti}`)
    return val === '1'
  }

  async removeRefreshToken(jti: string): Promise<void> {
    if (!this.redis || !this._healthy) return
    await this.redis.del(`${REFRESH_PREFIX}${jti}`)
  }

  async revokeJti(jti: string, ttlSeconds = 86400 * 7): Promise<void> {
    if (!this.redis || !this._healthy) return
    await this.redis.set(`${REVOKED_PREFIX}${jti}`, '1', 'EX', ttlSeconds)
  }

  async isRevoked(jti: string): Promise<boolean> {
    if (!this.redis || !this._healthy) return false
    const val = await this.redis.get(`${REVOKED_PREFIX}${jti}`)
    return val === '1'
  }

  /** Not needed for Redis — TTL handles expiry automatically. */
  async purgeExpired(): Promise<number> { return 0 }

  async healthy(): Promise<boolean> {
    if (!this.redis) return false
    try {
      await this.redis.ping()
      return true
    } catch {
      return false
    }
  }

  async disconnect(): Promise<void> {
    await this.redis?.quit()
    this.redis = null
    this._healthy = false
  }
}

// ─── Composite store: tries Redis, falls back to memory ──────────────────────
/**
 * When Redis is unavailable (connection refused, ioredis not installed, etc.)
 * all operations silently fall through to the in-memory store so that the API
 * continues working in development / test environments.
 */
export class CompositeTokenStore implements ITokenStore {
  private redis:  RedisTokenStore
  private memory: InMemoryTokenStore

  constructor(redisUrl: string) {
    this.redis  = new RedisTokenStore(redisUrl)
    this.memory = new InMemoryTokenStore()
  }

  private async _use<T>(
    redisFn: () => Promise<T>,
    memFn:   () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    if (await this.redis.healthy()) {
      try { return await redisFn() } catch { /* fall through */ }
    }
    return memFn().catch(() => fallback)
  }

  async addRefreshToken(jti: string, exp: number): Promise<void> {
    await this._use(
      () => this.redis.addRefreshToken(jti, exp),
      () => this.memory.addRefreshToken(jti, exp),
      undefined as void,
    )
  }

  async hasRefreshToken(jti: string): Promise<boolean> {
    return this._use(
      () => this.redis.hasRefreshToken(jti),
      () => this.memory.hasRefreshToken(jti),
      false,
    )
  }

  async removeRefreshToken(jti: string): Promise<void> {
    await Promise.allSettled([
      this.redis.removeRefreshToken(jti),
      this.memory.removeRefreshToken(jti),
    ])
  }

  async revokeJti(jti: string, ttl?: number): Promise<void> {
    await Promise.allSettled([
      this.redis.revokeJti(jti, ttl),
      this.memory.revokeJti(jti, ttl),
    ])
  }

  async isRevoked(jti: string): Promise<boolean> {
    return this._use(
      () => this.redis.isRevoked(jti),
      () => this.memory.isRevoked(jti),
      false,
    )
  }

  async purgeExpired(): Promise<number> {
    const [, memResult] = await Promise.allSettled([
      this.redis.purgeExpired(),
      this.memory.purgeExpired(),
    ])
    return memResult.status === 'fulfilled' ? memResult.value : 0
  }

  async healthy(): Promise<boolean> { return this.redis.healthy() }
}

// ─── Singleton factory ────────────────────────────────────────────────────────
let _instance: ITokenStore | null = null

export function getTokenStore(): ITokenStore {
  if (!_instance) {
    const redisUrl = process.env['REDIS_URL']
    _instance = redisUrl
      ? new CompositeTokenStore(redisUrl)
      : new InMemoryTokenStore()

    slog('INFO', 'auth', '[token-store] initialised', {
      backend: redisUrl ? 'composite(redis+memory)' : 'memory',
    })
  }
  return _instance
}

/** Test-only reset. */
export function _resetTokenStoreForTest(): void {
  if (_instance instanceof InMemoryTokenStore) _instance._reset()
  _instance = null
}
