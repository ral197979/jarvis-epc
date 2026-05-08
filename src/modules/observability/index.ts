/**
 * Denver Engineering — Observability Module
 * ───────────────────────────────────
 * Structured logging, activity tracking, health heartbeat,
 * performance budgets, data retention, and security utilities.
 *
 * Dependencies: store
 * Status: Server-side log drain live (api/server.ts LOG_DRAIN_URL). Client slog() drain is a future TODO.
 */

import {
  sessionMetrics,
  structuredLog, SLOG_MAX, LOG_LEVELS, logLevel,
  activityFeed, ACTIVITY_MAX,
  collectionFreshness,
  heartbeatLog,
  mutationWindow,
  type LogLevel,
  type StructuredLogEntry,
  type ActivityEntry,
  type HeartbeatEntry,
} from '../store/index.js'

// ─── Structured Logging ───────────────────────────────────────────────────────
export function slog(level: LogLevel, category: string, msg: string, data?: unknown): void {
  if (LOG_LEVELS[level] === undefined || LOG_LEVELS[level] < logLevel) return

  const entry: StructuredLogEntry = {
    ts:       new Date().toISOString(),
    level,
    category,
    msg,
    data:     data ?? null,
  }

  structuredLog.push(entry)
  if (structuredLog.length > SLOG_MAX) {
    structuredLog.splice(0, structuredLog.length - SLOG_MAX)
  }

  if (level === 'ERROR') sessionMetrics.errors++

  const fn = level === 'ERROR' ? console.error
           : level === 'WARN'  ? console.warn
           : console.info
  fn(`[JARVIS:${category}] ${msg}`)
}

/** Legacy alias */
export const _slog = slog

// ─── Error Log ────────────────────────────────────────────────────────────────
interface ErrorEntry {
  ts:      string
  source:  string
  message: string
  stack:   string
  extra:   unknown
}

const _errorLog: ErrorEntry[] = []
const ERROR_LOG_MAX = 50

export function logError(source: string, error: unknown, extra?: unknown): void {
  const err = error as Error | null
  const entry: ErrorEntry = {
    ts:      new Date().toISOString(),
    source,
    message: String(err?.message ?? error),
    stack:   (err?.stack ?? '').split('\n').slice(0, 3).join(' | '),
    extra:   extra ?? null,
  }
  _errorLog.push(entry)
  if (_errorLog.length > ERROR_LOG_MAX) _errorLog.shift()
  console.warn('[JARVIS:ErrorLog]', entry.source, entry.message)
}

export function getErrorLog(): ErrorEntry[] { return _errorLog.slice() }

/** Legacy alias */
export const _logError = logError

// ─── Collection Freshness ─────────────────────────────────────────────────────
export interface FreshnessResult {
  status: 'fresh' | 'recent' | 'aging' | 'stale' | 'unknown'
  ageMs:  number
  label:  string
}

export function trackFreshness(collection: string): void {
  collectionFreshness[collection] = Date.now()
}

export function getFreshness(collection: string): FreshnessResult {
  const ts = collectionFreshness[collection]
  if (!ts) return { status: 'unknown', ageMs: 0, label: 'No data' }
  const age   = Date.now() - ts
  const hours = Math.floor(age / 3_600_000)
  const status = age < 3_600_000    ? 'fresh'
               : age < 86_400_000   ? 'recent'
               : age < 604_800_000  ? 'aging'
               : 'stale'
  const label  = hours < 1  ? '< 1h ago'
               : hours < 24 ? `${hours}h ago`
               : `${Math.floor(hours / 24)}d ago`
  return { status, ageMs: age, label }
}

// ─── Activity Feed ────────────────────────────────────────────────────────────
export function logActivity(action: string, collection: string, detail?: string): void {
  const entry: ActivityEntry = {
    ts:         new Date().toISOString(),
    action,
    collection,
    detail:     detail ?? '',
  }
  activityFeed.unshift(entry)
  if (activityFeed.length > ACTIVITY_MAX) activityFeed.pop()
}

