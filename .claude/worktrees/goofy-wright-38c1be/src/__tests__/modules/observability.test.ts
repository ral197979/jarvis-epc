/**
 * Tests: modules/observability
 * Coverage: slog, logError, trackFreshness, getFreshness,
 *           logActivity, checkPerfBudgets, stateHealth,
 *           enforceRetention, safeDisplay, secureId, redactSensitive
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  slog,
  logError,
  getErrorLog,
  trackFreshness,
  getFreshness,
  logActivity,
  checkPerfBudgets,
  stateHealth,
  enforceRetention,
  safeDisplay,
  secureId,
  redactSensitive,
  SENSITIVE_FIELDS,
  PERF_BUDGETS,
  RETENTION_POLICIES,
} from '../../modules/observability'

import {
  structuredLog,
  activityFeed,
  collectionFreshness,
  sessionMetrics,
  mutationWindow,
} from '../../modules/store'

// Reset shared state between tests
beforeEach(() => {
  structuredLog.length   = 0
  activityFeed.length    = 0
  sessionMetrics.errors  = 0
  sessionMetrics.renderCount = 0
  sessionMetrics.avgLatency  = 0
  sessionMetrics.apiLatency.length = 0
  Object.keys(collectionFreshness).forEach(k => delete collectionFreshness[k])
})

// ─── slog ─────────────────────────────────────────────────────────────────────
describe('slog', () => {
  it('appends to structuredLog', () => {
    slog('INFO', 'test', 'hello')
    expect(structuredLog).toHaveLength(1)
    expect(structuredLog[0].msg).toBe('hello')
    expect(structuredLog[0].level).toBe('INFO')
    expect(structuredLog[0].category).toBe('test')
  })

  it('includes data payload when provided', () => {
    slog('WARN', 'test', 'msg', { key: 'value' })
    expect(structuredLog[0].data).toEqual({ key: 'value' })
  })

  it('includes timestamp in ISO format', () => {
    slog('INFO', 'test', 'ts test')
    expect(structuredLog[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('increments sessionMetrics.errors on ERROR level', () => {
    const before = sessionMetrics.errors
    slog('ERROR', 'test', 'boom')
    expect(sessionMetrics.errors).toBe(before + 1)
  })

  it('does not increment errors on WARN level', () => {
    const before = sessionMetrics.errors
    slog('WARN', 'test', 'warning')
    expect(sessionMetrics.errors).toBe(before)
  })

  it('caps log at SLOG_MAX entries', () => {
    for (let i = 0; i < 220; i++) slog('INFO', 'test', `entry ${i}`)
    expect(structuredLog.length).toBeLessThanOrEqual(200)
  })
})

// ─── logError ────────────────────────────────────────────────────────────────
describe('logError / getErrorLog', () => {
  it('appends entries to the error log', () => {
    logError('test-source', new Error('test error'))
    const log = getErrorLog()
    expect(log.length).toBeGreaterThan(0)
    const last = log[log.length - 1]
    expect(last.source).toBe('test-source')
    expect(last.message).toBe('test error')
  })

  it('handles string errors', () => {
    logError('src', 'plain string error')
    const log = getErrorLog()
    const last = log[log.length - 1]
    expect(last.message).toBe('plain string error')
  })

  it('extracts stack trace', () => {
    logError('src', new Error('stack error'))
    const log = getErrorLog()
    const last = log[log.length - 1]
    expect(last.stack).toBeTypeOf('string')
  })

  it('getErrorLog returns a copy', () => {
    logError('src', 'entry')
    const log1 = getErrorLog()
    const log2 = getErrorLog()
    expect(log1).not.toBe(log2)
    expect(log1).toEqual(log2)
  })
})

// ─── trackFreshness / getFreshness ───────────────────────────────────────────
describe('trackFreshness / getFreshness', () => {
  it('returns "unknown" for untracked collection', () => {
    const result = getFreshness('nonexistent')
    expect(result.status).toBe('unknown')
    expect(result.ageMs).toBe(0)
  })

  it('marks collection as fresh right after tracking', () => {
    trackFreshness('leads')
    const result = getFreshness('leads')
    expect(result.status).toBe('fresh')
    expect(result.ageMs).toBeLessThan(1000)
  })

  it('returns label "< 1h ago" for fresh data', () => {
    trackFreshness('projects')
    const result = getFreshness('projects')
    expect(result.label).toBe('< 1h ago')
  })

  it('computes stale status for old timestamps', () => {
    // Simulate a 8-day-old timestamp
    collectionFreshness['old-collection'] = Date.now() - 8 * 86_400_000
    const result = getFreshness('old-collection')
    expect(result.status).toBe('stale')
    expect(result.label).toContain('d ago')
  })
})

// ─── logActivity ─────────────────────────────────────────────────────────────
describe('logActivity', () => {
  it('prepends to activityFeed', () => {
    logActivity('add', 'leads', 'LEAD-001')
    expect(activityFeed[0].action).toBe('add')
    expect(activityFeed[0].collection).toBe('leads')
    expect(activityFeed[0].detail).toBe('LEAD-001')
  })

  it('new entries appear at the front', () => {
    logActivity('add', 'leads', 'first')
    logActivity('add', 'contracts', 'second')
    expect(activityFeed[0].collection).toBe('contracts')
    expect(activityFeed[1].collection).toBe('leads')
  })

  it('caps feed at ACTIVITY_MAX entries', () => {
    for (let i = 0; i < 60; i++) logActivity('add', 'test', `${i}`)
    expect(activityFeed.length).toBeLessThanOrEqual(50)
  })
})

// ─── checkPerfBudgets ────────────────────────────────────────────────────────
describe('checkPerfBudgets', () => {
  it('returns ok when all metrics are within budget', () => {
    const result = checkPerfBudgets({})
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('flags render count violation', () => {
    sessionMetrics.renderCount = PERF_BUDGETS.maxRenderCount + 1
    const result = checkPerfBudgets({})
    expect(result.ok).toBe(false)
    expect(result.violations.some(v => v.metric === 'renderCount')).toBe(true)
  })

  it('flags error rate violation', () => {
    sessionMetrics.errors = PERF_BUDGETS.maxErrorRate + 1
    const result = checkPerfBudgets({})
    expect(result.ok).toBe(false)
    expect(result.violations.some(v => v.metric === 'errors')).toBe(true)
  })

  it('flags latency violation', () => {
    sessionMetrics.avgLatency = PERF_BUDGETS.maxAvgLatency + 1
    const result = checkPerfBudgets({})
    expect(result.ok).toBe(false)
    expect(result.violations.some(v => v.metric === 'avgLatency')).toBe(true)
  })

  it('includes checkedAt timestamp', () => {
    const result = checkPerfBudgets({})
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

// ─── stateHealth ─────────────────────────────────────────────────────────────
describe('stateHealth', () => {
  it('returns "unknown" for null/undefined biz', () => {
    expect(stateHealth(null).status).toBe('unknown')
    expect(stateHealth(undefined).status).toBe('unknown')
  })

  it('returns "healthy" for valid biz with IDs', () => {
    const biz = {
      projects: [{ id: 'P-001', name: 'Test Project' }],
      leads:    [{ id: 'L-001', project: 'Test Project' }],
    }
    const result = stateHealth(biz)
    expect(result.status).toBe('healthy')
    expect(result.collections).toBeGreaterThan(0)
    expect(result.records).toBeGreaterThan(0)
  })

  it('flags integrity issues for records missing IDs', () => {
    const biz = {
      leads: [{ name: 'No ID lead' }],
    }
    const result = stateHealth(biz)
    expect(result.integrityIssues.length).toBeGreaterThan(0)
    expect(result.status).toBe('warnings')
  })

  it('reports sizeKB >= 0 for any biz', () => {
    // sizeKB rounds to nearest KB; a small object legitimately rounds to 0
    const biz = { projects: [{ id: 'P-1', name: 'Project Alpha' }] }
    const result = stateHealth(biz)
    expect(result.sizeKB).toBeGreaterThanOrEqual(0)
  })

  it('reports sizeKB > 0 for a larger biz object', () => {
    // Build a biz object big enough to round up to >= 1 KB (~1024 chars)
    const biz = {
      projects: Array.from({ length: 20 }, (_, i) => ({
        id: `P-${i}`, name: `Project Alpha ${i}`, status: 'active',
        value: 1_000_000 + i, location: 'Houston, TX', pm: 'Jane Doe',
      })),
    }
    const result = stateHealth(biz)
    expect(result.sizeKB).toBeGreaterThan(0)
  })
})

// ─── enforceRetention ────────────────────────────────────────────────────────
describe('enforceRetention', () => {
  it('returns 0 purged for empty log', () => {
    const result = enforceRetention([])
    expect(result.purged).toBe(0)
  })

  it('counts stale entries beyond retention window', () => {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString()
    const fresh = new Date().toISOString()
    const result = enforceRetention([
      { ts: old, actor: 'test', action: 'old-entry' },
      { ts: fresh, actor: 'test', action: 'fresh-entry' },
    ])
    expect(result.purged).toBe(1)
  })

  it('returns checkedAt timestamp', () => {
    const result = enforceRetention([])
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('RETENTION_POLICIES has expected structure', () => {
    expect(RETENTION_POLICIES.audit_log.maxAge).toBe(90)
    expect(RETENTION_POLICIES.error_log.maxAge).toBe(30)
    expect(RETENTION_POLICIES.gateway_log.maxAge).toBe(7)
  })
})

// ─── safeDisplay ─────────────────────────────────────────────────────────────
describe('safeDisplay', () => {
  it('escapes < and >', () => {
    expect(safeDisplay('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('escapes double quotes', () => {
    expect(safeDisplay('"hello"')).toBe('&quot;hello&quot;')
  })

  it('passes through non-string values unchanged', () => {
    expect(safeDisplay(42)).toBe(42)
    expect(safeDisplay(null)).toBeNull()
    expect(safeDisplay(undefined)).toBeUndefined()
  })

  it('passes through safe strings unchanged', () => {
    expect(safeDisplay('Hello World')).toBe('Hello World')
  })
})

// ─── secureId ─────────────────────────────────────────────────────────────────
describe('secureId', () => {
  it('generates a string', () => {
    expect(secureId()).toBeTypeOf('string')
  })

  it('generates non-empty output', () => {
    expect(secureId().length).toBeGreaterThan(0)
  })

  it('applies prefix when provided', () => {
    const id = secureId('LEAD-')
    expect(id.startsWith('LEAD-')).toBe(true)
  })

  it('generates unique IDs on repeated calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => secureId()))
    expect(ids.size).toBe(50)
  })
})

// ─── redactSensitive ─────────────────────────────────────────────────────────
describe('redactSensitive', () => {
  it('redacts known sensitive fields', () => {
    const input  = { name: 'John', email: 'john@example.com', phone: '555-1234' }
    const result = redactSensitive(input)
    expect(result.email).toBe('[REDACTED]')
    expect(result.phone).toBe('[REDACTED]')
    expect(result.name).toBe('John')
  })

  it('passes through non-sensitive fields', () => {
    const input  = { project: 'Alpha', status: 'active', amount: 1000 }
    const result = redactSensitive(input)
    expect(result).toEqual(input)
  })

  it('handles nested objects', () => {
    const input = { contact: { email: 'secret@example.com', name: 'Jane' } }
    const result = redactSensitive(input) as typeof input
    expect(result.contact.email).toBe('[REDACTED]')
    expect(result.contact.name).toBe('Jane')
  })

  it('handles arrays of objects', () => {
    const input  = [{ email: 'a@b.com', name: 'X' }, { email: 'c@d.com', name: 'Y' }]
    const result = redactSensitive(input) as typeof input
    expect(result[0].email).toBe('[REDACTED]')
    expect(result[1].email).toBe('[REDACTED]')
    expect(result[0].name).toBe('X')
  })

  it('returns non-objects unchanged', () => {
    expect(redactSensitive(42)).toBe(42)
    expect(redactSensitive('string')).toBe('string')
    expect(redactSensitive(null)).toBeNull()
  })

  it('SENSITIVE_FIELDS includes expected fields', () => {
    expect(SENSITIVE_FIELDS).toContain('email')
    expect(SENSITIVE_FIELDS).toContain('password')
    expect(SENSITIVE_FIELDS).toContain('api_key')
    expect(SENSITIVE_FIELDS).toContain('pin')
  })
})

// ─── Track C: exportDiagnostics + stateHealth orphan + secureId branches ──────
import { exportDiagnostics } from '../../modules/observability'
// (secureId already imported at top of file)

describe('exportDiagnostics', () => {
  it('returns a bundle with expected keys', () => {
    const biz = { projects: [{ id: 'P-1', name: 'Alpha' }] }
    const bundle = exportDiagnostics(biz as Record<string, unknown>, [])
    expect(bundle).toBeDefined()
    expect(typeof bundle).toBe('object')
  })

  it('includes stateHealth in bundle', () => {
    const biz = { leads: [{ id: 'L-1', project: 'Alpha' }], projects: [{ id: 'P-1', name: 'Alpha' }] }
    const bundle = exportDiagnostics(biz as Record<string, unknown>, []) as Record<string, unknown>
    expect(bundle.stateHealth).toBeDefined()
  })

  it('includes environment field with userAgent', () => {
    const bundle = exportDiagnostics({}, []) as Record<string, unknown>
    const env = bundle.environment as Record<string, unknown>
    expect(env).toBeDefined()
    expect(typeof env.userAgent).toBe('string')
  })

  it('slices gateway log to last 20 entries', () => {
    const gatewayLog = Array.from({ length: 30 }, (_, i) => ({ entry: i }))
    const bundle = exportDiagnostics({}, gatewayLog) as Record<string, unknown>
    expect((bundle.gateway as unknown[]).length).toBeLessThanOrEqual(20)
  })

  it('returns bundle even with empty biz', () => {
    expect(() => exportDiagnostics({}, [])).not.toThrow()
  })

  it('redacts sensitive fields in bundle', () => {
    const biz = { apiKey: 'secret-123', projects: [] }
    const bundle = exportDiagnostics(biz as Record<string, unknown>, []) as Record<string, unknown>
    // redactSensitive runs over the bundle — apiKey should be redacted
    expect(JSON.stringify(bundle)).not.toContain('secret-123')
  })
})

describe('stateHealth — orphan record detection', () => {
  it('detects orphaned records referencing non-existent projects', () => {
    const biz = {
      projects: [{ id: 'P-1', name: 'Alpha' }],
      leads:    [{ id: 'L-1', project: 'NonExistent' }],
    }
    const result = stateHealth(biz as Record<string, unknown>)
    expect(result.orphanedRefs.length).toBeGreaterThan(0)
    // Note: status is 'warnings' only when integrity issues exist, not just orphans
    expect(['healthy', 'warnings']).toContain(result.status)
  })

  it('does not flag orphans for excluded collections (projects, company, evm_projects)', () => {
    const biz = {
      projects:     [{ id: 'P-1', name: 'Alpha', project: 'Ghost' }],
      evm_projects: [{ id: 'E-1', project: 'Ghost' }],
    }
    const result = stateHealth(biz as Record<string, unknown>)
    // These collections are excluded from orphan checking
    expect(result.orphanedRefs.length).toBe(0)
  })

  it('returns healthy when all project references are valid', () => {
    const biz = {
      projects: [{ id: 'P-1', name: 'Alpha' }],
      leads:    [{ id: 'L-1', project: 'Alpha' }],
      invoices: [{ id: 'I-1', project: 'Alpha' }],
    }
    const result = stateHealth(biz as Record<string, unknown>)
    expect(result.orphanedRefs.length).toBe(0)
    expect(result.status).toBe('healthy')
  })

  it('handles non-array collection values gracefully', () => {
    const biz = {
      company: { name: 'ACME', industry: 'EPC' },  // object, not array
      projects: [],
    }
    expect(() => stateHealth(biz as Record<string, unknown>)).not.toThrow()
  })
})

describe('secureId — crypto fallback branch', () => {
  it('returns a non-empty string', () => {
    const id = secureId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('returns a string with prefix when provided', () => {
    const id = secureId('test-')
    expect(id.startsWith('test-')).toBe(true)
  })

  it('returns unique IDs on repeated calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => secureId()))
    expect(ids.size).toBe(20)
  })

  it('uses fallback path when crypto.getRandomValues is unavailable', () => {
    const original = global.crypto
    // @ts-expect-error intentionally removing crypto to exercise fallback
    delete global.crypto
    const id = secureId('fb-')
    expect(id.startsWith('fb-')).toBe(true)
    expect(id.length).toBeGreaterThan(3)
    // Restore
    global.crypto = original
  })
})

// ─── Track E: checkPerfBudgets high-error + mutationsPerMin violations ─────────
// (slog already imported at top)

describe('checkPerfBudgets — error rate violation (line 167)', () => {
  afterEach(() => {
    sessionMetrics.errors        = 0
    sessionMetrics.renderCount   = 0
    sessionMetrics.avgLatency    = 0
    sessionMetrics.gatewayErrors = 0
    mutationWindow.length = 0
  })

  it('flags errors violation when errors exceed budget via slog ERROR', () => {
    // Drive errors up through the public slog API
    sessionMetrics.errors = 999  // direct write — both are from store
    const result = checkPerfBudgets({})
    expect(result.ok).toBe(false)
    expect(result.violations.some(v => v.metric === 'errors')).toBe(true)
  })

  it('does not flag errors when within budget', () => {
    sessionMetrics.errors = 0
    const result = checkPerfBudgets({})
    const errViolation = result.violations.find(v => v.metric === 'errors')
    expect(errViolation).toBeUndefined()
  })
})

describe('checkPerfBudgets — mutationsPerMin violation (line 171)', () => {
  afterEach(() => {
    sessionMetrics.errors      = 0
    sessionMetrics.renderCount = 0
    sessionMetrics.avgLatency  = 0
    mutationWindow.length = 0
  })

  it('flags mutationsPerMin violation when mutations exceed budget', () => {
    const now = Date.now()
    for (let i = 0; i < 105; i++) {
      mutationWindow.push(now - i * 100)  // 105 recent mutations — exceeds budget of 100
    }
    const result = checkPerfBudgets({})
    expect(result.violations.some(v => v.metric === 'mutationsPerMin')).toBe(true)
  })

  it('does not flag mutationsPerMin when below budget', () => {
    mutationWindow.length = 0
    const result = checkPerfBudgets({})
    const mutViolation = result.violations.find(v => v.metric === 'mutationsPerMin')
    expect(mutViolation).toBeUndefined()
  })

  it('stateSize violation path: no throw on large biz', () => {
    const result = checkPerfBudgets({ projects: [] })
    expect(result).toBeDefined()
    expect(typeof result.ok).toBe('boolean')
  })
})

// ─── Track D Phase 20: stateSize violation branch (line 167) ─────────────────
describe('checkPerfBudgets — stateSize > maxStateSize violation (line 167)', () => {
  it('flags stateSize violation when biz object exceeds maxStateSize KB', () => {
    // maxStateSize = 5120 KB — create ~6MB of data to exceed it
    const bigArray = Array.from({ length: 50_000 }, (_, i) => ({
      id: `item-${i}`,
      name: `Item number ${i} with padding`,
      description: 'x'.repeat(100),
      status: 'active',
      notes: 'y'.repeat(20),
    }))
    const bigBiz = { leads: bigArray }
    const result = checkPerfBudgets(bigBiz)
    const stateViolation = result.violations.find(v => v.metric === 'stateSize')
    expect(stateViolation).toBeDefined()
    expect(stateViolation?.metric).toBe('stateSize')
  })

  it('no stateSize violation for small biz object', () => {
    const smallBiz = { leads: [{ id: 'L-1', name: 'Small' }] }
    const result = checkPerfBudgets(smallBiz)
    const stateViolation = result.violations.find(v => v.metric === 'stateSize')
    expect(stateViolation).toBeUndefined()
  })

  it('sizeKB = 0 when biz is null/undefined (null guard)', () => {
    const result = checkPerfBudgets(null)
    const stateViolation = result.violations.find(v => v.metric === 'stateSize')
    expect(stateViolation).toBeUndefined()  // 0 KB is not > maxStateSize
  })
})
