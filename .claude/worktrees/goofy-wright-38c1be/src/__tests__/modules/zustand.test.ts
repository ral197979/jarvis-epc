/**
 * Tests: modules/store/zustand
 * Coverage: useSessionStore, useLogStore, useGatewayStore,
 *           useAuthStore, useObsStore, syncAllStores, selectors
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useSessionStore,
  useLogStore,
  useGatewayStore,
  useAuthStore,
  useObsStore,
  syncAllStores,
  selectErrorRate,
  selectLatencyAlert,
  selectRenderWarning,
  selectRecentLogs,
  selectRecentActivity,
} from '../../modules/store/zustand'
import * as moduleStore from '../../modules/store'

// ─── Reset between tests ──────────────────────────────────────────────────────
beforeEach(() => {
  // Reset Zustand stores to initial states
  useSessionStore.getState().resetMetrics()
  useLogStore.getState().clear()
  useGatewayStore.getState().clearLog()
  useAuthStore.getState().clearToken()
})

// ─── useSessionStore ──────────────────────────────────────────────────────────
describe('useSessionStore', () => {
  it('exposes session metrics object', () => {
    const { metrics } = useSessionStore.getState()
    expect(metrics).toHaveProperty('crudOps')
    expect(metrics).toHaveProperty('errors')
    expect(metrics).toHaveProperty('renderCount')
    expect(metrics).toHaveProperty('apiLatency')
  })

  it('incrementRender increases renderCount', () => {
    useSessionStore.getState().incrementRender()
    useSessionStore.getState().incrementRender()
    const { metrics } = useSessionStore.getState()
    expect(metrics.renderCount).toBe(2)
  })

  it('incrementRender updates lastRender timestamp', () => {
    useSessionStore.getState().incrementRender()
    const { metrics } = useSessionStore.getState()
    expect(metrics.lastRender).not.toBeNull()
    expect(metrics.lastRender).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('resetMetrics zeroes all counters', () => {
    useSessionStore.getState().incrementRender()
    useSessionStore.getState().incrementRender()
    useSessionStore.getState().resetMetrics()
    const { metrics } = useSessionStore.getState()
    expect(metrics.renderCount).toBe(0)
    expect(metrics.errors).toBe(0)
    expect(metrics.crudOps).toEqual({ add: 0, update: 0, delete: 0 })
  })

  it('setLogLevel updates the log level', () => {
    useSessionStore.getState().setLogLevel('DEBUG')
    expect(useSessionStore.getState().logLevel).toBe('DEBUG')

    useSessionStore.getState().setLogLevel('ERROR')
    expect(useSessionStore.getState().logLevel).toBe('ERROR')
  })

  it('snapshot returns a copy of current metrics', () => {
    useSessionStore.getState().incrementRender()
    const snap = useSessionStore.getState().snapshot()
    expect(snap.renderCount).toBe(1)
    // Snapshot is a value copy — modifying store after doesn't change it
    useSessionStore.getState().incrementRender()
    expect(snap.renderCount).toBe(1)
  })
})

// ─── useLogStore ──────────────────────────────────────────────────────────────
describe('useLogStore', () => {
  it('initialises with empty arrays', () => {
    const { structuredLog, activityFeed } = useLogStore.getState()
    expect(structuredLog).toHaveLength(0)
    expect(activityFeed).toHaveLength(0)
  })

  it('refresh syncs with module-level structured log', () => {
    // Directly push to the module-level log
    moduleStore.structuredLog.push({
      ts:       new Date().toISOString(),
      level:    'INFO',
      category: 'test',
      msg:      'hello from module',
      data:     null,
    })
    useLogStore.getState().refresh()
    expect(useLogStore.getState().structuredLog).toHaveLength(1)
    expect(useLogStore.getState().structuredLog[0].msg).toBe('hello from module')
  })

  it('clear empties both log and activity feed', () => {
    moduleStore.structuredLog.push({ ts: '', level: 'INFO', category: 'x', msg: 'y', data: null })
    moduleStore.activityFeed.push({ ts: '', action: 'a', collection: 'b', detail: 'c' })
    useLogStore.getState().refresh()
    expect(useLogStore.getState().structuredLog).toHaveLength(1)

    useLogStore.getState().clear()
    expect(useLogStore.getState().structuredLog).toHaveLength(0)
    expect(useLogStore.getState().activityFeed).toHaveLength(0)
    // Module-level arrays also cleared
    expect(moduleStore.structuredLog).toHaveLength(0)
    expect(moduleStore.activityFeed).toHaveLength(0)
  })
})

// ─── useGatewayStore ─────────────────────────────────────────────────────────
describe('useGatewayStore', () => {
  it('exposes gateway mode', () => {
    const { mode } = useGatewayStore.getState()
    expect(['direct', 'proxied']).toContain(mode)
  })

  it('setMode updates mode and backendBase', () => {
    useGatewayStore.getState().setMode('proxied', 'http://localhost:3001')
    const state = useGatewayStore.getState()
    expect(state.mode).toBe('proxied')
    expect(state.backendBase).toBe('http://localhost:3001')

    // Reset
    useGatewayStore.getState().setMode('direct', '')
  })

  it('clearLog empties the gateway log', () => {
    moduleStore.gatewayLog.push({
      ts: '', method: 'POST', target: 'https://api.anthropic.com',
      payloadSize: 100, mode: 'direct',
    })
    useGatewayStore.getState().refreshLog()
    expect(useGatewayStore.getState().gatewayLog).toHaveLength(1)

    useGatewayStore.getState().clearLog()
    expect(useGatewayStore.getState().gatewayLog).toHaveLength(0)
    expect(moduleStore.gatewayLog).toHaveLength(0)
  })

  it('refreshLog syncs with module-level gateway log', () => {
    moduleStore.gatewayLog.push({
      ts: new Date().toISOString(), method: 'POST',
      target: 'https://api.anthropic.com', payloadSize: 500, mode: 'direct',
      status: 200, latencyMs: 123,
    })
    useGatewayStore.getState().refreshLog()
    expect(useGatewayStore.getState().gatewayLog).toHaveLength(1)
    expect(useGatewayStore.getState().gatewayLog[0].status).toBe(200)
  })
})

// ─── useAuthStore ─────────────────────────────────────────────────────────────
describe('useAuthStore', () => {
  it('isAuthenticated starts false', () => {
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('setToken sets isAuthenticated to true', () => {
    useAuthStore.getState().setToken('tok-abc', new Date(Date.now() + 90000).toISOString())
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().tokenExpiry).toBeGreaterThan(0)
  })

  it('clearToken resets isAuthenticated', () => {
    useAuthStore.getState().setToken('tok-xyz')
    useAuthStore.getState().clearToken()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().tokenExpiry).toBe(0)
  })

  it('setMaintenance toggles maintenance mode', () => {
    useAuthStore.getState().setMaintenance(true)
    expect(useAuthStore.getState().maintenanceMode).toBe(true)
    expect(moduleStore.maintenanceMode).toBe(true)

    useAuthStore.getState().setMaintenance(false)
    expect(useAuthStore.getState().maintenanceMode).toBe(false)
  })
})

// ─── useObsStore ──────────────────────────────────────────────────────────────
describe('useObsStore', () => {
  it('heartbeatLog starts as an array', () => {
    expect(Array.isArray(useObsStore.getState().heartbeatLog)).toBe(true)
  })

  it('runHeartbeat returns a heartbeat entry', () => {
    const biz = { company: { name: 'Test', id: 'C1' } }
    const entry = useObsStore.getState().runHeartbeat(biz)
    expect(entry).toHaveProperty('ts')
    expect(typeof entry.healthy).toBe('boolean')
    expect(entry).toHaveProperty('uptime')
  })

  it('runHeartbeat updates heartbeatLog in store', () => {
    const before = useObsStore.getState().heartbeatLog.length
    useObsStore.getState().runHeartbeat()
    const after = useObsStore.getState().heartbeatLog.length
    expect(after).toBeGreaterThan(before)
  })

  it('checkPerf returns array of violations (or empty)', () => {
    const violations = useObsStore.getState().checkPerf()
    expect(Array.isArray(violations)).toBe(true)
  })

  it('stateStatus is a known value after heartbeat', () => {
    useObsStore.getState().runHeartbeat({ company: { id: 'C1', name: 'Test' } })
    const { stateStatus } = useObsStore.getState()
    expect(['healthy', 'degraded', 'critical', 'unknown']).toContain(stateStatus)
  })
})

// ─── syncAllStores ────────────────────────────────────────────────────────────
describe('syncAllStores', () => {
  it('runs without throwing', () => {
    expect(() => syncAllStores()).not.toThrow()
  })

  it('brings log store in sync after module-level push', () => {
    moduleStore.structuredLog.push({ ts: '', level: 'WARN', category: 'sync', msg: 'test', data: null })
    syncAllStores()
    expect(useLogStore.getState().structuredLog.length).toBeGreaterThan(0)
  })
})

// ─── Selectors ────────────────────────────────────────────────────────────────
describe('selectErrorRate', () => {
  it('returns 0 when there are no operations', () => {
    const state = useSessionStore.getState()
    expect(selectErrorRate(state)).toBe(0)
  })

  it('calculates error rate correctly', () => {
    // Simulate 10 crud ops and 2 errors in module state
    moduleStore.sessionMetrics.crudOps = { add: 5, update: 3, delete: 2 }
    moduleStore.sessionMetrics.errors  = 2
    useSessionStore.getState().resetMetrics()
    // After reset, all zero — test formula only
    const fakeState = {
      metrics: { ...useSessionStore.getState().metrics, crudOps: { add: 5, update: 3, delete: 2 }, errors: 2 },
      logLevel: 'INFO' as const,
      setLogLevel: vi.fn(),
      incrementRender: vi.fn(),
      resetMetrics: vi.fn(),
      snapshot: vi.fn(),
    }
    const rate = selectErrorRate(fakeState)
    expect(rate).toBeCloseTo(2 / 12, 4)
  })
})

describe('selectLatencyAlert', () => {
  it('returns false when avgLatency is below threshold', () => {
    const state = useSessionStore.getState()
    expect(selectLatencyAlert(state)).toBe(false)
  })

  it('returns true when avgLatency exceeds 2000ms', () => {
    const fakeState = {
      ...useSessionStore.getState(),
      metrics: { ...useSessionStore.getState().metrics, avgLatency: 2500 },
    }
    expect(selectLatencyAlert(fakeState)).toBe(true)
  })
})

describe('selectRenderWarning', () => {
  it('returns false when renderCount is low', () => {
    expect(selectRenderWarning(useSessionStore.getState())).toBe(false)
  })

  it('returns true when renderCount exceeds 400', () => {
    const fakeState = {
      ...useSessionStore.getState(),
      metrics: { ...useSessionStore.getState().metrics, renderCount: 450 },
    }
    expect(selectRenderWarning(fakeState)).toBe(true)
  })
})

describe('selectRecentLogs', () => {
  it('returns at most N entries', () => {
    for (let i = 0; i < 10; i++) {
      moduleStore.structuredLog.push({ ts: '', level: 'INFO', category: 'x', msg: `msg${i}`, data: null })
    }
    useLogStore.getState().refresh()
    const selector = selectRecentLogs(3)
    const result   = selector(useLogStore.getState())
    expect(result.length).toBeLessThanOrEqual(3)
  })
})

describe('selectRecentActivity', () => {
  it('returns at most N activity entries', () => {
    for (let i = 0; i < 8; i++) {
      moduleStore.activityFeed.push({ ts: '', action: 'test', collection: 'x', detail: `d${i}` })
    }
    useLogStore.getState().refresh()
    const selector = selectRecentActivity(5)
    const result   = selector(useLogStore.getState())
    expect(result.length).toBeLessThanOrEqual(5)
  })
})

// ─── Track E: useObsStore checkPerf branch (line 201 — violations ?? []) ──────
// (useObsStore already imported at top)

describe('useObsStore — checkPerf branch coverage', () => {
  it('checkPerf returns array when biz is provided', () => {
    const biz = { projects: [{ id: 'P-1' }] }
    const result = useObsStore.getState().checkPerf(biz as never)
    expect(Array.isArray(result)).toBe(true)
  })

  it('checkPerf returns array with no arguments (undefined biz)', () => {
    const result = useObsStore.getState().checkPerf(undefined)
    expect(Array.isArray(result)).toBe(true)
  })

  it('checkPerf stores violations in perfViolations state', () => {
    const biz = { projects: [{ id: 'P-1' }] }
    useObsStore.getState().checkPerf(biz as never)
    const stored = useObsStore.getState().perfViolations
    expect(Array.isArray(stored)).toBe(true)
  })

  it('checkPerf with large biz may produce violations', () => {
    const biz = {
      projects:  Array.from({ length: 1500 }, (_, i) => ({ id: `P-${i}` })),
      leads:     Array.from({ length: 600 },  (_, i) => ({ id: `L-${i}` })),
    }
    const result = useObsStore.getState().checkPerf(biz as never)
    expect(Array.isArray(result)).toBe(true)
  })

  it('refresh() updates heartbeatLog without throwing', () => {
    expect(() => useObsStore.getState().refresh()).not.toThrow()
  })
})
