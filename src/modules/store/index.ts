/**
 * JARVIS EPC — Shared State Store
 * ─────────────────────────────────
 * Central repository for all shared mutable state.
 * Module-level singleton — no framework dependency.
 *
 * TODO: Complete Zustand migration — zustand.ts slices exist, JarvisCore.jsx still reads singleton directly.
 */

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CrudOpCounts {
  add:    number
  update: number
  delete: number
}

export interface SessionMetrics {
  startedAt:       string
  crudOps:         CrudOpCounts
  errors:          number
  gatewayErrors:   number
  viewChanges:     number
  lastMutation:    string | null
  apiLatency:      number[]
  avgLatency:      number
  maxLatency:      number
  stateSnapshots:  unknown[]
  renderCount:     number
  lastRender:      string | null
  persistOps:      number
  persistErrors:   number
}

export interface StructuredLogEntry {
  ts:       string
  level:    LogLevel
  category: string
  msg:      string
  data:     unknown
}

export interface ActivityEntry {
  ts:         string
  action:     string
  collection: string
  detail:     string
}

export interface HeartbeatEntry {
  ts:          string
  healthy:     boolean
  stateHealth: string
  perfBudget:  string
  renderCount: number
  errors:      number
  uptime:      number
}

export interface GatewayLogEntry {
  ts:          string
  method:      string
  target:      string
  payloadSize: number
  mode:        GatewayMode
  url?:        string
  latencyMs?:  number
  status?:     number
  /** Phase 11: retry telemetry */
  attempt?:    number
  errorMsg?:   string
}

export type LogLevel    = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
export type GatewayMode = 'direct' | 'proxied'

// ─── Log level constants ──────────────────────────────────────────────────────
export const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3,
}

// ─── Auth State ───────────────────────────────────────────────────────────────
export let authToken: string | null = null
export let authTokenExpiry: number  = 0

export function setAuthToken(token: string, expiresAt?: string): void {
  authToken        = token
  authTokenExpiry  = expiresAt
    ? new Date(expiresAt).getTime()
    : Date.now() + 6 * 3_600_000
}

export function clearAuthToken(): void {
  authToken       = null
  authTokenExpiry = 0
}

// ─── Gateway State ────────────────────────────────────────────────────────────
export const gatewayLog: GatewayLogEntry[] = []
export const GATEWAY_LOG_MAX = 100

// ─── Session Metrics ──────────────────────────────────────────────────────────
export const sessionMetrics: SessionMetrics = {
  startedAt:       new Date().toISOString(),
  crudOps:         { add: 0, update: 0, delete: 0 },
  errors:          0,
  gatewayErrors:   0,
  viewChanges:     0,
  lastMutation:    null,
  apiLatency:      [],
  avgLatency:      0,
  maxLatency:      0,
  stateSnapshots:  [],
  renderCount:     0,
  lastRender:      null,
  persistOps:      0,
  persistErrors:   0,
}

// ─── Structured Log ───────────────────────────────────────────────────────────
export const structuredLog: StructuredLogEntry[] = []
export const SLOG_MAX = 200
export let logLevel: number = LOG_LEVELS.INFO

export function setLogLevel(level: number): void { logLevel = level }

// ─── Activity Feed ────────────────────────────────────────────────────────────
export const activityFeed: ActivityEntry[] = []
export const ACTIVITY_MAX = 50

// ─── Collection Freshness ─────────────────────────────────────────────────────
export const collectionFreshness: Record<string, number> = {}

// ─── Heartbeat Log ────────────────────────────────────────────────────────────
export const heartbeatLog: HeartbeatEntry[] = []
export const HEARTBEAT_INTERVAL = 120_000

// ─── Error Log ────────────────────────────────────────────────────────────────
export const errorLog: Array<{
  ts: string; source: string; message: string; stack: string; extra: unknown
}> = []
export const ERROR_LOG_MAX = 50

// ─── Mutation Rate Limiter ────────────────────────────────────────────────────
export const mutationWindow: number[] = []

// ─── Maintenance & Control ────────────────────────────────────────────────────
export let maintenanceMode = false

export function setMaintenanceMode(enabled: boolean): void {
  maintenanceMode = enabled
}

// ─── Toast Queue ──────────────────────────────────────────────────────────────
export interface ToastItem { id: number; msg: string; type: string; ts: number }
export type ToastListener = (queue: ToastItem[]) => void

export let toastQueue: ToastItem[]      = []
export const toastListeners: ToastListener[] = []

// ─── Undo Stack ───────────────────────────────────────────────────────────────
export interface UndoEntry {
  collection: string
  op:         'add' | 'update' | 'delete'
  snapshot:   unknown
  ts:         number
}

export const undoStack: UndoEntry[] = []
export const UNDO_MAX = 20

// ─── Gateway Config ───────────────────────────────────────────────────────────
export let gatewayMode: GatewayMode = 'direct'
export const GATEWAY_PROXY_URL      = '/api/v1/gateway'
export let backendBase              = ''

export function setGatewayMode(mode: GatewayMode): void { gatewayMode = mode }
export function setBackendBase(url: string): void        { backendBase = url }

// ─── CSRF Token ───────────────────────────────────────────────────────────────
export const csrfToken: string = (() => {
  const arr = new Uint8Array(24)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < 24; i++) arr[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
})()

// ─── Session Timeout ──────────────────────────────────────────────────────────
export let lastActivity: number        = Date.now()
export const SESSION_TIMEOUT_MS        = 30 * 60 * 1_000
export const TOKEN_ROTATION_MS         = 5  * 60 * 1_000

export function touchActivity(): void { lastActivity = Date.now() }
