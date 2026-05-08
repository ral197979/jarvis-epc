/**
 * Denver Engineering — Circuit Breaker (v4.40.0)
 * ────────────────────────────────────────────────
 * Ava Phase 4 — Circuit breaker pattern for external integrations
 * and long-running service calls. Prevents cascade failures.
 *
 * States:
 *   CLOSED:     Normal operation — requests pass through
 *   OPEN:       Service failing — requests fail fast
 *   HALF_OPEN:  Probe state — one request let through to test recovery
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half_open'

export interface CircuitBreakerConfig {
  failureThreshold:  number   // failures before opening (default: 5)
  successThreshold:  number   // successes in half_open before closing (default: 2)
  timeout:           number   // ms before transitioning open → half_open (default: 30_000)
  halfOpenRequests:  number   // max concurrent probes in half_open (default: 1)
}

export interface CircuitStats {
  state:           CircuitState
  failures:        number
  successes:       number
  lastFailureAt:   number | null
  lastSuccessAt:   number | null
  openedAt:        number | null
  requestsTotal:   number
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold:  5,
  successThreshold:  2,
  timeout:           30_000,
  halfOpenRequests:  1,
}

// ─── Circuit Breaker Class ────────────────────────────────────────────────────

export class CircuitBreaker {
  private state:          CircuitState = 'closed'
  private failures:       number = 0
  private successes:      number = 0
  private lastFailureAt:  number | null = null
  private lastSuccessAt:  number | null = null
  private openedAt:       number | null = null
  private halfOpenActive: number = 0
  private requestsTotal:  number = 0
  private readonly cfg:   CircuitBreakerConfig

  constructor(public readonly name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config }
  }

  getState(): CircuitState { return this.state }

  getStats(): CircuitStats {
    return {
      state:         this.state,
      failures:      this.failures,
      successes:     this.successes,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      openedAt:      this.openedAt,
      requestsTotal: this.requestsTotal,
    }
  }

  reset(): void {
    this.state         = 'closed'
    this.failures      = 0
    this.successes     = 0
    this.openedAt      = null
    this.halfOpenActive = 0
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.requestsTotal++

    // Check state transitions
    if (this.state === 'open') {
      const elapsed = Date.now() - (this.openedAt ?? 0)
      if (elapsed >= this.cfg.timeout) {
        this.state = 'half_open'
        this.successes = 0
        this.halfOpenActive = 0
      } else {
        throw new CircuitOpenError(this.name, this.cfg.timeout - elapsed)
      }
    }

    if (this.state === 'half_open') {
      if (this.halfOpenActive >= this.cfg.halfOpenRequests) {
        throw new CircuitOpenError(this.name, 0)
      }
      this.halfOpenActive++
    }

    try {
      const result = await fn()
      this._onSuccess()
      return result
    } catch (err) {
      this._onFailure()
      throw err
    }
  }

  private _onSuccess(): void {
    this.lastSuccessAt = Date.now()
    this.failures      = 0

    if (this.state === 'half_open') {
      this.successes++
      this.halfOpenActive = Math.max(0, this.halfOpenActive - 1)
      if (this.successes >= this.cfg.successThreshold) {
        this.state    = 'closed'
        this.successes = 0
        this.openedAt  = null
      }
    }
  }

  private _onFailure(): void {
    this.lastFailureAt = Date.now()
    this.failures++

    if (this.state === 'half_open') {
      this.state      = 'open'
      this.openedAt   = Date.now()
      this.halfOpenActive = 0
      return
    }

    if (this.state === 'closed' && this.failures >= this.cfg.failureThreshold) {
      this.state    = 'open'
      this.openedAt = Date.now()
    }
  }
}

export class CircuitOpenError extends Error {
  constructor(public circuitName: string, public remainingMs: number) {
    super(`Circuit "${circuitName}" is open — retry in ${Math.ceil(remainingMs / 1000)}s`)
    this.name = 'CircuitOpenError'
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const _registry = new Map<string, CircuitBreaker>()

export function createCircuitBreaker(
  name: string,
  config: Partial<CircuitBreakerConfig> = {}
): CircuitBreaker {
  if (!_registry.has(name)) {
    _registry.set(name, new CircuitBreaker(name, config))
  }
  return _registry.get(name)!
}

export function getCircuitBreaker(name: string): CircuitBreaker | undefined {
  return _registry.get(name)
}

export function getAllCircuitStats(): Record<string, CircuitStats> {
  const result: Record<string, CircuitStats> = {}
  for (const [name, cb] of _registry) result[name] = cb.getStats()
  return result
}

export function resetAllCircuits(): void {
  for (const cb of _registry.values()) cb.reset()
}

// ─── Test Hooks ───────────────────────────────────────────────────────────────

export const __testHooks = {
  CircuitBreaker,
  CircuitOpenError,
  createCircuitBreaker,
  getCircuitBreaker,
  getAllCircuitStats,
  resetAllCircuits,
  DEFAULT_CONFIG,
}
