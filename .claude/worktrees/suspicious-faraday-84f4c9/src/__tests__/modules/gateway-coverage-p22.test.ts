/**
 * Tests: src/modules/gateway — Phase 22 targeted branch coverage
 *
 * Targets (confirmed uncovered in v4.21+):
 *   Line 136-138: gatewayMode==='proxied' && response.status===401
 *                 → clearAuthToken() + jip.publish('token_expired')
 *   Line 208-209: AI rate-limit 60s window reset (callCount=0, windowStart=now)
 *   Line 215:     callCount >= MAX_PER_MINUTE hard cap
 *
 * Root-cause of prior failures:
 *   The existing gateway.test.ts mocks '../../modules/store' by spreading
 *   `{ ...actual, gatewayMode: 'direct' }` — a static snapshot.
 *   Calling setGatewayMode('proxied') updates the real store module's `let`
 *   variable, but the mocked module property stays frozen at 'direct'.
 *
 * Fix: expose gatewayMode as a getter backed by a local variable so the mock
 *   export reflects mutations made through setGatewayMode().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Hoisted mock state (available before vi.mock factory runs) ───────────────
const { mockClearAuthToken, mockGetAuthToken, gatewayModeRef } = vi.hoisted(() => ({
  mockClearAuthToken: vi.fn(),
  mockGetAuthToken:   vi.fn().mockReturnValue('mock-jwt'),
  gatewayModeRef:     { value: 'direct' as 'direct' | 'proxied' },
}))

// ─── Getter-based store mock (live gatewayMode binding) ───────────────────────
vi.mock('../../modules/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../modules/store')>()
  const mod = {
    ...actual,
    // Getter ensures gateway reads the current runtime value, not a snapshot
    get gatewayMode() { return gatewayModeRef.value },
    setGatewayMode: (mode: 'direct' | 'proxied') => { gatewayModeRef.value = mode },
    // Stable references for other properties
    backendBase:     '',
    csrfToken:       'test-csrf-token',
    GATEWAY_PROXY_URL: '/api/v1/gateway',
    sessionMetrics:  actual.sessionMetrics,
    gatewayLog:      actual.gatewayLog,
    GATEWAY_LOG_MAX: actual.GATEWAY_LOG_MAX,
  }
  return mod
})

// ─── Mock auth module ─────────────────────────────────────────────────────────
vi.mock('../../modules/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../modules/auth')>()
  return {
    ...actual,
    getAuthToken:         mockGetAuthToken,
    clearAuthToken:       mockClearAuthToken,
    checkSessionTimeout:  vi.fn().mockReturnValue(false),
    announce:             vi.fn(),
  }
})

// ─── Mock observability ───────────────────────────────────────────────────────
vi.mock('../../modules/observability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../modules/observability')>()
  return { ...actual, slog: vi.fn(), logError: vi.fn() }
})

// ─── Import subjects after mocks ─────────────────────────────────────────────
import { _gateway, _resetAIRateLimit, callAI } from '../../modules/gateway'
import { jip }                                  from '../../modules/eventBus'

// ─── Fetch mock ───────────────────────────────────────────────────────────────
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ─── 1. Proxied 401 — clearAuthToken + jip.publish (lines 136-138) ───────────
describe('gateway — proxied 401 token_expired branch (lines 136-138)', () => {
  beforeEach(() => {
    gatewayModeRef.value = 'proxied'
    mockFetch.mockReset()
    mockClearAuthToken.mockClear()
  })
  afterEach(() => {
    gatewayModeRef.value = 'direct'
  })

  it('calls clearAuthToken() on 401 in proxied mode', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 })
    )
    const response = await _gateway({
      target: 'https://api.anthropic.com/v1/messages',
      body:   '{}',
    })
    expect(response.status).toBe(401)
    expect(mockClearAuthToken).toHaveBeenCalledTimes(1)
  })

  it('publishes token_expired JIP event on 401 in proxied mode', async () => {
    const events: string[] = []
    const unsub = jip.subscribe('jarvis', 'token_expired', () => events.push('expired'))

    mockFetch.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 })
    )
    await _gateway({
      target: 'https://api.anthropic.com/v1/messages',
      body:   '{}',
    })

    expect(events).toContain('expired')
    unsub()
  })

  it('does NOT call clearAuthToken() on 401 in direct mode', async () => {
    gatewayModeRef.value = 'direct'
    mockFetch.mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 })
    )
    await _gateway({
      target: 'https://api.anthropic.com/v1/messages',
      body:   '{}',
    })
    expect(mockClearAuthToken).not.toHaveBeenCalled()
  })

  it('does NOT call clearAuthToken() on non-401 proxied response', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 })
    )
    await _gateway({
      target: 'https://api.anthropic.com/v1/messages',
      body:   '{}',
    })
    expect(mockClearAuthToken).not.toHaveBeenCalled()
  })
})

// ─── 2. AI rate-limit 60s window reset (lines 208-209) ───────────────────────
describe('callAI — 60s window reset branch (lines 208-209)', () => {
  beforeEach(() => {
    gatewayModeRef.value = 'direct'
    _resetAIRateLimit()
    mockFetch.mockReset()
    // Mock a successful Anthropic response for all callAI calls
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: '{"message":"ok","actions":[]}' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    _resetAIRateLimit()
  })

  it('resets callCount and windowStart when >60s has elapsed between calls', async () => {
    vi.useFakeTimers()

    // First call: establishes windowStart
    const r1 = await callAI('first call', {})
    expect(r1.message).toBeTruthy()

    // Advance past the 60s window AND past the 2s cooldown
    vi.advanceTimersByTime(65_000)

    // Second call: now - windowStart > 60_000 → window reset branch fires
    // The cooldown check uses Date.now() which is also advanced, so lastCall is stale
    const r2 = await callAI('second call after window', {})
    // Should not be a cooldown or rate-limit message — actual AI response
    expect(r2.message).not.toMatch(/wait/i)
    expect(r2.message).not.toMatch(/rate limit/i)
  })

  it('does NOT reset window when <60s has elapsed', async () => {
    vi.useFakeTimers()
    // Reset AFTER fake timers so lastCall/windowStart = fake Date.now()
    _resetAIRateLimit()

    // First call — sets lastCall = fake Date.now(), callCount = 1
    await callAI('first', {})

    // Second call immediately (no timer advance) — within COOLDOWN_MS → returns wait message
    // Window has NOT expired (0ms elapsed < 60_000ms) — window reset branch should NOT fire
    const r2 = await callAI('second', {})
    expect(r2.message).toMatch(/wait/i)
    expect(r2.actions[0].type).toBe('none')
  })
})

// ─── 3. MAX_PER_MINUTE hard cap (line 215) ────────────────────────────────────
describe('callAI — MAX_PER_MINUTE hard cap (line 215)', () => {
  beforeEach(() => {
    _resetAIRateLimit()
    mockFetch.mockReset()
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: '{"message":"ok","actions":[]}' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    _resetAIRateLimit()
  })

  it('returns rate-limit message when callCount reaches MAX_PER_MINUTE (10)', async () => {
    vi.useFakeTimers()

    // Each iteration: advance >2s to bypass COOLDOWN_MS, then call
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(3_000)   // bypass 2s cooldown
      const r = await callAI(`call ${i}`, {})
      // Should be actual response, not a rate-limit message
      expect(r.message).not.toMatch(/rate limit/i)
    }

    // 11th call — callCount is now 10 (>= MAX_PER_MINUTE) → hard cap fires
    vi.advanceTimersByTime(3_000)
    const limited = await callAI('over the limit', {})
    expect(limited.message).toMatch(/rate limit/i)
    expect(limited.actions[0].type).toBe('none')
  })
})
