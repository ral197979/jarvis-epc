/**
 * JARVIS EPC — JarvisContext + useJarvis hook
 * ─────────────────────────────────────────────
 * Sprint 6 (v4.31.0): Extracted from JarvisCore.jsx (SM-01 / SM-08).
 *
 * Provides the central React context for JARVIS state distribution and
 * the `useJarvis()` hook used by all child components.
 */

import React from 'react'
import { JARVIS_ACTIONS } from '../modules/biz/reducer'
import type { PolicyConfig } from '../modules/biz/dispatch'

// ─── Context value shape ──────────────────────────────────────────────────────

export interface JarvisContextValue {
  biz:            Record<string, unknown>
  dispatch:       (action: unknown, data?: unknown, meta?: unknown) => boolean
  mutate:         (fn: (state: unknown) => void, label?: string) => void
  setTab:         (tab: string) => void
  ownerCfg:       Record<string, unknown>
  activeRole:     string
  auditLog:       unknown[]
  apiStats:       { count: number; tokens: number; lastCall: number }
  errorLog:       unknown[]
  sessionMetrics: Record<string, unknown>
  ACTIONS:        typeof JARVIS_ACTIONS
  /** Policy alias — same object as ownerCfg, exposed for legacy callers */
  policy?:        PolicyConfig | Record<string, unknown>
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const JarvisContext = React.createContext<JarvisContextValue | null>(null)

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useJarvis — typed access to the JARVIS context value.
 *
 * Returns a safe stub when called outside the Provider so that components
 * rendered outside the tree (e.g. portals, tests) don't hard-crash.
 */
export function useJarvis(): JarvisContextValue {
  const ctx = React.useContext(JarvisContext)
  if (!ctx) {
    console.warn('[JARVIS] useJarvis() called outside JarvisContext.Provider — returning stub')
    return {
      biz:            {},
      dispatch:       () => false,
      mutate:         () => {},
      setTab:         () => {},
      ownerCfg:       {},
      activeRole:     'owner',
      auditLog:       [],
      apiStats:       { count: 0, tokens: 0, lastCall: 0 },
      errorLog:       [],
      sessionMetrics: {},
      ACTIONS:        JARVIS_ACTIONS,
    }
  }
  return ctx
}
