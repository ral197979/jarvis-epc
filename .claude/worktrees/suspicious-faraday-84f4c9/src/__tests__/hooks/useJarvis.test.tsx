/**
 * Tests: src/hooks/useJarvis
 *
 * Covers:
 *   - useJarvis: default context when no Provider is mounted
 *   - JarvisProvider: supplies correct context values
 *   - JarvisProvider: dispatch flows through to useBizStore
 *   - JarvisProvider: onTabChange, onToast, onAudit callbacks
 *   - JarvisProvider: undo / redo state flags
 *   - useJarvisStandalone: works without a JarvisProvider
 *   - useJarvisStandalone: dispatch mutates the store
 */

import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useJarvis,
  useJarvisStandalone,
  JarvisProvider,
  type JarvisProviderProps,
} from '../../hooks/useJarvis'
import { useBizStore } from '../../modules/biz/store'
import { actions, type PolicyConfig } from '../../modules/biz/dispatch'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER_POLICY: PolicyConfig = {
  writesEnabled:  true,
  chatEnabled:    true,
  exportsEnabled: true,
  activeRole:     'owner',
}

function resetStore() {
  useBizStore.getState().reset()
}

// ─── Wrapper helpers ──────────────────────────────────────────────────────────

type ProviderProps = Partial<Omit<JarvisProviderProps, 'children'>>

function makeWrapper(props: ProviderProps = {}) {
  const policy     = props.policy     ?? OWNER_POLICY
  const activeTab  = props.activeTab  ?? 'dash'
  const onTabChange = props.onTabChange
  const onToast    = props.onToast
  const onAudit    = props.onAudit
  const onEmit     = props.onEmit

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      JarvisProvider,
      { policy, activeTab, onTabChange, onToast, onAudit, onEmit },
      children,
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. useJarvis — no provider (default context)
// ═══════════════════════════════════════════════════════════════════════════════
describe('useJarvis — outside JarvisProvider', () => {
  it('returns default biz (empty object shape)', () => {
    const { result } = renderHook(() => useJarvis())
    expect(result.current.biz).toBeDefined()
  })

  it('returns viewer policy by default', () => {
    const { result } = renderHook(() => useJarvis())
    expect(result.current.policy.activeRole).toBe('viewer')
  })

  it('dispatch returns ok:false with no-provider reason', () => {
    const { result } = renderHook(() => useJarvis())
    const res = result.current.dispatch(actions.addLead({ id: 'L-1', name: 'x', status: 'new', estimated_value: 0, probability: 0 }))
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('No JarvisProvider')
  })

  it('canUndo and canRedo are false', () => {
    const { result } = renderHook(() => useJarvis())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('activeTab defaults to "dash"', () => {
    const { result } = renderHook(() => useJarvis())
    expect(result.current.activeTab).toBe('dash')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2. JarvisProvider — context values
// ═══════════════════════════════════════════════════════════════════════════════
describe('JarvisProvider — supplies context values', () => {
  beforeEach(resetStore)

  it('provides the correct policy', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })
    expect(result.current.policy.activeRole).toBe('owner')
    expect(result.current.policy.writesEnabled).toBe(true)
  })

  it('provides the correct activeTab', () => {
    const { result } = renderHook(() => useJarvis(), {
      wrapper: makeWrapper({ activeTab: 'crm' }),
    })
    expect(result.current.activeTab).toBe('crm')
  })

  it('exposes actions object', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })
    expect(typeof result.current.actions.addLead).toBe('function')
    expect(typeof result.current.actions.addPO).toBe('function')
  })

  it('exposes typed dispatch', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })
    expect(typeof result.current.dispatch).toBe('function')
  })

  it('exposes typed dispatchMany', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })
    expect(typeof result.current.dispatchMany).toBe('function')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 3. JarvisProvider — dispatch flows to store
