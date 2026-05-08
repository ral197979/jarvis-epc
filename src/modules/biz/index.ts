/**
 * Denver Engineering — Biz Module
 * Barrel export for all biz domain functionality.
 *
 * Modules:
 *   reducer.ts   — pure reducer, action types, JARVIS_ACTIONS constants
 *   store.ts     — Zustand store with undo/redo, selectors, snapshot
 *   dispatch.ts  — typed dispatch bridge with policy enforcement
 *   mutateBiz.ts — mutateBiz bridge + legacy _dispatch adapter (Phase 22)
 *
 * NOTE: Pure re-export files (`export * from`) are not tracked by V8 coverage
 * because `export * from` is a module-level declaration, not a runtime statement.
 * This is a known V8 limitation — the actual logic in each module IS covered.
 * @see https://github.com/vitest-dev/vitest/issues/3252
 */
/* v8 ignore file */
export * from './reducer'
export * from './store'
export * from './dispatch'
export * from './mutateBiz'
