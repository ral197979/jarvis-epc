/**
 * ADR-014 Phase 2C-1 — project-delivery ordinary mutation ratchet.
 *
 * Phase 2B-2 asked who may read the twelve delivery domains. This asks who may
 * change them, and holds the answer closed:
 *
 *   1. every registered mutation exists in source and carries the write
 *      capability its domain declares — a swap or a removal fails the build;
 *   2. no mutation in a delivery file+router is left authentication-only unless
 *      it is explicitly escalated with a reason;
 *   3. domain assignment is inherited from the Phase 2B-2 read registry, so a
 *      route cannot be quietly moved into a domain whose capability is easier
 *      to obtain;
 *   4. nothing consequential is smuggled in under a `.write` capability.
 *
 * The third point is what stops the metric being gamed. A future edit cannot
 * reduce the pending count by reassigning a procurement route to `field`,
 * because `field` is not what `projectDeliveryReads.ts` says that router is.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { endpointKey } from '../authz/routeManifest'
import { PROJECT_DELIVERY_READS, type DeliveryDomain } from '../authz/projectDeliveryReads'
import {
  PROJECT_DELIVERY_MUTATIONS, ESCALATED_DELIVERY_MUTATIONS,
  DELIVERY_DOMAIN_WRITE_CAPABILITY,
} from '../authz/projectDeliveryMutations'
import { ENFORCED_TRANSITIONS } from '../authz/transitions'
import { STATE_POLICIES } from '../authz/transitionStates'
import { isServerCapability, SERVER_ROLE_CAPS, USER_ROLES, roleHasCapability } from '../authz/capabilities'

const ROUTES_DIR = path.join(process.cwd(), 'api', 'routes')

interface Endpoint {
  file: string; router: string; method: string; path: string
  key: string; capability: string | null
}

/** Same census the coverage ratchet uses, extended to multi-capability guards. */
function census(): Endpoint[] {
  const out: Endpoint[] = []
  const G = String.raw`require(?:Capability|AnyCapability|AllCapabilities)`
  for (const file of fs.readdirSync(ROUTES_DIR).filter(f => f.endsWith('.ts')).sort()) {
    const src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8')
    const routerWide = new RegExp(String.raw`router\s*\.\s*use\s*\(\s*${G}\(\s*'([^']+)'`).exec(src)
    const re = /(\w+)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*'([^']*)'\s*,?\s*([\s\S]{0,120})/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const inline = new RegExp(String.raw`^\s*${G}\(\s*'([^']+)'|,\s*${G}\(\s*'([^']+)'`).exec(m[4] ?? '')
      out.push({
        file, router: m[1], method: m[2].toUpperCase(), path: m[3],
        key: endpointKey(file, m[1], m[2], m[3]),
        capability: inline ? (inline[1] ?? inline[2]) : (routerWide ? routerWide[1] : null),
      })
    }
  }
  return out
}

const endpoints = census()
const byKey = new Map(endpoints.map(e => [e.key, e]))

/** file+router → domain, inherited from the Phase 2B-2 read perimeter. */
const READ_DOMAIN = new Map<string, DeliveryDomain>()
for (const r of PROJECT_DELIVERY_READS) READ_DOMAIN.set(`${r.file} ${r.router}`, r.domain)

const EXCEPTION_KEYS = new Set([
  'commissioningWebhook.ts router.POST /',
  'novaCommands.ts router.POST /commands',
  'novaCommands.ts router.POST /reconcile',
])