// ═══════════════════════════════════════════════════════════════════════════════
describe('JarvisProvider — dispatch → store', () => {
  beforeEach(resetStore)

  it('dispatch(addLead) adds a lead to the biz store', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })

    act(() => {
      result.current.dispatch(
        result.current.actions.addLead({ id: 'L-1', name: 'Acme', status: 'new', estimated_value: 500_000, probability: 60 })
      )
    })

    expect(useBizStore.getState().biz.leads).toHaveLength(1)
    expect(useBizStore.getState().biz.leads[0]?.id).toBe('L-1')
  })

  it('biz state in hook reflects store update', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })

    act(() => {
      result.current.dispatch(
        result.current.actions.addLead({ id: 'L-2', name: 'Beta', status: 'qualified', estimated_value: 0, probability: 0 })
      )
    })

    expect(result.current.biz.leads).toHaveLength(1)
    expect(result.current.biz.leads[0]?.name).toBe('Beta')
  })

  it('dispatchMany adds multiple leads atomically', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })

    act(() => {
      result.current.dispatchMany([
        result.current.actions.addLead({ id: 'L-3', name: 'C', status: 'new', estimated_value: 0, probability: 0 }),
        result.current.actions.addLead({ id: 'L-4', name: 'D', status: 'new', estimated_value: 0, probability: 0 }),
      ])
    })

    expect(useBizStore.getState().biz.leads).toHaveLength(2)
  })

  it('dispatch is blocked for viewer policy', () => {
    const viewerPolicy: PolicyConfig = { ...OWNER_POLICY, activeRole: 'viewer', writesEnabled: false }
    const { result } = renderHook(() => useJarvis(), {
      wrapper: makeWrapper({ policy: viewerPolicy }),
    })

    let res!: ReturnType<typeof result.current.dispatch>
    act(() => {
      res = result.current.dispatch(
        result.current.actions.addLead({ id: 'L-V', name: 'Viewer', status: 'new', estimated_value: 0, probability: 0 })
      )
    })

    expect(res.ok).toBe(false)
    expect(useBizStore.getState().biz.leads).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4. JarvisProvider — callbacks
// ═══════════════════════════════════════════════════════════════════════════════
describe('JarvisProvider — callbacks', () => {
  beforeEach(resetStore)

  it('onTabChange fires when setTab is called', () => {
    const onTabChange = vi.fn()
    const { result } = renderHook(() => useJarvis(), {
      wrapper: makeWrapper({ onTabChange }),
    })

    act(() => { result.current.setTab('safety') })
    expect(onTabChange).toHaveBeenCalledWith('safety')
  })

  it('toast calls onToast with message and type', () => {
    const onToast = vi.fn()
    const { result } = renderHook(() => useJarvis(), {
      wrapper: makeWrapper({ onToast }),
    })

    act(() => { result.current.toast('Hello', 'success') })
    expect(onToast).toHaveBeenCalledWith('Hello', 'success')
  })

  it('toast defaults to "info" type when type omitted', () => {
    const onToast = vi.fn()
    const { result } = renderHook(() => useJarvis(), {
      wrapper: makeWrapper({ onToast }),
    })

    act(() => { result.current.toast('Info message') })
    expect(onToast).toHaveBeenCalledWith('Info message', 'info')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 5. JarvisProvider — undo / redo
// ═══════════════════════════════════════════════════════════════════════════════
describe('JarvisProvider — undo / redo', () => {
  beforeEach(resetStore)

  it('canUndo becomes true after a dispatch', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })

    act(() => {
      result.current.dispatch(
        result.current.actions.addLead({ id: 'L-U', name: 'U', status: 'new', estimated_value: 0, probability: 0 })
      )
    })

    expect(result.current.canUndo).toBe(true)
  })

  it('undo removes the lead', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })

    act(() => {
      result.current.dispatch(
        result.current.actions.addLead({ id: 'L-U2', name: 'U2', status: 'new', estimated_value: 0, probability: 0 })
      )
    })

    act(() => { result.current.undo() })

    expect(useBizStore.getState().biz.leads).toHaveLength(0)
  })

  it('canRedo becomes true after undo', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })

    act(() => {
      result.current.dispatch(
        result.current.actions.addLead({ id: 'L-R', name: 'R', status: 'new', estimated_value: 0, probability: 0 })
      )
    })
    act(() => { result.current.undo() })

    expect(result.current.canRedo).toBe(true)
  })

  it('redo re-applies the undone action', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })

    act(() => {
      result.current.dispatch(
        result.current.actions.addLead({ id: 'L-RR', name: 'RR', status: 'new', estimated_value: 0, probability: 0 })
      )
    })
    act(() => { result.current.undo() })
    act(() => { result.current.redo() })

    expect(useBizStore.getState().biz.leads).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 6. useJarvisStandalone — without a provider
// ═══════════════════════════════════════════════════════════════════════════════
describe('useJarvisStandalone', () => {
  beforeEach(resetStore)

  it('works without a JarvisProvider', () => {
    const { result } = renderHook(() =>
      useJarvisStandalone({ policy: OWNER_POLICY, activeTab: 'projects' })
    )
    expect(result.current.activeTab).toBe('projects')
    expect(result.current.policy.activeRole).toBe('owner')
  })

  it('dispatch adds a lead to the store', () => {
    const { result } = renderHook(() =>
      useJarvisStandalone({ policy: OWNER_POLICY })
    )

    act(() => {
      result.current.dispatch(
        result.current.actions.addLead({ id: 'L-SA', name: 'SA', status: 'new', estimated_value: 0, probability: 0 })
      )
    })

    expect(useBizStore.getState().biz.leads[0]?.id).toBe('L-SA')
  })

  it('biz state reflects store updates', () => {
    const { result } = renderHook(() =>
      useJarvisStandalone({ policy: OWNER_POLICY })
    )

    act(() => {
      useBizStore.getState().dispatch(
        actions.addLead({ id: 'L-SB', name: 'SB', status: 'new', estimated_value: 0, probability: 0 })
      )
    })

    expect(result.current.biz.leads).toHaveLength(1)
  })

  it('setTab calls onTabChange', () => {
    const onTabChange = vi.fn()
    const { result } = renderHook(() =>
      useJarvisStandalone({ policy: OWNER_POLICY, onTabChange })
    )

    act(() => { result.current.setTab('safety') })
    expect(onTabChange).toHaveBeenCalledWith('safety')
  })

  it('toast calls onToast', () => {
    const onToast = vi.fn()
    const { result } = renderHook(() =>
      useJarvisStandalone({ policy: OWNER_POLICY, onToast })
    )

    act(() => { result.current.toast('standalone toast', 'warn') })
    expect(onToast).toHaveBeenCalledWith('standalone toast', 'warn')
  })
})