// ─── Performance Budgets ─────────────────────────────────────────────────────
export interface PerfBudgets {
  maxRenderCount:     number
  maxAvgLatency:      number
  maxErrorRate:       number
  maxStateSize:       number
  maxCollections:     number
  maxMutationsPerMin: number
}

export interface PerfViolation {
  metric: string
  value:  number | string
  budget: number | string
}

export interface PerfBudgetResult {
  ok:         boolean
  violations: PerfViolation[]
  checkedAt:  string
}

export const PERF_BUDGETS: PerfBudgets = {
  maxRenderCount:     500,
  maxAvgLatency:      2_000,
  maxErrorRate:       10,
  maxStateSize:       5_120,
  maxCollections:     50,
  maxMutationsPerMin: 100,
}

export function checkPerfBudgets(biz?: unknown): PerfBudgetResult {
  const violations: PerfViolation[] = []
  const now = Date.now()

  if (sessionMetrics.renderCount > PERF_BUDGETS.maxRenderCount)
    violations.push({ metric: 'renderCount', value: sessionMetrics.renderCount, budget: PERF_BUDGETS.maxRenderCount })

  if (sessionMetrics.avgLatency > PERF_BUDGETS.maxAvgLatency)
    violations.push({ metric: 'avgLatency', value: sessionMetrics.avgLatency, budget: PERF_BUDGETS.maxAvgLatency })

  if (sessionMetrics.errors > PERF_BUDGETS.maxErrorRate)
    violations.push({ metric: 'errors', value: sessionMetrics.errors, budget: PERF_BUDGETS.maxErrorRate })

  const sizeKB = biz ? Math.round(JSON.stringify(biz).length / 1024) : 0
  if (sizeKB > PERF_BUDGETS.maxStateSize)
    violations.push({ metric: 'stateSize', value: `${sizeKB}KB`, budget: `${PERF_BUDGETS.maxStateSize}KB` })

  const mutsPerMin = mutationWindow.filter(t => now - t < 60_000).length
  if (mutsPerMin > PERF_BUDGETS.maxMutationsPerMin)
    violations.push({ metric: 'mutationsPerMin', value: mutsPerMin, budget: PERF_BUDGETS.maxMutationsPerMin })

  return { ok: violations.length === 0, violations, checkedAt: new Date().toISOString() }
}

// ─── State Health ─────────────────────────────────────────────────────────────
export interface StateHealthResult {
  status:          'healthy' | 'warnings' | 'unknown'
  collections:     number
  records:         number
  sizeKB:          number
  orphanedRefs:    string[]
  integrityIssues: string[]
  timestamp:       string
}

export function stateHealth(biz: Record<string, unknown> | null | undefined): StateHealthResult {
  if (!biz) return { status: 'unknown', collections: 0, records: 0, sizeKB: 0, orphanedRefs: [], integrityIssues: [], timestamp: new Date().toISOString() }

  let collections = 0, records = 0
  const orphans: string[] = [], integrity: string[] = []
  const projectNames = ((biz.projects ?? []) as Array<{ name?: string; project?: string }>)
    .map(p => p.name ?? p.project ?? '')

  for (const key in biz) {
    const col = biz[key]
    if (Array.isArray(col) && col.length > 0 && typeof col[0] === 'object') {
      collections++
      records += col.length

      const noId = col.filter((r: Record<string, unknown>) => !r.id && !r.month).length
      if (noId > 0) integrity.push(`${key}: ${noId} records missing ID`)

      if (!['projects', 'company', 'evm_projects', 'activity_log'].includes(key)) {
        col.forEach((r: Record<string, unknown>) => {
          if (r.project && !projectNames.includes(r.project as string)) {
            orphans.push(`${key}:${r.id ?? '?'} → ${r.project}`)
          }
        })
      }
    }
  }

  const sizeKB = Math.round(JSON.stringify(biz).length / 1024)
  return {
    status:          integrity.length === 0 ? 'healthy' : 'warnings',
    collections, records, sizeKB,
    orphanedRefs:    orphans.slice(0, 10),
    integrityIssues: integrity,
    timestamp:       new Date().toISOString(),
  }
}

