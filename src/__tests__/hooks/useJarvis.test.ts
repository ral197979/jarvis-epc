/**
 * Tests: hooks/useJarvis
 * Coverage: useJarvis (context hook), useJarvisStandalone,
 *           JarvisProvider, dispatch integration, undo/redo through hook
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import React from 'react'
import { useJarvis, useJarvisStandalone, JarvisProvider } from '../../hooks/useJarvis'
import { useBizStore, JARVIS_ACTIONS } from '../../modules/biz/store'
import type { PolicyConfig } from '../../modules/biz/dispatch'

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const ownerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner',
}

const viewerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: false, exportsEnabled: false, activeRole: 'viewer',
}

beforeEach(() => useBizStore.getState().reset())

// ─── useJarvis (without provider) ────────────────────────────────────────────
describe('useJarvis — without JarvisProvider', () => {
  it('returns stub biz state (empty object)', () => {
    const { result } = renderHook(() => useJarvis())
    expect(result.current.biz).toBeDefined()
  })

  it('returns the actions creators object', () => {
    const { result } = renderHook(() => useJarvis())
    expect(typeof result.current.actions.addLead).toBe('function')
    expect(typeof result.current.actions.recordPayment).toBe('function')
  })

  it('stub dispatch returns ok:false', () => {
    const { result } = renderHook(() => useJarvis())
    const res = result.current.dispatch({ type: JARVIS_ACTIONS.ADD_LEAD })
    expect(res.ok).toBe(false)
  })

  it('canUndo and canRedo default to false', () => {
    const { result } = renderHook(() => useJarvis())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('activeTab defaults to dash', () => {
    const { result } = renderHook(() => useJarvis())
    expect(result.current.activeTab).toBe('dash')
  })
})

// ─── useJarvisStandalone ──────────────────────────────────────────────────────
describe('useJarvisStandalone', () => {
  it('returns typed biz state from Zustand', () => {
    const { result } = renderHook(() => useJarvisStandalone({ policy: ownerPolicy }))
    expect(Array.isArray(result.current.biz.leads)).toBe(true)
  })

  it('dispatch adds a lead to the store', () => {
    const { result } = renderHook(() => useJarvisStandalone({ policy: ownerPolicy }))
    act(() => {
      result.current.dispatch(result.current.actions.addLead({ id: 'L-SA-1', status: 'open' }))
    })
    expect(useBizStore.getState().biz.leads).toHaveLength(1)
  })

  it('dispatch returns ok:false for viewer', () => {
    const { result } = renderHook(() => useJarvisStandalone({ policy: viewerPolicy }))
    let res: { ok: boolean; reason?: string } = { ok: true }
    act(() => { res = result.current.dispatch(result.current.actions.addLead({ id: 'L-1' })) })
    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/viewer/i)
  })

  it('canUndo is true after dispatch', () => {
    const { result } = renderHook(() => useJarvisStandalone({ policy: ownerPolicy }))
    act(() => {
      result.current.dispatch(result.current.actions.addLead({ id: 'L-1' }))
    })
    expect(result.current.canUndo).toBe(true)
  })

  it('undo reverts the mutation', () => {
    const { result } = renderHook(() => useJarvisStandalone({ policy: ownerPolicy }))
    act(() => {
      result.current.dispatch(result.current.actions.addLead({ id: 'L-1' }))
    })
    expect(useBizStore.getState().biz.leads).toHaveLength(1)
    act(() => { result.current.undo() })
    expect(useBizStore.getState().biz.leads).toHaveLength(0)
  })

  it('redo re-applies undone mutation', () => {
    const { result } = renderHook(() => useJarvisStandalone({ policy: ownerPolicy }))
    act(() => {
      result.current.dispatch(result.current.actions.addLead({ id: 'L-1' }))
    })
    act(() => { result.current.undo() })
    act(() => { result.current.redo() })
    expect(useBizStore.getState().biz.leads).toHaveLength(1)
  })

  it('setTab calls onTabChange', () => {
    const onTabChange = vi.fn()
    const { result } = renderHook(() =>
      useJarvisStandalone({ policy: ownerPolicy, onTabChange }),
    )
    act(() => { result.current.setTab('crm') })
    expect(onTabChange).toHaveBeenCalledWith('crm')
  })

  it('toast calls onToast', () => {
    const onToast = vi.fn()
    const { result } = renderHook(() =>
      useJarvisStandalone({ policy: ownerPolicy, onToast }),
    )
    act(() => { result.current.toast('Hello', 'success') })
    expect(onToast).toHaveBeenCalledWith('Hello', 'success')
  })

  it('dispatchMany applies batch atomically', () => {
    const { result } = renderHook(() => useJarvisStandalone({ policy: ownerPolicy }))
    act(() => {
      result.current.dispatchMany([
        result.current.actions.addLead({ id: 'L-1' }),
        result.current.actions.addLead({ id: 'L-2' }),
        result.current.actions.addInvoice({ id: 'I-1', amount: 1000 }),
      ])
    })
    expect(useBizStore.getState().biz.leads).toHaveLength(2)
    expect(useBizStore.getState().biz.invoices).toHaveLength(1)
  })
})

// ─── JarvisProvider + useJarvis ───────────────────────────────────────────────
describe('JarvisProvider + useJarvis', () => {
  function makeWrapper(
    policy: PolicyConfig = ownerPolicy,
    opts: { onTabChange?: (t: string) => void; onToast?: (m: string, type: string) => void } = {},
  ) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(JarvisProvider, {
        policy,
        activeTab: 'dash',
        onTabChange: opts.onTabChange,
        onToast: opts.onToast,
      }, children)
    }
  }

  it('provides biz state from Zustand store', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })
    expect(Array.isArray(result.current.biz.leads)).toBe(true)
  })

  it('provides the policy', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })
    expect(result.current.policy.activeRole).toBe('owner')
  })

  it('dispatch through provider adds to store', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })
    act(() => {
      result.current.dispatch(result.current.actions.addLead({ id: 'L-P-1', status: 'open' }))
    })
    expect(useBizStore.getState().biz.leads).toHaveLength(1)
  })

  it('dispatch returns ok:false for viewer through provider', () => {
    const { result } = renderHook(
      () => useJarvis(),
      { wrapper: makeWrapper(viewerPolicy) },
    )
    let res: { ok: boolean } = { ok: true }
    act(() => { res = result.current.dispatch(result.current.actions.addLead({ id: 'L-1' })) })
    expect(res.ok).toBe(false)
  })

  it('canUndo updates reactively after dispatch', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })
    expect(result.current.canUndo).toBe(false)
    act(() => {
      result.current.dispatch(result.current.actions.addLead({ id: 'L-1' }))
    })
    expect(result.current.canUndo).toBe(true)
  })

  it('setTab calls onTabChange', () => {
    const onTabChange = vi.fn()
    const { result } = renderHook(() => useJarvis(), {
      wrapper: makeWrapper(ownerPolicy, { onTabChange }),
    })
    act(() => { result.current.setTab('crm') })
    expect(onTabChange).toHaveBeenCalledWith('crm')
  })

  it('toast calls onToast', () => {
    const onToast = vi.fn()
    const { result } = renderHook(() => useJarvis(), {
      wrapper: makeWrapper(ownerPolicy, { onToast }),
    })
    act(() => { result.current.toast('Done!', 'success') })
    expect(onToast).toHaveBeenCalledWith('Done!', 'success')
  })

  it('undo reverts mutation dispatched through provider', () => {
    const { result } = renderHook(() => useJarvis(), { wrapper: makeWrapper() })
    act(() => {
      result.current.dispatch(result.current.actions.addLead({ id: 'L-1' }))
    })
    act(() => { result.current.undo() })
    expect(useBizStore.getState().biz.leads).toHaveLength(0)
  })
})

// ─── actions creator integration ─────────────────────────────────────────────
describe('actions — full lifecycle through hook', () => {
  it('full EPC workflow: lead → contract → invoice → payment', () => {
    const { result } = renderHook(() => useJarvisStandalone({ policy: ownerPolicy }))
    const { dispatch, actions: a } = result.current

    act(() => {
      dispatch(a.addLead({ id: 'L-W1', name: 'Acme Corp', status: 'qualified', estimated_value: 500000 }))
      dispatch(a.addContract({ id: 'C-W1', project: 'Acme Tower', client: 'Acme Corp', value: 450000, status: 'active' }))
      dispatch(a.addInvoice({ id: 'INV-W1', amount: 150000, status: 'unpaid', project: 'Acme Tower' }))
      dispatch(a.recordPayment('INV-W1'))
    })

    const store = useBizStore.getState()
    expect(store.biz.leads).toHaveLength(1)
    expect(store.biz.contracts).toHaveLength(1)
    expect(store.biz.invoices[0].status).toBe('paid')
  })

  it('EVM dispatch through hook computes metrics', () => {
    const { result } = renderHook(() => useJarvisStandalone({ policy: ownerPolicy }))
    act(() => {
      result.current.dispatch(result.current.actions.addEVM({
        project: 'Alpha', period: 'Q1-2026',
        budget: 1_000_000, ev: 800_000, ac: 850_000, pv: 900_000,
      }))
    })
    const evm = useBizStore.getState().biz.evm_projects[0]
    expect(evm.cpi).toBeCloseTo(800000 / 850000, 2)
  })

  it('safety workflow: jha → toolbox → incident', () => {
    const { result } = renderHook(() => useJarvisStandalone({ policy: ownerPolicy }))
    act(() => {
      result.current.dispatch(result.current.actions.addJHA({ id: 'JHA-1', task: 'Hot work', risk: 'high' }))
      result.current.dispatch(result.current.actions.addToolbox({ id: 'TB-1', topic: 'PPE use', attendees: 14 }))
      result.current.dispatch(result.current.actions.addIncident({ id: 'INC-1', type: 'near miss', recordable: false }))
    })
    const store = useBizStore.getState()
    expect(store.biz.jhas).toHaveLength(1)
    expect(store.biz.toolbox_talks).toHaveLength(1)
    expect(store.biz.incidents).toHaveLength(1)
  })
})
