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

// ResizeObserver mock for Recharts in jsdom environment
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe()   { /* noop */ }
    unobserve() { /* noop */ }
    disconnect(){ /* noop */ }
  }
}
