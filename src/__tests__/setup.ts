/// <reference types="vitest/globals" />
/**
 * Denver Engineering — Vitest Global Setup
 * ──────────────────────────────────
 * Runs before every test file.
 * Extends expect() with jest-dom matchers.
 */

import '@testing-library/jest-dom'
import { configureAxe } from 'jest-axe'
import { dialBoundAddressFamily } from './ephemeralLoopback'

// ADR-014 F5: Supertest binds its per-request server on the `::` wildcard but
// dials http://127.0.0.1, so the kernel could hand it an ephemeral port already
// held by an unrelated IPv4 loopback listener and route the request there. Dial
// the family we bound. See ./ephemeralLoopback.ts for the full mechanism.
dialBoundAddressFamily()

// Configure axe defaults for the test environment.
// CSS custom properties (--jarvis-*) resolve to empty strings in jsdom,
// making color-contrast checks unreliable — disabled globally, validated manually.
configureAxe({
  rules: {
    'color-contrast': { enabled: false },
  },
})

// Polyfill crypto.getRandomValues for jsdom environment
// (used by secureId, csrfToken generation in store/auth modules)
if (typeof (globalThis as unknown as Record<string, unknown>).crypto === 'undefined') {
  ;(globalThis as unknown as Record<string, unknown>).crypto = {
    getRandomValues: (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256)
      }
      return arr
    },
  } as unknown as Crypto
}

// Note: console suppression in tests is handled per-test using vi.spyOn()
// Global vitest helpers (describe, it, expect, beforeEach, vi, etc.)
// are available globally via the vitest.config.ts `globals: true` setting.

// ─── No unit test performs real network I/O ──────────────────────────────────
//
// Components that read their own data (DirectoryView, ActionItemsView) call
// `fetch` on mount. Under jsdom a relative URL resolves against the jsdom base
// origin and Node's global fetch will genuinely try to open a socket — so a
// component test that forgot to stub `fetch` would make a real request, take a
// real timeout, and settle its promise at an unpredictable moment. That is how
// one test's async tail lands inside the next test's `axe()` run and produces
// "Axe is already running" in a file that passes perfectly in isolation.
//
// The default therefore FAILS FAST and loudly. A test that means to exercise a
// request stubs `fetch` itself (vi.stubGlobal), which every such test here does;
// anything else gets a rejected promise naming the URL it tried to reach.
//
// jsdom only — the api suite runs in the node environment and uses supertest
// over real loopback sockets, which must keep working.
if (typeof window !== 'undefined') {
  ;(globalThis as unknown as Record<string, unknown>).fetch = (input: unknown): Promise<never> =>
    Promise.reject(new Error(
      `[test] unstubbed fetch: ${String(
        typeof input === 'string' ? input : (input as { url?: string })?.url ?? input,
      )} — stub it with vi.stubGlobal('fetch', ...) in the test that needs it.`,
    ))
}

// ResizeObserver mock for Recharts in jsdom environment
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe()   { /* noop */ }
    unobserve() { /* noop */ }
    disconnect(){ /* noop */ }
  }
}
