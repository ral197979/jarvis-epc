/**
 * JARVIS EPC — mutateBiz Typed Bridge
 * ──────────────────────────────────────
 * Phase 22: Typed replacement for JarvisCore's legacy `_dispatch(action, data)` API.
 *
 * Architecture:
 *   JarvisCore._dispatch("add",    { collection, record })
 *   JarvisCore._dispatch("update", { collection, id, changes })
 *   JarvisCore._dispatch("delete", { collection, id })
 *   JarvisCore._dispatch("bulk",   { mutator: (state) => void })
 *   JarvisCore._dispatch({ type, data }, ...)        ← typed JARVIS_ACTIONS
 *
 * → all route through mutateBiz → useBizStore.getState().dispatch()
 *
 * Migration status:
 *   Phase 7–21: Typed domain components (ActionItemsView, CRMLeads, etc.) use
 *               createDispatch() directly — fully migrated.
 *   Phase 22:   This module provides the bridge for JarvisCore's remaining
 *               _dispatch() calls so they also reach the typed Zustand store.
 *
 * Usage (JarvisCore on mount):
 *   import { createMutateBizBridge } from '../modules/biz/mutateBiz'
 *   const { mutateBiz } = createMutateBizBridge({ policy: _oCfg })
 *
 * Usage (typed components):
 *   mutateBiz({ op: 'add',    collection: 'leads',    record: newLead })
 *   mutateBiz({ op: 'update', collection: 'leads',    id: 'L-1', changes: { status: 'won' } })
 *   mutateBiz({ op: 'delete', collection: 'leads',    id: 'L-1' })
 *   mutateBiz({ op: 'bulk',   mutator: (state) => { state.leads = [] } })
 *   mutateBiz({ op: 'typed',  action: actions.addLead({ id: 'L-2', name: 'Acme' }) })
 */

import { useBizStore } from './store'
import { type BizAction, type BizRecord, type BizState } from './reducer'
import { checkWritePolicy, type PolicyConfig } from './dispatch'

// Sentinel action used for write-gate pre-check
const WRITE_SENTINEL: BizAction = { type: 'generic/update_collection', data: {} }

// ─── Public operation types ────────────────────────────────────────────────────

export interface MutateAdd {
  op:         'add'
  collection: string
  record:     BizRecord
}

export interface MutateUpdate {
  op:         'update'
  collection: string
  id:         string
  changes:    Partial<BizRecord>
}

export interface MutateDelete {
  op:         'delete'
  collection: string
  id:         string
}

export interface MutateBulk {
  op:      'bulk'
  mutator: (state: BizState) => void
}

export interface MutateTyped {
  op:     'typed'
  action: BizAction
}

export type MutateBizOp =
  | MutateAdd
  | MutateUpdate
  | MutateDelete
  | MutateBulk
  | MutateTyped

export interface MutateBizResult {
  ok:      boolean
  reason?: string
}

// ─── Bridge factory ────────────────────────────────────────────────────────────

export interface MutateBizBridge {
  /** Perform a single mutation */
  mutateBiz: (op: MutateBizOp) => MutateBizResult
  /** Perform multiple mutations atomically */
  mutateBizMany: (ops: MutateBizOp[]) => MutateBizResult
}

export interface MutateBizBridgeOptions {
  /** Policy config — write gate is enforced before every mutation */
  policy:  PolicyConfig
  /** Optional: called when a write is blocked by policy */
  onBlocked?: (reason: string) => void
}

/**
 * createMutateBizBridge — builds a mutateBiz bridge bound to a policy config.
 *
 * All operations are:
 *   1. Policy-checked (data:write gate)
 *   2. Translated to typed BizActions
 *   3. Dispatched to useBizStore.getState().dispatch()
 */
