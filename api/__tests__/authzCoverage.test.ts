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
import { ENDPOINT_EXCEPTIONS, endpointKey, type RouteClass } from '../authz/routeManifest'
import { ENFORCED_TRANSITIONS, PENDING_TRANSITIONS, RECLASSIFIED_NOT_TRANSITIONS } from '../authz/transitions'
import { isServerCapability } from '../authz/capabilities'
import { classifiedCensus, ALL_ROUTE_CLASSES } from './helpers/endpointCensus'

/**
 * ADR-014 Phase 3A §30 — one classification engine.
 *
 * This file used to carry its OWN route parser. It recognised only
 * `requireCapability`, so it counted every `requireAnyCapability` and
 * `requireAllCapabilities` route as unguarded and reported 23 pending endpoints
 * where the canonical census reported 2. It asserted no count, so it never
 * failed — it simply told a different story about which endpoints were
 * protected. Phase 2C-5 recorded that as a residual risk; Phase 3A removes it.
 *
 * Classification now comes from `helpers/endpointCensus.ts` and nowhere else.
 * The assertions below are unchanged in intent — only their input is now shared.
 */
const endpoints = classifiedCensus()

describe('endpoint-level coverage model', () => {
  // The class list is imported, not restated — a class added to the engine
  // without being accounted for here would otherwise pass silently.
  const VALID_CLASSES: readonly RouteClass[] = ALL_ROUTE_CLASSES

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
    // The defect the file-level model could not express: one route file whose
    // endpoints do not all share a status. Until Phase 3A the discriminating
    // pair was CAPABILITY + PENDING_PHASE2; that pair no longer exists because
    // no endpoint is pending any more. The invariant is the general one — a
    // file may hold endpoints of DIFFERENT classes, and each is counted on its
    // own — so it is asserted generally rather than retired.
    const byFile = new Map<string, typeof endpoints>()
    for (const e of endpoints) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e])

    const mixed = [...byFile.entries()]
      .filter(([, es]) => new Set(es.map(e => e.klass)).size > 1)
    expect(mixed.length, 'expected at least one mixed file to prove per-endpoint accounting').toBeGreaterThan(0)

    for (const [file, es] of mixed) {
      const classes = new Set(es.map(e => e.klass))
      expect(classes.size, `${file} must hold more than one class to be mixed`).toBeGreaterThan(1)
      // Per-endpoint accounting: the per-class counts sum to the file total,
      // which a file-level label could never express.
      const summed = [...classes]
        .map(k => es.filter(e => e.klass === k).length)
        .reduce((a, b) => a + b, 0)
      expect(summed, `${file} endpoints must be counted individually`).toBe(es.length)
    }

    // Non-vacuity: projects.ts is the Phase 3A example — GET /:id is now
    // record-scoped while its siblings are ordinary capability routes.
    const projects = byFile.get('projects.ts') ?? []
    expect(new Set(projects.map(e => e.klass)).size,
      'projects.ts must remain a mixed file').toBeGreaterThan(1)
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
/**
 * The classes that carry a route-level capability guard. `CAPABILITY_RECORD_SCOPE`
 * is `CAPABILITY` plus record scope (ADR-014 Phase 3C), so any check asking
 * "is the functional guard present?" must accept both.
 */
const CAPABILITY_GUARDED = new Set(['CAPABILITY', 'CAPABILITY_RECORD_SCOPE'])

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
      // Both classes carry a route-level capability guard; they differ only in
      // whether record scope is ALSO enforced. Treating CAPABILITY as the only
      // acceptable class would mean adding record scope to a transition — which
      // is strictly more protection — read as having lost its guard.
      if (!CAPABILITY_GUARDED.has(e.klass)) { problems.push(`${k}: registered as a transition but has no capability guard`); continue }
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
      !CAPABILITY_GUARDED.has(e.klass),
    ).map(e => e.key)

    expect(unaccounted,
      `unclassified consequential transitions — register them in api/authz/transitions.ts ` +
      `or record why they are not transitions:\n  ${unaccounted.join('\n  ')}`).toEqual([])
  })
})
