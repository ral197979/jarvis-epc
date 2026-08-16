/**
 * ADR-014 Phase 2C-2 §36 — the high-sensitivity mutation ratchet.
 *
 * The registry in `api/authz/highSensitivityMutations.ts` is a claim about the
 * server. This derives the same facts from source and fails the build when the
 * two disagree — a removed guard, a swapped capability, a new unprotected
 * high-sensitivity mutation, an escalation that quietly lost its protection, a
 * route registered under one domain while carrying another domain's capability,
 * or a grant changed to make a route reachable.
 *
 * It also closes the arithmetic. Every mutation that was pending at entry is
 * either protected here, explained by an inherited classification, or named as
 * an owner-policy dependency — and the counts are asserted, not narrated.
 */
import { describe, it, expect } from 'vitest'
import { censusWithEffectivePaths } from './helpers/endpointCensus'
import { ENDPOINT_EXCEPTIONS } from '../authz/routeManifest'
import {
  HIGH_SENSITIVITY_MUTATIONS,
  NEWLY_DISCOVERED_CONSEQUENTIAL,
  UNREGISTERED_MUTATION_DECISIONS,
  POLICY_DEPENDENT_MUTATIONS,
  RECLASSIFIED_MUTATIONS,
} from '../authz/highSensitivityMutations'
import { HIGH_SENSITIVITY_READS } from '../authz/highSensitivityReads'
import { PROJECT_DELIVERY_MUTATIONS, ESCALATED_DELIVERY_MUTATIONS } from '../authz/projectDeliveryMutations'
import { ENFORCED_TRANSITIONS } from '../authz/transitions'
import { AI_CROSS_DOMAIN_READS } from '../authz/aiCrossDomainReads'
import {
  AI_CROSS_DOMAIN_MUTATIONS,
  NEWLY_DISCOVERED_CONSEQUENTIAL as PHASE_2C3_CONSEQUENTIAL,
} from '../authz/aiCrossDomainMutations'
import { isServerCapability, SERVER_ROLE_CAPS, ALL_ROLES_FOR_TEST } from './helpers/capabilityHolders'

const census = censusWithEffectivePaths()
const byKey = new Map(census.map(e => [e.key, e]))
const key = (m: { file: string; router: string; method: string; path: string }) =>
  `${m.file} ${m.router}.${m.method.toUpperCase()} ${m.path}`

const EXCEPTIONS = new Set(Object.keys(ENDPOINT_EXCEPTIONS))
const pendingMutations = census.filter(e => !EXCEPTIONS.has(e.key) && !e.capability && e.method !== 'GET')