// ─── 1. The registry describes reality ───────────────────────────────────────
describe('delivery mutation registry', () => {
  it('maps every delivery domain to a registered write capability', () => {
    for (const [domain, cap] of Object.entries(DELIVERY_DOMAIN_WRITE_CAPABILITY)) {
      expect(isServerCapability(cap), `${domain}: unknown capability ${cap}`).toBe(true)
      expect(cap).toBe(`${domain}.write`)
    }
  })

  it('holds no duplicate entries', () => {
    const seen = new Map<string, number>()
    for (const m of PROJECT_DELIVERY_MUTATIONS) {
      const k = endpointKey(m.file, m.router, m.method, m.path)
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
    expect(dupes, `duplicated: ${dupes.join(', ')}`).toEqual([])
  })

  it('matches every registered mutation to a real, guarded endpoint', () => {
    const problems: string[] = []
    for (const m of PROJECT_DELIVERY_MUTATIONS) {
      const k = endpointKey(m.file, m.router, m.method, m.path)
      const e = byKey.get(k)
      if (!e) { problems.push(`${k}: no such endpoint in source`); continue }
      const expected = DELIVERY_DOMAIN_WRITE_CAPABILITY[m.domain]
      if (e.capability !== expected) {
        problems.push(`${k}: expected ${expected}, route has ${e.capability ?? 'NO GUARD'}`)
      }
    }
    expect(problems, `delivery mutation guard mismatches:\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('inherits domain from the Phase 2B-2 read perimeter, never reassigns it', () => {
    // The anti-gaming invariant: a route's domain is whatever Phase 2B-2 says
    // its router is. It cannot be moved to a domain with a cheaper capability.
    const problems: string[] = []
    for (const m of PROJECT_DELIVERY_MUTATIONS) {
      const readDomain = READ_DOMAIN.get(`${m.file} ${m.router}`)
      if (!readDomain) { problems.push(`${m.file} ${m.router}: not a Phase 2B-2 delivery router`); continue }
      if (readDomain !== m.domain) {
        problems.push(`${m.file} ${m.router}: read perimeter says ${readDomain}, mutation registry says ${m.domain}`)
      }
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })
})

// ─── 2. Nothing is left behind ───────────────────────────────────────────────
describe('delivery mutation completeness', () => {
  /** Every non-GET endpoint living in a Phase 2B-2 delivery file+router. */
  const deliveryMutations = endpoints.filter(e =>
    e.method !== 'GET' && READ_DOMAIN.has(`${e.file} ${e.router}`) && !EXCEPTION_KEYS.has(e.key))

  it('finds the delivery mutation surface', () => {
    expect(deliveryMutations.length).toBeGreaterThan(100)
  })

  it('leaves no delivery mutation authentication-only and unexplained', () => {
    const registered = new Set(PROJECT_DELIVERY_MUTATIONS.map(m => endpointKey(m.file, m.router, m.method, m.path)))
    const escalated  = new Set(ESCALATED_DELIVERY_MUTATIONS.map(m => endpointKey(m.file, m.router, m.method, m.path)))

    const unexplained = deliveryMutations
      .filter(e => !e.capability && !registered.has(e.key) && !escalated.has(e.key))
      .map(e => e.key)

    expect(unexplained,
      'project-delivery mutations with no server authorization and no recorded reason — ' +
      `register them in api/authz/projectDeliveryMutations.ts or escalate them:\n  ${unexplained.join('\n  ')}`,
    ).toEqual([])
  })

  it('requires a substantive reason and a current-guard note for every escalation', () => {
    for (const m of ESCALATED_DELIVERY_MUTATIONS) {
      expect(m.reason.length, `${m.file} ${m.path} needs a reason`).toBeGreaterThan(60)
      expect(m.current.length, `${m.file} ${m.path} must record what guards it today`).toBeGreaterThan(10)
    }
  })

  it('holds no stale escalations', () => {
    const stale = ESCALATED_DELIVERY_MUTATIONS
      .filter(m => !byKey.has(endpointKey(m.file, m.router, m.method, m.path)))
      .map(m => `${m.file} ${m.method} ${m.path}`)
    expect(stale, `escalations naming endpoints that no longer exist: ${stale.join(', ')}`).toEqual([])
  })

  it('keeps escalated endpoints out of the protected registry', () => {
    const registered = new Set(PROJECT_DELIVERY_MUTATIONS.map(m => endpointKey(m.file, m.router, m.method, m.path)))
    const both = ESCALATED_DELIVERY_MUTATIONS
      .map(m => endpointKey(m.file, m.router, m.method, m.path))
      .filter(k => registered.has(k))
    expect(both, `escalated and protected at once: ${both.join(', ')}`).toEqual([])
  })
})

// ─── 3. Nothing consequential wears an ordinary capability ───────────────────
describe('ordinary writes do not absorb consequential authority', () => {
  it('registers no endpoint that is already a consequential transition', () => {
    const transitions = new Set(ENFORCED_TRANSITIONS.map(t => endpointKey(t.file, t.router, t.method, t.path)))
    const overlap = PROJECT_DELIVERY_MUTATIONS
      .map(m => endpointKey(m.file, m.router, m.method, m.path))
      .filter(k => transitions.has(k))
    expect(overlap, `consequential transitions given an ordinary write capability: ${overlap.join(', ')}`).toEqual([])
  })

  it('keeps the transition-state guard on every generic writer that had one', () => {
    // Adding a capability must not have displaced guardTransitionOwnedState —
    // an ordinary writer must still be unable to reach a transition-owned state.
    const guarded = new Set(STATE_POLICIES.flatMap(p => p.genericEndpoints))
    const problems: string[] = []
    for (const key of guarded) {
      const e = byKey.get(key)
      if (!e) { problems.push(`${key}: endpoint vanished`); continue }
      const file = fs.readFileSync(path.join(ROUTES_DIR, e.file), 'utf8')
      const decl = `${e.router}.${e.method.toLowerCase()}('${e.path}'`
      const idx = file.indexOf(decl)
      const head = file.slice(idx, idx + 260)
      if (!/guardTransitionOwnedState\(/.test(head)) problems.push(`${key}: lost its transition-state guard`)
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })

  it('never grants a delivery write capability to viewer', () => {
    for (const cap of Object.values(DELIVERY_DOMAIN_WRITE_CAPABILITY)) {
      expect(roleHasCapability('viewer', cap), `viewer must not hold ${cap}`).toBe(false)
    }
  })

  it('never grants a delivery write capability to the platform administrator', () => {
    // ADR-014 D2: platform administration is not business authority. If this
    // ever fails, a delivery grant was added to `admin` — not a test to relax.
    for (const cap of Object.values(DELIVERY_DOMAIN_WRITE_CAPABILITY)) {
      expect(roleHasCapability('admin', cap), `admin must not hold ${cap}`).toBe(false)
    }
  })

  it('keeps every write capability strictly weaker than its approval sibling', () => {
    // Holding `<domain>.write` must never imply `<domain>.approve`.
    const pairs: [string, string][] = [
      ['quality.write', 'quality.verify'], ['risk.write', 'risk.approve'],
      ['construction.write', 'construction.approve'], ['commissioning.write', 'commissioning.approve'],
      ['procurement.write', 'procurement.approve'], ['safety.write', 'safety.approve'],
      ['project.write', 'project.approve'], ['docs.write', 'docs.publish'],
    ]
    for (const [write, approve] of pairs) {
      const writers  = USER_ROLES.filter(r => roleHasCapability(r, write))
      const approvers = USER_ROLES.filter(r => roleHasCapability(r, approve))
      expect(writers.length, `${write} must have holders`).toBeGreaterThan(0)
      // Every approver-only role stays a strict subset — writers ⊉ approvers.
      expect(approvers.every(a => writers.includes(a)) && writers.length >= approvers.length).toBe(true)
      const writeOnly = writers.filter(w => !approvers.includes(w))
      expect(writeOnly.length, `${write} and ${approve} have identical holders — the distinction is not enforced`)
        .toBeGreaterThan(0)
    }
  })
})

// ─── 4. Holder matrix, asserted rather than described ────────────────────────
describe('delivery write holder matrix', () => {
  it('matches the recorded Phase 1 / Phase 2 grants exactly', () => {
    const actual: Record<string, string[]> = {}
    for (const cap of Object.values(DELIVERY_DOMAIN_WRITE_CAPABILITY)) {
      actual[cap] = USER_ROLES.filter(r => roleHasCapability(r, cap))
    }
    expect(actual).toEqual({
      'project.write':       ['owner', 'project_manager', 'engineer'],
      'team.write':          ['owner', 'project_manager'],
      'schedule.write':      ['owner', 'project_manager', 'engineer'],
      'risk.write':          ['owner', 'project_manager', 'engineer'],
      'engineering.write':   ['owner', 'project_manager', 'engineer'],
      'docs.write':          ['owner', 'project_manager', 'engineer', 'procurement'],
      'construction.write':  ['owner', 'project_manager', 'engineer', 'field_ops'],
      'field.write':         ['owner', 'project_manager', 'field_ops'],
      'quality.write':       ['owner', 'project_manager', 'engineer', 'field_ops'],
      'safety.write':        ['owner', 'project_manager', 'field_ops'],
      'procurement.write':   ['owner', 'project_manager', 'procurement'],
      'commissioning.write': ['owner', 'project_manager'],
    })
  })

  it('grants no delivery write capability that Phase 1 did not already imply a view for', () => {
    // A writer must be able to see the domain it writes; the reverse need not hold.
    for (const [domain, writeCap] of Object.entries(DELIVERY_DOMAIN_WRITE_CAPABILITY)) {
      const viewCap = `${domain}.view`
      for (const role of USER_ROLES) {
        if (roleHasCapability(role, writeCap)) {
          expect(SERVER_ROLE_CAPS[role].includes(viewCap as never),
            `${role} holds ${writeCap} but not ${viewCap}`).toBe(true)
        }
      }
    }
  })
})
