/**
 * JARVIS EPC — Zustand Reactive Store
 * ──────────────────────────────────────
 * Phase 5: React-observable state management for the extracted modules.
 * Bridges the module-level singleton state (src/modules/store/index.ts)
 * with React's reactive rendering model.
 *
 * Architecture:
 *   - Module state (store/index.ts)  — source of truth, no React dependency
 *   - Zustand slices (this file)     — subscribe to module state, expose to React
 *   - JarvisCore.jsx                 — reads from Zustand via hooks (Phase 6 migration)
 *
 * Slices:
 *   useSessionStore    — session metrics, render count, error count
 *   useLogStore        — structured log + activity feed
 *   useGatewayStore    — gateway mode, gateway log
 *   useAuthStore       — token state, maintenance mode
 *   useObsStore        — heartbeat, perf budget alerts
 *
 * Phase 6: Replace bizReduce dispatch in JarvisCore with Zustand mutations.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type {
  SessionMetrics,
  StructuredLogEntry,
  ActivityEntry,
  HeartbeatEntry,
  GatewayLogEntry,
  GatewayMode,
  LogLevel,
} from '../store'
import * as store from '../store'
import { checkPerfBudgets, heartbeat as observabilityHeartbeat, type PerfViolation } from '../observability'

// ─── Session Slice ─────────────────────────────────────────────────────────────
interface SessionState {
  metrics:      SessionMetrics
  logLevel:     LogLevel
  setLogLevel:  (level: LogLevel) => void
  incrementRender: () => void
  resetMetrics: () => void
  snapshot:     () => SessionMetrics
}

export const useSessionStore = create<SessionState>()(
  subscribeWithSelector((set, get) => ({
    metrics:  { ...store.sessionMetrics },
    logLevel: 'INFO' as LogLevel,

    setLogLevel: (level) => {
      store.setLogLevel(store.LOG_LEVELS[level])
      set({ logLevel: level })
    },

    incrementRender: () => {
      store.sessionMetrics.renderCount++
      store.sessionMetrics.lastRender = new Date().toISOString()
      set({ metrics: { ...store.sessionMetrics } })
    },

    resetMetrics: () => {
      const now = new Date().toISOString()
      store.sessionMetrics.crudOps     = { add: 0, update: 0, delete: 0 }
      store.sessionMetrics.errors      = 0
      store.sessionMetrics.gatewayErrors = 0
      store.sessionMetrics.viewChanges = 0
      store.sessionMetrics.renderCount = 0
      store.sessionMetrics.apiLatency  = []
      store.sessionMetrics.avgLatency  = 0
      store.sessionMetrics.maxLatency  = 0
      store.sessionMetrics.startedAt   = now
      set({ metrics: { ...store.sessionMetrics } })
    },

    snapshot: () => get().metrics,
  }))
)

// ─── Log Slice ─────────────────────────────────────────────────────────────────
interface LogState {
  structuredLog: StructuredLogEntry[]
  activityFeed:  ActivityEntry[]
  refresh:       () => void
  clear:         () => void
}

export const useLogStore = create<LogState>()(
  subscribeWithSelector((set) => ({
    structuredLog: [...store.structuredLog],
    activityFeed:  [...store.activityFeed],

    refresh: () => set({
      structuredLog: [...store.structuredLog],
      activityFeed:  [...store.activityFeed],
    }),

    clear: () => {
      store.structuredLog.length = 0
      store.activityFeed.length  = 0
      set({ structuredLog: [], activityFeed: [] })
    },
  }))
)

// ─── Gateway Slice ─────────────────────────────────────────────────────────────
interface GatewayState {
  mode:          GatewayMode
  backendBase:   string
  gatewayLog:    GatewayLogEntry[]
  setMode:       (mode: GatewayMode, backendUrl?: string) => void
  refreshLog:    () => void
  clearLog:      () => void
}

export const useGatewayStore = create<GatewayState>()(
  subscribeWithSelector((set) => ({
    mode:        store.gatewayMode   as GatewayMode,
    backendBase: store.backendBase   as string,
    gatewayLog:  [...store.gatewayLog],

    setMode: (mode, backendUrl = '') => {
      store.setGatewayMode(mode)
      store.setBackendBase(backendUrl)
      set({ mode, backendBase: backendUrl })
    },

    refreshLog: () => set({ gatewayLog: [...store.gatewayLog] }),

    clearLog: () => {
      store.gatewayLog.length = 0
      set({ gatewayLog: [] })
    },
  }))
)

// ─── Auth Slice ────────────────────────────────────────────────────────────────
interface AuthState {
  isAuthenticated:  boolean
  maintenanceMode:  boolean
  tokenExpiry:      number
  setToken:         (token: string, expiresAt?: string) => void
  clearToken:       () => void
  setMaintenance:   (enabled: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  subscribeWithSelector((set) => ({
    isAuthenticated: store.authToken !== null,
    maintenanceMode: store.maintenanceMode,
    tokenExpiry:     store.authTokenExpiry,

    setToken: (token, expiresAt) => {
      store.setAuthToken(token, expiresAt)
      set({
        isAuthenticated: true,
        tokenExpiry:     store.authTokenExpiry,
      })
    },

    clearToken: () => {
      store.clearAuthToken()
      set({ isAuthenticated: false, tokenExpiry: 0 })
    },

    setMaintenance: (enabled) => {
      store.setMaintenanceMode(enabled)
      set({ maintenanceMode: enabled })
    },
  }))
)

// ─── Observability Slice ────────────────────────────────────────────────────────
interface ObsState {
  heartbeatLog:   HeartbeatEntry[]
  perfViolations: PerfViolation[]
  stateStatus:    'healthy' | 'degraded' | 'critical' | 'unknown'
  runHeartbeat:   (biz?: Record<string, unknown>) => HeartbeatEntry
  checkPerf:      (biz?: Record<string, unknown>) => PerfViolation[]
  refresh:        () => void
}

export const useObsStore = create<ObsState>()(
  subscribeWithSelector((set, get) => ({
    heartbeatLog:   [...store.heartbeatLog],
    perfViolations: [],
    stateStatus:    'unknown',

    runHeartbeat: (biz) => {
      const entry = observabilityHeartbeat(biz)
      set({
        heartbeatLog: [...store.heartbeatLog],
        stateStatus:  entry.stateHealth as ObsState['stateStatus'],
      })
      return entry
    },

    checkPerf: (biz) => {
      const result    = checkPerfBudgets(biz)
      const violations = result.violations ?? []
      set({ perfViolations: violations })
      return violations
    },

    refresh: () => {
      set({
        heartbeatLog: [...store.heartbeatLog],
      })
    },
  }))
)

// ─── Store sync utility ────────────────────────────────────────────────────────
/**
 * syncAllStores — call after bulk module state changes to bring
 * all Zustand slices back in sync with the module singletons.
 *
 * Used after:
 *  - Large data imports
 *  - Emergency state reset
 *  - Test setup / teardown
 */
export function syncAllStores(): void {
  useSessionStore.getState().resetMetrics()
  useLogStore.getState().refresh()
  useGatewayStore.getState().refreshLog()
  useObsStore.getState().refresh()
}

// ─── Selectors (memoized) ──────────────────────────────────────────────────────
/** Current error rate: errors / (errors + successful crud ops) */
export function selectErrorRate(s: SessionState): number {
  const total = s.metrics.crudOps.add + s.metrics.crudOps.update + s.metrics.crudOps.delete
  return total === 0 ? 0 : s.metrics.errors / (total + s.metrics.errors)
}

/** True if average API latency exceeds 2 seconds */
export function selectLatencyAlert(s: SessionState): boolean {
  return s.metrics.avgLatency > 2000
}

/** True if render count is in the warning zone */
export function selectRenderWarning(s: SessionState): boolean {
  return s.metrics.renderCount > 400
}

/** Most recent N structured log entries */
export function selectRecentLogs(n: number) {
  return (s: LogState): StructuredLogEntry[] => s.structuredLog.slice(0, n)
}

/** Activity feed limited to N entries */
export function selectRecentActivity(n: number) {
  return (s: LogState): ActivityEntry[] => s.activityFeed.slice(0, n)
}
