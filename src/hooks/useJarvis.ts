/**
 * JARVIS EPC — useJarvis Hook
 * ─────────────────────────────
 * Phase 7: Typed replacement for the untyped `useJarvis()` in JarvisCore.jsx.
 *
 * The monolith's original hook:
 *   function useJarvis() {
 *     var ctx = React.useContext(JarvisContext);
 *     if (!ctx) return { biz: {}, dispatch: function(){}, mutate: function(){}, ... };
 *     return ctx;
 *   }
 *
 * This version:
 *   - Fully typed — no implicit `any`
 *   - Integrates useBizStore (Zustand) for reactive biz state
 *   - Wraps the typed dispatch bridge (createDispatch)
 *   - Exposes stable action creators (`actions.*`) for ergonomic use
 *   - Provides tab navigation, toast, and policy helpers
 *   - Works standalone (no React.Context required) — consumable in any component
 *
 * Migration pattern:
 *   BEFORE (JarvisCore):
 *     var _ctx = useJarvis();
 *     var t = _ctx.biz || i.b;
 *     _ctx.mutate(function(state) { state.leads.push(newLead); });
 *
 *   AFTER:
 *     const { biz, dispatch, actions } = useJarvis({ policy: ownerCfg });
 *     dispatch(actions.addLead({ id: 'L-1', name: 'Acme' }));
 *
 * Phase 8 target: Remove all `_ctx.mutate(...)` callers and replace with
 * typed `dispatch(actions.*)` calls through this hook.
 */

import { useMemo, useCallback, useContext, createContext } from 'react'
import { useBizStore, type BizState } from '../modules/biz/store'
import {
  createDispatch,
  actions as actionCreators,
  type PolicyConfig,
  type DispatchResult,
  type AuditEntry,
} from '../modules/biz/dispatch'
import { type BizAction } from '../modules/biz/reducer'

// ─── JarvisContext types ──────────────────────────────────────────────────────
/**
 * JarvisContextValue — the shape of what useJarvis returns.
 * Components that use the hook depend only on this interface.
 */
export interface JarvisContextValue {
  /** Current reactive biz state */
  biz:            BizState
  /** Current policy / owner config */
  policy:         PolicyConfig
  /** Dispatch a typed domain action */
  dispatch:       (action: BizAction) => DispatchResult
  /** Batch-dispatch multiple actions atomically */
  dispatchMany:   (actions: BizAction[]) => DispatchResult
  /** Typed action creators — import-free ergonomic API */
  actions:        typeof actionCreators
  /** Navigate to a named tab */
  setTab:         (tab: string) => void
  /** Currently active tab */
  activeTab:      string
  /** Show a toast notification */
  toast:          (msg: string, type?: 'info' | 'success' | 'warn' | 'error') => void
  /** Undo last mutation (returns true if undone) */
  undo:           () => boolean
  /** Redo last undone mutation (returns true if redone) */
  redo:           () => boolean
  /** Whether undo is available */
  canUndo:        boolean
  /** Whether redo is available */
  canRedo:        boolean
}

// ─── Default / stub values ────────────────────────────────────────────────────
const NOOP_RESULT: DispatchResult = { ok: false, reason: 'No JarvisProvider mounted' }

const defaultContext: JarvisContextValue = {
  biz:          {} as BizState,
  policy:       {
    writesEnabled: false, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer',
  },
  dispatch:     () => NOOP_RESULT,
  dispatchMany: () => NOOP_RESULT,
  actions:      actionCreators,
  setTab:       () => undefined,
  activeTab:    'dash',
  toast:        () => undefined,
  undo:         () => false,
  redo:         () => false,
  canUndo:      false,
  canRedo:      false,
}

// ─── React Context ────────────────────────────────────────────────────────────
export const JarvisContext = createContext<JarvisContextValue>(defaultContext)
JarvisContext.displayName = 'JarvisContext'

// ─── Provider props ───────────────────────────────────────────────────────────
import type { ReactNode } from 'react'

export interface JarvisProviderProps {
  children?:   ReactNode
  policy:      PolicyConfig
  activeTab?:  string
  onTabChange?: (tab: string) => void
  onToast?:    (msg: string, type: string) => void
  onAudit?:    (entry: AuditEntry) => void
  onEmit?:     (domain: string, event: string, data: unknown, source: string) => void
}

