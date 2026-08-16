/**
 * ADR-014 Phase 2A — endpoint-level authorization coverage and transition ratchet.
 *
 * Two invariants:
 *   1. Every reachable endpoint has exactly one classification, derived from
 *      source, with zero unclassified.
 *   2. Every consequential transition is guarded by the capability the registry
 *      declares — so a removed guard, a swapped capability, a duplicated entry
 *      or a brand-new unprotected transition all fail the build.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ENDPOINT_EXCEPTIONS, endpointKey, type RouteClass } from '../authz/routeManifest'
import { ENFORCED_TRANSITIONS, PENDING_TRANSITIONS, RECLASSIFIED_NOT_TRANSITIONS } from '../authz/transitions'
import { isServerCapability } from '../authz/capabilities'

const ROUTES_DIR = path.join(process.cwd(), 'api', 'routes')

interface Endpoint {
  file: string
  router: string
  method: string
  path: string
  key: string
  capability: string | null
  klass: RouteClass
}

/** Parse every route declaration and determine how it is protected. */
function censusEndpoints(): Endpoint[] {
  const out: Endpoint[] = []
  for (const file of fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.ts')).sort()) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8')
    // A router-level guard protects every endpoint in the file.
    const routerWide = /router\s*\.\s*use\s*\(\s*requireCapability\(\s*'([^']+)'/.exec(src)
    const re = /(\w+)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*'([^']*)'\s*,?\s*([\s\S]{0,120})/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const router = m[1]
      const method = m[2].toUpperCase()
      const routePath = m[3]
      const tail = m[4] ?? ''
      const inline = /^\s*requireCapability\(\s*'([^']+)'|,\s*requireCapability\(\s*'([^']+)'/.exec(tail)
      const capability = inline ? (inline[1] ?? inline[2]) : (routerWide ? routerWide[1] : null)
      const key = endpointKey(file, router, method, routePath)
      const exception = ENDPOINT_EXCEPTIONS[key]
      out.push({
        file, router, method, path: routePath, key, capability,
        klass: exception ? exception.klass : capability ? 'CAPABILITY' : 'PENDING_PHASE2',
      })
    }
  }
  return out
}

const endpoints = censusEndpoints()

describe('endpoint-level coverage model', () => {
  // Every class the model may assign. ADR-014 Phase 2C-5 added the three
  // machine/reachability boundaries: SERVICE_TOKEN (SCIM's verified per-tenant
  // bearer credential), HYBRID_SERVICE_CAPABILITY (IoT ingest's two independent
  // trust paths) and UNMOUNTED (declared on a router server.ts never mounts).
  const VALID_CLASSES: RouteClass[] = [
    'CAPABILITY', 'PUBLIC', 'SERVICE_HMAC',
    'SERVICE_TOKEN', 'HYBRID_SERVICE_CAPABILITY', 'UNMOUNTED',
    'PENDING_PHASE2',
  ]

  it('gives every endpoint exactly one classification, with none unclassified', () => {
    const bad = endpoints.filter(e => !VALID_CLASSES.includes(e.klass))
    expect(bad.map(e => e.key)).toEqual([])
    expect(endpoints.length).toBeGreaterThan(0)
  })

  it('holds no duplicate endpoint identities', () => {
    const seen = new Map<string, number>()
    for (const e of endpoints) seen.set(e.key, (seen.get(e.key) ?? 0) + 1)
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
    expect(dupes, `duplicate endpoint identities: ${dupes.join(', ')}`).toEqual([])
  })

  it('holds no stale exception entries', () => {
    const real = new Set(endpoints.map(e => e.key))
    const stale = Object.keys(ENDPOINT_EXCEPTIONS).filter(k => !real.has(k))
    expect(stale, `exceptions naming endpoints that no longer exist: ${stale.join(', ')}`).toEqual([])
  })

  it('requires a substantive reason for every exception', () => {
    for (const [key, ex] of Object.entries(ENDPOINT_EXCEPTIONS)) {
      expect(ex.reason.length, `${key} needs a reason`).toBeGreaterThan(20)
    }
  })

  it('reports a mixed file truthfully, not as one status', () => {
    // Files that contain both guarded and unguarded endpoints must be counted
    // per endpoint — the defect the file-level model could not express.
    const byFile = new Map<string, Endpoint[]>()
    for (const e of endpoints) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e])
    const mixed = [...byFile.entries()].filter(([, es]) =>
      es.some(e => e.klass === 'CAPABILITY') && es.some(e => e.klass === 'PENDING_PHASE2'))
    expect(mixed.length, 'expected at least one mixed file to prove per-endpoint accounting').toBeGreaterThan(0)
    for (const [, es] of mixed) {
      const protectedCount = es.filter(e => e.klass === 'CAPABILITY').length
      const pendingCount   = es.filter(e => e.klass === 'PENDING_PHASE2').length
      expect(protectedCount + pendingCount).toBeLessThanOrEqual(es.length)
      expect(protectedCount).toBeGreaterThan(0)
      expect(pendingCount).toBeGreaterThan(0)
    }
  })

  it('accounts for every endpoint exactly once', () => {
    // Summed over EVERY class, so adding a class without adding it here cannot
    // make the arithmetic appear to balance while endpoints go uncounted.
    const counted = VALID_CLASSES
      .map(k => endpoints.filter(e => e.klass === k).length)
      .reduce((a, b) => a + b, 0)
    expect(counted).toBe(endpoints.length)
  })
})

