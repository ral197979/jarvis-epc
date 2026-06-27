/**
 * Denver Engineering — Universal idempotency middleware (R6a)
 * ─────────────────────────────────────────────────────────────────────────────
 * Replays the stored response for a repeated mutating request carrying the same
 * `Idempotency-Key` (ECOSYSTEM_INTEGRATION_CONTRACT.md §8). Additive + flag-gated:
 * with IDEMPOTENCY off (default) it is a strict pass-through; idempotency is also
 * opt-in per request (only acts when the client sends the header).
 *
 * Pluggable store (in-memory default; swap for DB/Redis to span instances/
 * restarts). Caches only completed 2xx/4xx responses sent via res.json (5xx are
 * transient and re-executed). In-flight concurrent dedup is out of scope here —
 * it needs a store-level lock; documented as a follow-up.
 *
 * NOT auto-mounted: wire it on /api/v1 AFTER tenant resolution so the cache key
 * is tenant-scoped. Until mounted it changes nothing.
 */
import type { Request, Response, NextFunction } from 'express'

export interface CachedResponse { status: number; body: unknown }

export interface IdempotencyStore {
  get(key: string): CachedResponse | undefined
  set(key: string, status: number, body: unknown): void
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private m = new Map<string, { status: number; body: unknown; createdAt: number }>()
  constructor(private ttlMs: number, private now: () => number = () => Date.now()) {}

  get(key: string): CachedResponse | undefined {
    const e = this.m.get(key)
    if (!e) return undefined
    if (this.now() - e.createdAt > this.ttlMs) { this.m.delete(key); return undefined }
    return { status: e.status, body: e.body }
  }
  set(key: string, status: number, body: unknown): void {
    this.m.set(key, { status, body, createdAt: this.now() })
    if (this.m.size > 5000) this._prune()
  }
  private _prune(): void {
    const t = this.now()
    for (const [k, e] of this.m) if (t - e.createdAt > this.ttlMs) this.m.delete(k)
  }
}

export function isIdempotencyEnabled(): boolean {
  return process.env['IDEMPOTENCY'] === 'true'
}
export function idempotencyTtlMs(): number {
  return Number(process.env['IDEMPOTENCY_TTL_MS']) || 86_400_000  // 24h
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Express middleware factory. Pass a shared store for cross-route replay. */
export function idempotency(store?: IdempotencyStore) {
  const _store = store ?? new InMemoryIdempotencyStore(idempotencyTtlMs())
  return function idempotencyMw(req: Request, res: Response, next: NextFunction): void {
    if (!isIdempotencyEnabled() || !MUTATING.has(req.method)) return next()
    const idemKey = req.header('Idempotency-Key')
    if (!idemKey) return next()

    const tenant = (req as Request & { tenantId?: string }).tenantId ?? 'none'
    const path = req.originalUrl ?? req.url
    const key = `${tenant}:${req.method}:${path}:${idemKey}`

    const hit = _store.get(key)
    if (hit) {
      res.setHeader('Idempotent-Replay', 'true')
      res.status(hit.status).json(hit.body)
      return
    }

    // Capture the response body on the way out; cache deterministic results only.
    const origJson = res.json.bind(res)
    res.json = (body: unknown): Response => {
      if (res.statusCode < 500) _store.set(key, res.statusCode, body)
      return origJson(body)
    }
    next()
  }
}