/**
 * JarvisProvider — wraps the app tree and supplies typed JarvisContext.
 *
 * Mount this at the top of a migrated component subtree.
 * JarvisCore still uses its own legacy context; this is for extracted components.
 *
 * @example
 *   <JarvisProvider policy={ownerCfg} activeTab={currentTab} onTabChange={setTab}>
 *     <Dashboard />
 *   </JarvisProvider>
 */
import React from 'react'

export function JarvisProvider({
  children,
  policy,
  activeTab    = 'dash',
  onTabChange,
  onToast,
  onAudit,
  onEmit,
}: JarvisProviderProps) {
  const biz      = useBizStore(s => s.biz)
  const canUndo  = useBizStore(s => s.canUndo)
  const canRedo  = useBizStore(s => s.canRedo)
  const undoFn   = useBizStore(s => s.undo)
  const redoFn   = useBizStore(s => s.redo)

  const toast = useCallback((msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    onToast?.(msg, type)
  }, [onToast])

  const { dispatch, dispatchMany } = useMemo(() =>
    createDispatch({ policy, emit: onEmit, audit: onAudit, toast, logError: console.error }),
  [policy, onEmit, onAudit, toast])

  const setTab = useCallback((tab: string) => {
    onTabChange?.(tab)
  }, [onTabChange])

  const value = useMemo<JarvisContextValue>(() => ({
    biz,
    policy,
    dispatch,
    dispatchMany,
    actions: actionCreators,
    setTab,
    activeTab,
    toast,
    undo:    undoFn,
    redo:    redoFn,
    canUndo,
    canRedo,
  }), [biz, policy, dispatch, dispatchMany, setTab, activeTab, toast, undoFn, redoFn, canUndo, canRedo])

  return (
    React.createElement(JarvisContext.Provider, { value }, children)
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
/**
 * useJarvis — consume the JarvisContext from within any component.
 *
 * Falls back to stub values if called outside a JarvisProvider — safe for
 * use in standalone components or during migration when the Provider isn't
 * mounted yet.
 *
 * @example
 *   function MyForm() {
 *     const { dispatch, actions, biz } = useJarvis()
 *     const handleSubmit = (data) => dispatch(actions.addLead(data))
 *     return <form>...</form>
 *   }
 */
export function useJarvis(): JarvisContextValue {
  return useContext(JarvisContext)
}

/**
 * useJarvisStandalone — version that does NOT require a JarvisProvider.
 * Creates its own dispatch instance from the supplied policy.
 *
 * Use for components that must work both inside and outside JarvisProvider.
 *
 * @example
 *   function StandaloneWidget({ policy }: { policy: PolicyConfig }) {
 *     const { dispatch, biz } = useJarvisStandalone({ policy })
 *     ...
 *   }
 */
export function useJarvisStandalone(opts: {
  policy:     PolicyConfig
  activeTab?: string
  onTabChange?: (tab: string) => void
  onToast?:   (msg: string, type: string) => void
  onAudit?:   (entry: AuditEntry) => void
}): JarvisContextValue {
  const { policy, activeTab = 'dash', onTabChange, onToast, onAudit } = opts

  const biz     = useBizStore(s => s.biz)
  const canUndo = useBizStore(s => s.canUndo)
  const canRedo = useBizStore(s => s.canRedo)
  const undoFn  = useBizStore(s => s.undo)
  const redoFn  = useBizStore(s => s.redo)

  const toast = useCallback((msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    onToast?.(msg, type)
  }, [onToast])

  const { dispatch, dispatchMany } = useMemo(() =>
    createDispatch({ policy, audit: onAudit, toast, logError: console.error }),
  [policy, onAudit, toast])

  const setTab = useCallback((tab: string) => onTabChange?.(tab), [onTabChange])

  return useMemo<JarvisContextValue>(() => ({
    biz, policy, dispatch, dispatchMany, actions: actionCreators,
    setTab, activeTab, toast, undo: undoFn, redo: redoFn, canUndo, canRedo,
  }), [biz, policy, dispatch, dispatchMany, setTab, activeTab, toast, undoFn, redoFn, canUndo, canRedo])
}

// ─── Re-exports ────────────────────────────────────────────────────────────────
export { actionCreators as actions }
export type { PolicyConfig, DispatchResult, BizAction, AuditEntry }