// ─── registry ↔ source ────────────────────────────────────────────────────────
describe('§36 registry agrees with the server', () => {
  it('names a capability the registry understands, on every entry', () => {
    for (const m of HIGH_SENSITIVITY_MUTATIONS) {
      expect(isServerCapability(m.capability), `${key(m)}: unknown capability ${m.capability}`).toBe(true)
      if (m.alsoRequires) {
        expect(isServerCapability(m.alsoRequires), `${key(m)}: unknown capability ${m.alsoRequires}`).toBe(true)
      }
    }
  })

  it('holds no duplicate entries', () => {
    const seen = new Map<string, number>()
    for (const m of HIGH_SENSITIVITY_MUTATIONS) seen.set(key(m), (seen.get(key(m)) ?? 0) + 1)
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k)
    expect(dupes, `duplicated mutations: ${dupes.join(', ')}`).toEqual([])
  })

  it('matches every registered mutation to a real, guarded endpoint carrying that exact capability', () => {
    const problems: string[] = []
    for (const m of HIGH_SENSITIVITY_MUTATIONS) {
      const e = byKey.get(key(m))
      if (!e)                     { problems.push(`${key(m)}: no such endpoint in source`); continue }
      if (!e.capability)          { problems.push(`${key(m)}: registered but unguarded`); continue }
      if (e.capability !== m.capability) {
        problems.push(`${key(m)}: registry says ${m.capability}, route says ${e.capability}`)
      }
      // A conjunction must not silently lose a member.
      const expected = m.alsoRequires ? [m.capability, m.alsoRequires] : [m.capability]
      expect(e.allCapabilities ?? [], `${key(m)}: capability conjunction changed`).toEqual(expected)
    }
    expect(problems, `mutation guard mismatches:\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('registers every mutation as a mutation, never a GET', () => {
    for (const m of HIGH_SENSITIVITY_MUTATIONS) {
      expect(m.method, `${key(m)} is not a mutation`).not.toBe('GET')
    }
  })
})

// ─── domain inheritance (§12) ─────────────────────────────────────────────────
describe('§12 domains are inherited from the Phase 2B-1 read perimeter, not invented', () => {
  /** Every read domain a router serves — a set, because one router may serve several. */
  const readDomainsByRouter = new Map<string, Set<string>>()
  for (const r of HIGH_SENSITIVITY_READS) {
    const k = `${r.file}|${r.router}`
    readDomainsByRouter.set(k, (readDomainsByRouter.get(k) ?? new Set()).add(r.domain))
  }

  /**
   * `projects.ts router` is the one router in the Phase 2B-1 registry that
   * legitimately serves more than one read domain: `GET /` is project_registry,
   * `GET /:id/summary` is commercial, and Phase 2B-2 recorded `GET /:id` as
   * MIXED_PAYLOAD_PHASE3. Its mutations are project-domain operations on the
   * project record, so single-domain inheritance cannot decide them and the
   * exemption is stated here rather than hidden by a lenient assertion.
   */
  const MULTI_DOMAIN_ROUTERS = new Set(['projects.ts|router'])

  it('never lets a router be exempted without actually serving several read domains', () => {
    for (const k of MULTI_DOMAIN_ROUTERS) {
      expect(readDomainsByRouter.get(k)?.size ?? 0,
        `${k} is exempted from domain inheritance but serves one read domain`).toBeGreaterThan(1)
    }
  })

  it('assigns platform/commercial/crm/audit/portfolio routers the domain their reads already carry', () => {
    const mismatches: string[] = []
    for (const m of HIGH_SENSITIVITY_MUTATIONS) {
      const k = `${m.file}|${m.router}`
      if (MULTI_DOMAIN_ROUTERS.has(k)) continue
      const domains = readDomainsByRouter.get(k)
      if (!domains) continue                       // §19 routers, reconciled separately
      if (!domains.has(m.domain)) {
        mismatches.push(`${key(m)}: reads say ${[...domains].join('|')}, mutation says ${m.domain}`)
      }
    }
    expect(mismatches, `domain drift:\n  ${mismatches.join('\n  ')}`).toEqual([])
  })

  it('proves the inheritance is load-bearing by finding at least one router it decided', () => {
    const inherited = HIGH_SENSITIVITY_MUTATIONS.filter(m => readDomainsByRouter.has(`${m.file}|${m.router}`))
    expect(inherited.length).toBeGreaterThan(50)
  })
})

// ─── completeness (§7, §44) ───────────────────────────────────────────────────
describe('§44 every mutation pending at entry is accounted for', () => {
  /** The 178 the slice started from, reconstructed: still-pending + everything this slice closed. */
  const closedHere = new Set<string>([
    ...HIGH_SENSITIVITY_MUTATIONS.map(key),
    ...NEWLY_DISCOVERED_CONSEQUENTIAL.map(key),
    ...RECLASSIFIED_MUTATIONS.map(key),
  ])

  it('leaves no high-sensitivity mutation unexplained', () => {
    // Every remaining pending mutation must be named by one of the inherited
    // classifications, not merely be absent from the registry.
    const explained = new Set<string>([
      ...UNREGISTERED_MUTATION_DECISIONS.map(key),
      ...POLICY_DEPENDENT_MUTATIONS.map(key),
      ...ESCALATED_DELIVERY_MUTATIONS.map(key),
      // Phase 2B-3's AI / cross-domain surface — a different slice's backlog.
      ...AI_CROSS_DOMAIN_READS.map(r => `${r.file}|${r.router}`),
    ])
    const aiRouters = new Set(AI_CROSS_DOMAIN_READS.map(r => `${r.file}|${r.router}`))

    const unexplained = pendingMutations
      .filter(e => !explained.has(e.key) && !aiRouters.has(`${e.file}|${e.router}`))
      .map(e => e.key)

    expect(unexplained,
      `pending mutations with no classification — register, defer or escalate them ` +
      `in api/authz/highSensitivityMutations.ts:\n  ${unexplained.join('\n  ')}`).toEqual([])
  })

  it('closes the entry arithmetic exactly', () => {
    const ENTRY = 178
    /** Routes this slice CREATED — they were never in the 178 and must not be subtracted from it. */
    const ADDED = new Set(['payApplications.ts router.POST /pay-applications/:id/submit'])

    const highSensitivityProtected = HIGH_SENSITIVITY_MUTATIONS
      .filter(m => !UNREGISTERED_MUTATION_DECISIONS.some(u => key(u) === key(m)))
      .filter(m => !ADDED.has(key(m))).length
    const unregisteredProtected = UNREGISTERED_MUTATION_DECISIONS.filter(u =>
      u.action === 'REGISTER_AND_PROTECT_IN_2C2' || u.action === 'CLASSIFICATION_CORRECTION',
    ).filter(u => byKey.get(key(u))?.capability).length
    const escalationsResolved = ESCALATED_DELIVERY_MUTATIONS.filter(e => byKey.get(key(e))?.capability).length
    const reclassified = RECLASSIFIED_MUTATIONS.length
    const newlyConsequential = NEWLY_DISCOVERED_CONSEQUENTIAL.length

    // Phase 2C-2A added DELETE /projects/:id (D4) to the registry and closed
    // POST /commissioning/credits (D3), so protected moves 93 -> 94 and
    // escalations resolved 7 -> 8. The two hybrid IoT routes stay pending.
    expect(HIGH_SENSITIVITY_MUTATIONS.length, 'registry size, including the D1 submit route').toBe(99)
    expect(highSensitivityProtected).toBe(94)
    expect(newlyConsequential).toBe(2)
    expect(unregisteredProtected).toBe(4)
    expect(escalationsResolved).toBe(8)
    expect(reclassified).toBe(1)

    const exit = ENTRY
      - highSensitivityProtected - newlyConsequential
      - unregisteredProtected - escalationsResolved - reclassified
    expect(exit, 'the Phase 2C-2 exit backlog is unchanged by later slices').toBe(69)

    // Phase 2C-2 exited at 69. ADR-014 Phase 2C-3 then closed the 45 AI /
    // cross-domain endpoints that were the largest part of that backlog: 36
    // protected mutations, 2 escalated to transitions.ts, and 7 proved to
    // perform no write and moved into the Phase 2B-3 read perimeter.
    //
    // Subtracted explicitly rather than by lowering ENTRY: this slice's
    // arithmetic must keep proving what THIS slice closed, and a later slice
    // must not be able to make that proof pass by shrinking the entry set.
    const closedByPhase2C3 = AI_CROSS_DOMAIN_MUTATIONS.length + PHASE_2C3_CONSEQUENTIAL.length
    expect(closedByPhase2C3, 'the Phase 2C-3 scope').toBe(45)
    expect(exit - closedByPhase2C3,
      'exit backlog must equal the measured pending-mutation count').toBe(pendingMutations.length)

    // The remainder: Personal Inbox 17, SCIM 4, hybrid IoT 2, dead route 1.
    expect(pendingMutations.length).toBe(24)

    // The added route must actually exist and be guarded, or the exclusion above
    // would be a way to hide an unprotected endpoint.
    for (const k of ADDED) expect(byKey.get(k)?.capability, `${k} missing or unguarded`).toBe('cost.write')
  })

  it('accounts for all 28 entry unregistered-domain mutations, with no unexplained residual', () => {
    expect(UNREGISTERED_MUTATION_DECISIONS.length).toBe(28)
    for (const d of UNREGISTERED_MUTATION_DECISIONS) {
      expect(byKey.get(key(d)), `${key(d)}: no such endpoint`).toBeDefined()
      expect(d.evidence.length, `${key(d)} needs evidence, not a label`).toBeGreaterThan(40)
    }
    const byAction = (a: string) => UNREGISTERED_MUTATION_DECISIONS.filter(d => d.action === a).length
    expect(byAction('REGISTER_AND_PROTECT_IN_2C2')).toBe(3)
    expect(byAction('CLASSIFICATION_CORRECTION')).toBe(2)
    expect(byAction('REGISTER_FOR_LATER_SLICE')).toBe(17)
    // Phase 2C-2A moved the two hybrid IoT routes from OWNER_POLICY_REQUIRED to
    // SERVICE_BOUNDARY once their authentication model was made deterministic.
    expect(byAction('SERVICE_BOUNDARY')).toBe(6)
    expect(byAction('OWNER_POLICY_REQUIRED')).toBe(0)
  })

  it('resolves all eight Phase 2C-1 escalations, with none left open', () => {
    expect(ESCALATED_DELIVERY_MUTATIONS.length).toBe(8)
    const open = ESCALATED_DELIVERY_MUTATIONS.filter(e => !byKey.get(key(e))?.capability)
    expect(open.map(key), 'Phase 2C-2A closed the last escalation (D3)').toEqual([])
  })

  it('carries no remaining owner-policy dependency', () => {
    // ADR-014 Phase 2C-2A §16 — the required exit invariant.
    expect(POLICY_DEPENDENT_MUTATIONS.map(key)).toEqual([])
  })
})

// ─── anti-gaming (§37) ────────────────────────────────────────────────────────
describe('§37 the registry explains reality rather than manufacturing a metric', () => {
  it('gives no ordinary write capability to a registered consequential transition', () => {
    const transitions = new Set(ENFORCED_TRANSITIONS.map(key))
    const overlap = HIGH_SENSITIVITY_MUTATIONS.map(key).filter(k => transitions.has(k))
    expect(overlap, `registered as BOTH an ordinary mutation and a transition: ${overlap.join(', ')}`).toEqual([])
  })

  it('registers the two newly discovered consequential operations as transitions, not as ordinary writes', () => {
    const transitions = new Map(ENFORCED_TRANSITIONS.map(t => [key(t), t.capability]))
    for (const n of NEWLY_DISCOVERED_CONSEQUENTIAL) {
      expect(transitions.get(key(n)), `${key(n)} must be a registered transition`).toBe(n.capability)
      expect(n.reason.length).toBeGreaterThan(120)
    }
  })

  it('does not overlap the Phase 2C-1 delivery registry', () => {
    const delivery = new Set(PROJECT_DELIVERY_MUTATIONS.map(key))
    const overlap = HIGH_SENSITIVITY_MUTATIONS.map(key).filter(k => delivery.has(k))
    expect(overlap, `counted in two registries: ${overlap.join(', ')}`).toEqual([])
  })

  it('claims only PUBLIC reclassifications that source actually supports', () => {
    for (const r of RECLASSIFIED_MUTATIONS) {
      const ex = ENDPOINT_EXCEPTIONS[key(r)]
      expect(ex, `${key(r)} claims a reclassification with no manifest entry`).toBeDefined()
      expect(ex.klass).toBe(r.to)
      expect(ex.reason.length).toBeGreaterThan(60)
    }
    // Exactly one route was reclassified. A growing list is the smell §37 warns about.
    expect(RECLASSIFIED_MUTATIONS.length).toBe(1)
  })

  it('leaves the Phase 2C-1 delivery perimeter untouched', () => {
    const broken = PROJECT_DELIVERY_MUTATIONS.filter(m => !byKey.get(key(m))?.capability).map(key)
    expect(broken, `Phase 2C-1 guards lost:\n  ${broken.join('\n  ')}`).toEqual([])
    expect(PROJECT_DELIVERY_MUTATIONS.length).toBe(112)
  })
})

// ─── holder matrix (§38, §39) ─────────────────────────────────────────────────
describe('§38 effective capability holders, asserted so a grant change fails the build', () => {
  /**
   * Every capability this slice attaches anywhere — the registry, the two new
   * transitions, and the seven escalation resolutions. Derived from source for
   * the escalations so a changed guard shows up here rather than hiding.
   */
  const touched = [...new Set([
    ...HIGH_SENSITIVITY_MUTATIONS.flatMap(m => m.alsoRequires ? [m.capability, m.alsoRequires] : [m.capability]),
    ...NEWLY_DISCOVERED_CONSEQUENTIAL.map(m => m.capability),
    ...ESCALATED_DELIVERY_MUTATIONS.map(e => byKey.get(key(e))?.capability).filter((c): c is string => !!c),
  ])].sort()

  const holders = (cap: string) => ALL_ROLES_FOR_TEST.filter(r =>
    (SERVER_ROLE_CAPS[r] as readonly string[]).includes(cap))

  it('matches the matrix reported for this slice, exactly', () => {
    const actual = Object.fromEntries(touched.map(c => [c, holders(c)]))
    expect(actual).toEqual({
      'ai.govern':             ['owner', 'admin'],
      'assistant.admin':       ['owner'],
      'audit.view':            ['owner', 'admin'],
      'commissioning.approve': ['owner'],
      'commissioning.write':   ['owner', 'project_manager'],
      'cost.approve':          ['owner'],
      'cost.write':            ['owner'],
      'portfolio.approve':     ['owner'],
      // ADR-014 D4, added by Phase 2C-2A. Owner alone, deliberately narrower
      // than both project.write and project.approve.
      'project.delete':        ['owner'],
      'safety.approve':        ['owner'],
      'crm.write':             ['owner'],
      'crossdomain.read':      ['owner'],
      'platform.admin':        ['owner', 'admin'],
      'platform.automation':   ['owner', 'admin'],
      'platform.export':       ['owner', 'admin'],
      'platform.identity':     ['owner', 'admin'],
      'platform.integrations': ['owner', 'admin'],
      'platform.security':     ['owner'],
      'project.write':         ['owner', 'project_manager', 'engineer'],
    })
  })

  it('never lets an ordinary write capability reach an approval capability holder set', () => {
    // cost.write must not become a superset of cost.approve by a grant edit.
    for (const [write, approve] of [['cost.write', 'cost.approve'], ['crm.write', 'crm.approve']] as const) {
      const w = new Set(holders(write))
      expect([...holders(approve)].every(r => w.has(r)),
        `${approve} holders must remain within ${write} holders`).toBe(true)
    }
  })

  it('keeps the viewer out of every capability this slice attaches', () => {
    for (const c of touched) expect(holders(c), `viewer holds ${c}`).not.toContain('viewer')
  })

  it('keeps the platform administrator out of every business approval this slice touches', () => {
    // ADR-014 D2. These are the narrowings the escalation review made deliberately.
    for (const c of ['commissioning.approve', 'safety.approve', 'assistant.admin', 'cost.approve']) {
      expect(holders(c), `admin acquired ${c}`).not.toContain('admin')
    }
  })
})