export function createMutateBizBridge(opts: MutateBizBridgeOptions): MutateBizBridge {
  const { policy, onBlocked } = opts

  function _enforceWritePolicy(): MutateBizResult | null {
    const check = checkWritePolicy(WRITE_SENTINEL, policy)
    if (!check.allowed) {
      onBlocked?.(check.reason)
      return { ok: false, reason: check.reason }
    }
    return null
  }

  function _opToAction(op: MutateBizOp): BizAction | null {
    switch (op.op) {
      case 'add': {
        const { collection, record } = op
        return {
          type:    'raw/mutate' as const,
          mutator: (state: Record<string, unknown>) => {
            const arr = (state[collection] ?? []) as BizRecord[]
            ;(state[collection] as BizRecord[]) = [...arr, record]
          },
        } as unknown as BizAction
      }
      case 'update': {
        const { collection, id, changes } = op
        return {
          type:    'raw/mutate' as const,
          mutator: (state: Record<string, unknown>) => {
            const arr = (state[collection] ?? []) as BizRecord[]
            ;(state[collection] as BizRecord[]) = arr.map(r =>
              r.id === id ? { ...r, ...changes } : r
            )
          },
        } as unknown as BizAction
      }
      case 'delete': {
        const { collection, id } = op
        return {
          type:    'raw/mutate' as const,
          mutator: (state: Record<string, unknown>) => {
            const arr = (state[collection] ?? []) as BizRecord[]
            ;(state[collection] as BizRecord[]) = arr.filter(r => r.id !== id)
          },
        } as unknown as BizAction
      }
      case 'bulk':
        return {
          type:    'raw/mutate' as const,
          mutator: op.mutator,
        } as unknown as BizAction
      case 'typed':
        return op.action
      default:
        return null
    }
  }

  function mutateBiz(op: MutateBizOp): MutateBizResult {
    const blocked = _enforceWritePolicy()
    if (blocked) return blocked

    const action = _opToAction(op)
    if (!action) return { ok: false, reason: `Unknown op: ${(op as MutateBizOp).op}` }

    const ok = useBizStore.getState().dispatch(action)
    return { ok, reason: ok ? undefined : 'Dispatch rejected by store' }
  }

  function mutateBizMany(ops: MutateBizOp[]): MutateBizResult {
    const blocked = _enforceWritePolicy()
    if (blocked) return blocked

    const actions: BizAction[] = []
    for (const op of ops) {
      const action = _opToAction(op)
      if (!action) return { ok: false, reason: `Unknown op: ${(op as MutateBizOp).op}` }
      actions.push(action)
    }

    const ok = useBizStore.getState().dispatchMany(actions)
    return { ok, reason: ok ? undefined : 'BatchDispatch rejected by store' }
  }

  return { mutateBiz, mutateBizMany }
}

// ─── Singleton convenience accessor ───────────────────────────────────────────

/**
 * getMutateBiz — returns a mutateBiz function bound to the provided policy.
 *
 * Convenience wrapper for cases where a factory is too verbose:
 *
 *   const mutateBiz = getMutateBiz(policy)
 *   mutateBiz({ op: 'add', collection: 'leads', record: newLead })
 */
export function getMutateBiz(
  policy: PolicyConfig,
  onBlocked?: (reason: string) => void,
): (op: MutateBizOp) => MutateBizResult {
  const { mutateBiz } = createMutateBizBridge({ policy, onBlocked })
  return mutateBiz
}

// ─── Legacy string-dispatch adapter ──────────────────────────────────────────
// Enables drop-in replacement for JarvisCore._dispatch(action, data) callers.

type LegacyAction = 'add' | 'update' | 'delete' | 'bulk' | string
type LegacyData   = Record<string, unknown> & {
  collection?: string
  record?:     BizRecord
  id?:         string
  changes?:    Partial<BizRecord>
  mutator?:    (state: Record<string, unknown>) => void
}

/**
 * createLegacyDispatch — adapts the old `_dispatch(action, data)` signature
 * to the typed mutateBiz bridge.
 *
 * @example
 *   const _dispatch = createLegacyDispatch({ policy: _oCfg })
 *   _dispatch('add',    { collection: 'leads', record: newLead })
 *   _dispatch('update', { collection: 'leads', id: 'L-1', changes: { status: 'won' } })
 *   _dispatch({ type: 'crm/add_lead', data: newLead })  ← typed pass-through
 */
export function createLegacyDispatch(opts: MutateBizBridgeOptions): (
  action: LegacyAction | BizAction,
  data?:  LegacyData,
) => boolean {
  const { mutateBiz } = createMutateBizBridge(opts)

  return function legacyDispatch(
    action: LegacyAction | BizAction,
    data:   LegacyData = {},
  ): boolean {
    // Typed object action — direct pass-through
    if (typeof action === 'object' && 'type' in action) {
      return mutateBiz({ op: 'typed', action }).ok
    }

    switch (action) {
      case 'add':
        if (!data.collection || !data.record) return false
        return mutateBiz({ op: 'add', collection: data.collection, record: data.record }).ok
      case 'update':
        if (!data.collection || !data.id || !data.changes) return false
        return mutateBiz({ op: 'update', collection: data.collection, id: data.id, changes: data.changes }).ok
      case 'delete':
        if (!data.collection || !data.id) return false
        return mutateBiz({ op: 'delete', collection: data.collection, id: data.id }).ok
      case 'bulk':
        if (typeof data.mutator !== 'function') return false
        return mutateBiz({ op: 'bulk', mutator: data.mutator }).ok
      default:
        // JARVIS_ACTIONS string (e.g. 'crm/add_lead') — pass as typed action
        if (typeof action === 'string' && action.includes('/')) {
          return mutateBiz({ op: 'typed', action: { type: action, data } as BizAction }).ok
        }
        return false
    }
  }
}