// ─── Transition ratchet ───────────────────────────────────────────────────────
describe('consequential transition ratchet', () => {
  const byKey = new Map(endpoints.map(e => [e.key, e]))

  it('declares a registered capability for every transition', () => {
    for (const t of ENFORCED_TRANSITIONS) {
      expect(isServerCapability(t.capability), `${t.file} ${t.path}: unknown capability ${t.capability}`).toBe(true)
    }
  })

  it('holds no duplicate transition entries', () => {
    const seen = new Map<string, number>()
    for (const t of ENFORCED_TRANSITIONS) {
      const k = endpointKey(t.file, t.router, t.method, t.path)
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
    expect(dupes, `duplicated transitions: ${dupes.join(', ')}`).toEqual([])
  })

  it('matches every registered transition to a real, guarded endpoint', () => {
    const problems: string[] = []
    for (const t of ENFORCED_TRANSITIONS) {
      const k = endpointKey(t.file, t.router, t.method, t.path)
      const e = byKey.get(k)
      if (!e) { problems.push(`${k}: no such endpoint in source`); continue }
      if (e.klass !== 'CAPABILITY') { problems.push(`${k}: registered as a transition but has no capability guard`); continue }
      // Guard must be the capability the registry declares — a swap is an error.
      if (e.capability !== t.capability) {
        problems.push(`${k}: registry says ${t.capability}, route says ${e.capability}`)
      }
    }
    expect(problems, `transition guard mismatches:\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('leaves no consequential transition unprotected', () => {
    expect(PENDING_TRANSITIONS, 'Phase 2A closes only when this is empty').toEqual([])
  })

  it('detects a new transition-shaped endpoint that is neither registered nor reclassified', () => {
    // The ratchet. Any non-GET endpoint whose path names a consequential verb
    // must be either registered as a transition or explicitly reclassified.
    const VERB = /\/(approve|reject|execute|publish|issue|verify|release|finalize|award|void|revoke|activate|suspend|reactivate|archive|provision|arbitrate|escalate|reassign|freeze|unfreeze|expire|won|lost|no-bid)(\/|$)/i
    const registered = new Set(ENFORCED_TRANSITIONS.map(t => endpointKey(t.file, t.router, t.method, t.path)))
    const reclassified = new Set(RECLASSIFIED_NOT_TRANSITIONS.map(r => `${r.file}${r.path}`))
    const exceptions = new Set(Object.keys(ENDPOINT_EXCEPTIONS))

    const unaccounted = endpoints.filter(e =>
      e.method !== 'GET' &&
      VERB.test(e.path) &&
      !registered.has(e.key) &&
      !reclassified.has(`${e.file}${e.path}`) &&
      !exceptions.has(e.key) &&
      e.klass !== 'CAPABILITY',
    ).map(e => e.key)

    expect(unaccounted,
      `unclassified consequential transitions — register them in api/authz/transitions.ts ` +
      `or record why they are not transitions:\n  ${unaccounted.join('\n  ')}`).toEqual([])
  })
})