// ─── Health Heartbeat ─────────────────────────────────────────────────────────
export function heartbeat(biz?: Record<string, unknown>): HeartbeatEntry {
  const health = stateHealth(biz ?? null)
  const perf   = checkPerfBudgets(biz)
  const entry: HeartbeatEntry = {
    ts:          new Date().toISOString(),
    healthy:     health.status === 'healthy' && perf.ok,
    stateHealth: health.status,
    perfBudget:  perf.ok ? 'ok' : `${perf.violations.length} violations`,
    renderCount: sessionMetrics.renderCount,
    errors:      sessionMetrics.errors,
    uptime:      Math.round((Date.now() - new Date(sessionMetrics.startedAt).getTime()) / 1000),
  }
  heartbeatLog.push(entry)
  if (heartbeatLog.length > 30) heartbeatLog.shift()
  if (!entry.healthy) slog('WARN', 'heartbeat', `Unhealthy: ${health.status}, perf: ${entry.perfBudget}`)
  return entry
}

// ─── Data Retention ───────────────────────────────────────────────────────────
export const RETENTION_POLICIES = {
  audit_log:   { maxAge: 90, unit: 'days' },
  error_log:   { maxAge: 30, unit: 'days' },
  gateway_log: { maxAge: 7,  unit: 'days' },
} as const

export interface AuditEntry { ts: string; [key: string]: unknown }

export function enforceRetention(auditLog: AuditEntry[] = []): { purged: number; checkedAt: string } {
  const now    = Date.now()
  const cutoff = now - (RETENTION_POLICIES.audit_log.maxAge * 86_400_000)
  const purged = auditLog.filter(entry => new Date(entry.ts).getTime() < cutoff).length
  slog('INFO', 'retention', `Retention check: ${purged} entries eligible for purge`)
  return { purged, checkedAt: new Date().toISOString() }
}

// ─── Security Utilities ───────────────────────────────────────────────────────
export function safeDisplay(text: unknown): unknown {
  if (typeof text !== 'string') return text
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function secureId(prefix = ''): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint8Array(8)
    crypto.getRandomValues(buf)
    return prefix + Array.from(buf, b => b.toString(36)).join('').slice(0, 12)
  }
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export const SENSITIVE_FIELDS = [
  'email', 'phone', 'ssn', 'password', 'pin', 'pinHash',
  'token', 'secret', 'api_key', 'apiKey', 'credit_card', 'bank_account',
] as const

export type SensitiveField = typeof SENSITIVE_FIELDS[number]

export function redactSensitive<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(redactSensitive) as unknown as T
  const clean: Record<string, unknown> = {}
  for (const k in obj as Record<string, unknown>) {
    if ((SENSITIVE_FIELDS as readonly string[]).includes(k)) {
      clean[k] = '[REDACTED]'
    } else if (typeof (obj as Record<string, unknown>)[k] === 'object') {
      clean[k] = redactSensitive((obj as Record<string, unknown>)[k])
    } else {
      clean[k] = (obj as Record<string, unknown>)[k]
    }
  }
  return clean as T
}

// ─── Diagnostics Export ───────────────────────────────────────────────────────
export function exportDiagnostics(
  biz: Record<string, unknown>,
  gatewayLogRef: unknown[] = [],
): ReturnType<typeof redactSensitive> {
  const health = stateHealth(biz)
  const bundle = redactSensitive({
    version:     'Denver Engineering v4.3',
    exportedAt:  new Date().toISOString(),
    session:     sessionMetrics,
    errors:      _errorLog,
    gateway:     gatewayLogRef.slice(-20),
    stateHealth: health,
    environment: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
      screenSize: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown',
    },
  })

  if (typeof document !== 'undefined') {
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = `JARVIS_diagnostics_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return bundle
}

// ─── Legacy aliases ───────────────────────────────────────────────────────────
export const _safeDiplay = safeDisplay
export const _secureId   = secureId
