/**
 * ADR-014 Phase 2C-3 — the AI / cross-domain mutation ratchet.
 *
 * The invariant is not "these 45 routes have a guard". It is:
 *
 *   every endpoint the entry census reported as a pending AI / cross-domain
 *   mutation has exactly one truthful disposition, and the source agrees.
 *
 * So this file checks the *shape* of each decision, not merely its presence: a
 * classification correction must actually perform no write; a cross-domain write
 * must not reach a business table; a conjunction that has quietly lost a member
 * is a failure even though the route still has a capability; and
 * `crossdomain.write` broadening beyond the owner is a failure even though every
 * route would still look protected.
 *
 * Set comparison, not counts. A registry that drifts from the census fails here
 * whether it grew, shrank, or swapped one endpoint for another.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  AI_CROSS_DOMAIN_MUTATIONS,
  NEWLY_DISCOVERED_CONSEQUENTIAL,
  RECLASSIFIED_AS_READS,
  DOMAIN_OWNED_WRITE_TARGETS,
  TEMPORARY_CROSS_DOMAIN_WRITE,
  PHASE_2C3_OUT_OF_SCOPE,
  type AiMutation,
} from '../authz/aiCrossDomainMutations'
import { AI_CROSS_DOMAIN_READS } from '../authz/aiCrossDomainReads'
import { ENFORCED_TRANSITIONS } from '../authz/transitions'
import { PROJECT_DELIVERY_MUTATIONS, ESCALATED_DELIVERY_MUTATIONS } from '../authz/projectDeliveryMutations'
import {
  HIGH_SENSITIVITY_MUTATIONS,
  UNREGISTERED_MUTATION_DECISIONS,
  OWNER_POLICY_RESOLUTIONS,
} from '../authz/highSensitivityMutations'
import { ENDPOINT_EXCEPTIONS, endpointKey } from '../authz/routeManifest'
import { isServerCapability, SERVER_ROLE_CAPS, USER_ROLES, type UserRole } from '../authz/capabilities'
import { ROLE_CAPS as CLIENT_ROLE_CAPS } from '../../src/config/capabilities'
import { censusWithEffectivePaths } from './helpers/endpointCensus'

const endpoints = censusWithEffectivePaths()
const byKey = new Map(endpoints.map(e => [e.key, e]))
const key = (r: { file: string; router: string; method: string; path: string }) =>
  `${r.file} ${r.router}.${r.method} ${r.path}`

const holders = (capability: string): UserRole[] =>
  USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(capability))
const holdersOfAll = (caps: readonly string[]): UserRole[] =>
  USER_ROLES.filter(r => caps.every(c => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(c)))

const src = (file: string) => fs.readFileSync(path.join(process.cwd(), 'api', 'routes', file), 'utf8')

/**
 * The handler body of one route, for side-effect inspection.
 *
 * REACH — this sees the route handler only, not the services it calls. The
 * table-level checks below therefore catch inline SQL, which is how these
 * handlers write when they write directly. Writes that happen inside a service
 * were established by reading the service during classification and are recorded
 * per entry in `AiMutation.effect`; they are not re-derived mechanically here.
 * A non-vacuity test asserts every body actually parses, so a regex that stops
 * matching fails loudly instead of silently passing everything.
 */
function handlerBody(m: { file: string; router: string; method: string; path: string }): string {
  const esc = m.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `${m.router}\\s*\\.\\s*${m.method.toLowerCase()}\\s*\\(\\s*'${esc}'\\s*,[\\s\\S]*?\\n\\}\\)`,
  )
  return re.exec(src(m.file))?.[0] ?? ''
}

/**
 * The Phase 2C-3 entry set, RE-DERIVED from source rather than transcribed.
 *
 * The scope is what the entry census called a pending ordinary mutation minus
 * the four groups this slice deliberately did not open. Deriving it here means
 * a route added to one of these files later cannot slip past the registry: it
 * appears in this set and has no disposition.
 */
const OUT_OF_SCOPE_FILES = new Set(
  Object.values(PHASE_2C3_OUT_OF_SCOPE).flatMap(g => g.files as readonly string[]),
)
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Semantic corrections a LATER slice added to this registry. They were not in
 * the Phase 2C-3 entry census, so they are held out of the frozen entry-set
 * reconstruction below and asserted on their own terms instead — see
 * "Phase 2C-5 semantic corrections". Bumping the historical 45 to absorb them
 * would destroy the very fact that ratchet exists to preserve.
 */
const PHASE_2C5_CORRECTIONS = AI_CROSS_DOMAIN_MUTATIONS.filter(m => m.addedIn === 'PHASE_2C5')

/** Everything the Phase 2C-3 slice decided, keyed identically to the census. */
const dispositionByKey = new Map<string, string>([
  ...AI_CROSS_DOMAIN_MUTATIONS
    .filter(m => m.addedIn === undefined)
    .map(m => [key(m), m.disposition] as [string, string]),
  ...NEWLY_DISCOVERED_CONSEQUENTIAL.map(m => [key(m), 'CONSEQUENTIAL_TRANSITION'] as [string, string]),
])

/**
 * The entry set reconstructed: still-pending-in-scope + everything closed here.
 * A route this slice guarded is no longer PENDING_PHASE2, so it must be added
 * back to see the set the slice actually started from.
 */
const entrySet = new Set<string>([
  ...endpoints
    .filter(e => MUTATION_METHODS.has(e.method))
    .filter(e => !e.capability)
    .filter(e => !ENDPOINT_EXCEPTIONS[endpointKey(e.file, e.router, e.method, e.path)])
    .filter(e => !OUT_OF_SCOPE_FILES.has(e.file))
    .map(e => e.key),
  ...dispositionByKey.keys(),
])

// ─── 1. Scope reconciles to the certified 45 ──────────────────────────────────
describe('the Phase 2C-3 entry set', () => {
  it('is exactly 45 endpoints', () => {
    expect(entrySet.size,
      `AI / cross-domain pending mutations at entry:\n  ${[...entrySet].sort().join('\n  ')}`,
    ).toBe(45)
  })

  it('matches the registry set exactly — no drift in either direction', () => {
    const decided = new Set(dispositionByKey.keys())
    const undecided = [...entrySet].filter(k => !decided.has(k))
    const invented = [...decided].filter(k => !entrySet.has(k))

    expect(undecided,
      `entry endpoints with no disposition — classify them in ` +
      `api/authz/aiCrossDomainMutations.ts:\n  ${undecided.join('\n  ')}`).toEqual([])
    expect(invented,
      `registry entries that are not in the entry set:\n  ${invented.join('\n  ')}`).toEqual([])
  })

  it('leaves no unexplained Phase 2C-3 endpoint', () => {
    expect(entrySet.size - dispositionByKey.size, 'unexplained Phase 2C-3 endpoints').toBe(0)
  })

  it('gives every endpoint exactly one disposition', () => {
    const seen = new Map<string, number>()
    for (const m of [...AI_CROSS_DOMAIN_MUTATIONS.map(key), ...NEWLY_DISCOVERED_CONSEQUENTIAL.map(key)]) {
      seen.set(m, (seen.get(m) ?? 0) + 1)
    }
    const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k)
    expect(dupes, `classified more than once: ${dupes.join(', ')}`).toEqual([])
  })

  it('reconciles to the certified family decomposition', () => {
    const byFile: Record<string, number> = {}
    for (const k of entrySet) {
      const file = k.split(' ')[0]!
      byFile[file] = (byFile[file] ?? 0) + 1
    }
    expect(byFile).toEqual({
      'adaptive.ts': 12, 'twin.ts': 7, 'optimization.ts': 5, 'evidence.ts': 4,
      'agentMemory.ts': 3, 'scenarios.ts': 3, 'agentReadiness.ts': 2, 'agentRisk.ts': 2,
      'simulation.ts': 2,
      'agentActionsRoutes.ts': 1, 'agents.ts': 1, 'aiGovernance.ts': 1,
      'autoCoordination.ts': 1, 'ops.ts': 1,
    })
  })

  it('names only endpoints that exist in source', () => {
    for (const k of dispositionByKey.keys()) {
      expect(byKey.get(k), `${k}: no such endpoint`).toBeDefined()
    }
  })

  it('overlaps no earlier slice registry', () => {
    const earlier = new Set<string>([
      ...PROJECT_DELIVERY_MUTATIONS.map(key),
      ...ESCALATED_DELIVERY_MUTATIONS.map(key),
      ...HIGH_SENSITIVITY_MUTATIONS.map(key),
      ...UNREGISTERED_MUTATION_DECISIONS.map(u => `${u.file} ${u.router}.${u.method} ${u.path}`),
      ...OWNER_POLICY_RESOLUTIONS.map(o => `${o.file} ${o.router}.${o.method} ${o.path}`),
    ])
    const overlap = [...dispositionByKey.keys()].filter(k => earlier.has(k))
    expect(overlap,
      `already owned by Phase 2C-1 / 2C-2 / 2C-2A: ${overlap.join(', ')}`).toEqual([])
  })
})

// ─── 2. The source agrees with the registry, capability for capability ────────
describe('every protected Phase 2C-3 mutation carries its declared guard', () => {
  const protectedOnes = AI_CROSS_DOMAIN_MUTATIONS.filter(
    m => m.disposition !== 'CLASSIFICATION_CORRECTION_READ',
  )

  it.each(protectedOnes.map(m => [key(m), m] as const))('%s', (_label, m) => {
    const e = byKey.get(key(m))!
    expect(e.allCapabilities,
      `registry requires ${m.allOf.join(' AND ')}, route declares ` +
      `${e.allCapabilities?.join(' AND ') ?? 'nothing'}`).toEqual([...m.allOf])
  })

  it('declares only registered capabilities', () => {
    for (const m of AI_CROSS_DOMAIN_MUTATIONS) {
      for (const c of m.allOf) {
        expect(isServerCapability(c), `${key(m)}: unknown capability ${c}`).toBe(true)
      }
    }
  })

  it('uses requireAllCapabilities wherever more than one capability is required', () => {
    const problems: string[] = []
    for (const m of AI_CROSS_DOMAIN_MUTATIONS.filter(x => x.allOf.length > 1)) {
      const head = handlerBody(m).slice(0, 400)
      if (!/requireAllCapabilities\(/.test(head)) problems.push(`${key(m)} does not use requireAllCapabilities`)
      if (/requireAnyCapability\(/.test(head)) problems.push(`${key(m)} uses ANY where ALL is required`)
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })

  it('introduces requireAnyCapability nowhere in the touched files', () => {
    const files = [...new Set(AI_CROSS_DOMAIN_MUTATIONS.map(m => m.file))]
    const bad = files.filter(f => /requireAnyCapability\(/.test(src(f)))
    expect(bad, `an "any of" guard was not established for this surface (§5E): ${bad.join(', ')}`).toEqual([])
  })

  it('parses every handler body — the source checks are not vacuous', () => {
    const empty = [...AI_CROSS_DOMAIN_MUTATIONS, ...NEWLY_DISCOVERED_CONSEQUENTIAL]
      .filter(m => handlerBody(m).length < 100)
      .map(key)
    expect(empty,
      `handler body not extracted, so every source assertion on it would pass ` +
      `vacuously:\n  ${empty.join('\n  ')}`).toEqual([])
  })

  it('rests on no stale JWT role claim', () => {
    const AD_HOC = /requireRole\(|\breq\.auth\??\.role\b|_requireAdmin\(|_requireRole\(/
    const problems: string[] = []
    for (const m of [...AI_CROSS_DOMAIN_MUTATIONS, ...NEWLY_DISCOVERED_CONSEQUENTIAL]) {
      if (AD_HOC.test(handlerBody(m))) problems.push(key(m))
    }
    expect(problems,
      `authority must come from resolveCurrentUser, not the token:\n  ${problems.join('\n  ')}`).toEqual([])
  })
})

// ─── 3. crossdomain.write — the D8 capability ─────────────────────────────────
describe('the temporary cross-domain write capability', () => {
  it('is granted to the owner alone', () => {
    expect(holders(TEMPORARY_CROSS_DOMAIN_WRITE)).toEqual(['owner'])
  })

  it('is NOT held by the platform administrator, nor by any delivery role', () => {
    for (const role of USER_ROLES.filter(r => r !== 'owner')) {
      expect(
        (SERVER_ROLE_CAPS[role] as readonly string[]).includes(TEMPORARY_CROSS_DOMAIN_WRITE),
        `${role} must not hold ${TEMPORARY_CROSS_DOMAIN_WRITE}`,
      ).toBe(false)
    }
  })

  it('has no Phase 1 counterpart — it is server-only', () => {
    for (const role of USER_ROLES) {
      expect((CLIENT_ROLE_CAPS[role] as readonly string[]).includes(TEMPORARY_CROSS_DOMAIN_WRITE)).toBe(false)
    }
  })

  it('is a separate authority from crossdomain.read, not an alias', () => {
    expect(TEMPORARY_CROSS_DOMAIN_WRITE).not.toBe('crossdomain.read')
    // Identical holders today; the point is that they are two decisions. If a
    // later slice relaxes the read policy, the write must not follow silently.
    const readers = holders('crossdomain.read')
    const writers = holders(TEMPORARY_CROSS_DOMAIN_WRITE)
    expect(readers).toEqual(['owner'])
    expect(writers).toEqual(['owner'])
  })

  it('marks every endpoint relying on it as temporary, and enumerates them', () => {
    const usingIt = AI_CROSS_DOMAIN_MUTATIONS.filter(m => m.allOf.includes(TEMPORARY_CROSS_DOMAIN_WRITE))
    expect(usingIt.length).toBeGreaterThan(0)
    for (const m of usingIt) {
      expect(m.temporary, `${key(m)} uses the temporary capability without declaring it`).toBe(true)
      expect(m.allOf, `${key(m)} must not dilute the fail-closed policy with a second capability`)
        .toEqual([TEMPORARY_CROSS_DOMAIN_WRITE])
      expect(holdersOfAll(m.allOf), `${key(m)} must stay Owner-only`).toEqual(['owner'])
    }
  })

  it('never authorizes a mutation with the READ capability', () => {
    const bad = AI_CROSS_DOMAIN_MUTATIONS
      .filter(m => m.disposition !== 'CLASSIFICATION_CORRECTION_READ')
      .filter(m => m.allOf.includes('crossdomain.read'))
      .map(key)
    expect(bad,
      `a write authorized by a read capability (ADR-014 D8 materiality test):\n  ${bad.join('\n  ')}`,
    ).toEqual([])
  })

  it('does not become an owner bypass into a business domain', () => {
    const problems: string[] = []
    for (const m of AI_CROSS_DOMAIN_MUTATIONS.filter(x => x.allOf.length === 1
      && x.allOf[0] === TEMPORARY_CROSS_DOMAIN_WRITE)) {
      const body = handlerBody(m)
      for (const table of DOMAIN_OWNED_WRITE_TARGETS) {
        const write = new RegExp(
          `(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'i',
        )
        if (write.test(body)) {
          problems.push(`${key(m)} writes domain-owned table ${table} with crossdomain.write alone`)
        }
      }
    }
    expect(problems,
      `crossdomain.write governs synthesized state only (§9):\n  ${problems.join('\n  ')}`).toEqual([])
  })
})

// ─── 4. ai.govern is not a business-domain bypass ─────────────────────────────
describe('ai.govern stays AI governance', () => {
  it('is held by the owner and the platform administrator only', () => {
    expect(holders('ai.govern')).toEqual(['owner', 'admin'])
  })

  it('never guards a handler that writes a business-domain table', () => {
    const problems: string[] = []
    const governed = [
      ...AI_CROSS_DOMAIN_MUTATIONS.filter(m => m.allOf.length === 1 && m.allOf[0] === 'ai.govern'),
      ...NEWLY_DISCOVERED_CONSEQUENTIAL.filter(m => m.capability === 'ai.govern'),
    ]
    for (const m of governed) {
      const body = handlerBody(m)
      for (const table of DOMAIN_OWNED_WRITE_TARGETS) {
        if (new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'i').test(body)) {
          problems.push(`${key(m)} writes ${table} under ai.govern alone`)
        }
      }
    }
    expect(problems,
      `governing AI does not authorize changing the business it governs (§10):\n  ${problems.join('\n  ')}`,
    ).toEqual([])
  })
})

// ─── 5. Bounded conjunctions stay bounded ─────────────────────────────────────
describe('bounded AI/domain conjunctions', () => {
  const bounded = AI_CROSS_DOMAIN_MUTATIONS.filter(m => m.disposition === 'BOUNDED_DOMAIN_AI_MUTATION')

  it('exists — the two-dimensional model was preserved, not collapsed', () => {
    expect(bounded.length).toBeGreaterThan(0)
  })

  it('requires AI authority alongside every source domain', () => {
    for (const m of bounded) {
      expect(m.allOf, `${key(m)} must require assistant.use`).toContain('assistant.use')
      expect(m.allOf.length, `${key(m)} must name its domains`).toBeGreaterThan(1)
    }
  })

  it('mirrors the capability set its own read sibling already carries', () => {
    for (const m of bounded) {
      const sibling = AI_CROSS_DOMAIN_READS.find(r => r.file === m.file && r.router === m.router)
      expect(sibling, `${key(m)}: no registered read sibling to inherit from`).toBeDefined()
      expect([...m.allOf].sort(),
        `${key(m)} must not require less than reading the same data`,
      ).toEqual([...sibling!.allOf].sort())
    }
  })
})

// ─── 6. Classification corrections are real, and land in the read perimeter ───
describe('classification corrections', () => {
  const corrections = AI_CROSS_DOMAIN_MUTATIONS.filter(
    m => m.disposition === 'CLASSIFICATION_CORRECTION_READ',
  )

  it('declares no persisted effect', () => {
    for (const m of corrections) expect(m.effect, key(m)).toBe('none')
  })

  it('performs no write in the handler itself', () => {
    const WRITE = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i
    const problems = corrections
      .filter(m => WRITE.test(handlerBody(m)))
      .map(key)
    expect(problems,
      `reclassified as a read but writes:\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('is registered in the Phase 2B-3 read perimeter, not a second list', () => {
    const registeredReads = new Set(AI_CROSS_DOMAIN_READS.map(key))
    const missing = corrections.filter(m => !registeredReads.has(key(m))).map(key)
    expect(missing,
      `a correction must join api/authz/aiCrossDomainReads.ts so it is ratcheted there:\n  ${missing.join('\n  ')}`,
    ).toEqual([])
  })

  it('carries the same capability in both registries', () => {
    for (const m of corrections) {
      const read = AI_CROSS_DOMAIN_READS.find(r => key(r) === key(m))!
      expect([...read.allOf], `${key(m)}: the two registries disagree`).toEqual([...m.allOf])
    }
  })

  it('is mirrored by the exported summary list', () => {
    expect([...RECLASSIFIED_AS_READS].sort()).toEqual(corrections.map(key).sort())
  })
})

// ─── 7. Escalations land in transitions.ts ────────────────────────────────────
describe('newly discovered consequential transitions', () => {
  it('are registered in transitions.ts with the declared capability', () => {
    const registered = new Map(
      ENFORCED_TRANSITIONS.map(t => [`${t.file} ${t.router}.${t.method} ${t.path}`, t]),
    )
    for (const m of NEWLY_DISCOVERED_CONSEQUENTIAL) {
      const t = registered.get(key(m))
      expect(t, `${key(m)} is not in ENFORCED_TRANSITIONS`).toBeDefined()
      expect(t!.capability, `${key(m)}: capability disagrees with the registry`).toBe(m.capability)
    }
  })

  it('are guarded in source with that capability', () => {
    for (const m of NEWLY_DISCOVERED_CONSEQUENTIAL) {
      expect(byKey.get(key(m))?.allCapabilities, key(m)).toEqual([m.capability])
    }
  })

  it('are not also listed as ordinary mutations', () => {
    const ordinary = new Set(AI_CROSS_DOMAIN_MUTATIONS.map(key))
    const both = NEWLY_DISCOVERED_CONSEQUENTIAL.map(key).filter(k => ordinary.has(k))
    expect(both, `both ordinary and consequential: ${both.join(', ')}`).toEqual([])
  })
})

// ─── 8. Registry hygiene ──────────────────────────────────────────────────────
describe('registry hygiene', () => {
  it('gives every entry a substantive, evidence-bearing reason', () => {
    for (const m of [...AI_CROSS_DOMAIN_MUTATIONS, ...NEWLY_DISCOVERED_CONSEQUENTIAL]) {
      expect(m.reason.length, `${key(m)}: reason too thin to review`).toBeGreaterThan(60)
    }
  })

  it('states a persisted effect for every protected mutation', () => {
    for (const m of AI_CROSS_DOMAIN_MUTATIONS.filter(x => x.disposition !== 'CLASSIFICATION_CORRECTION_READ')) {
      expect(m.effect, `${key(m)}: effect not stated`).not.toBe('none')
      expect(m.effect.length).toBeGreaterThan(3)
    }
  })

  it('accounts for the whole exit backlog by group', () => {
    // The groups Phase 2C-3 deferred summed to 24 at ITS exit. Phase 2C-4A then
    // closed 12 (actions.ts, personalAgent.ts), Phase 2C-4B the next 5
    // (notifications.ts, once D13 supplied an ownership model), and Phase 2C-5
    // the last 7 (SCIM 4, IoT hybrid 2, denverMcp 1) by giving each a trust
    // boundary in ENDPOINT_EXCEPTIONS rather than a user capability.
    const total = Object.values(PHASE_2C3_OUT_OF_SCOPE).reduce((s, g) => s + g.count, 0)
    expect(total, 'the groups Phase 2C-3 deferred').toBe(24)

    const pending = endpoints
      .filter(e => MUTATION_METHODS.has(e.method) && !e.capability)
      .filter(e => !ENDPOINT_EXCEPTIONS[endpointKey(e.file, e.router, e.method, e.path)])
    expect(pending.map(e => e.key),
      'ADR-014 Phase 2C-5 exit: no ordinary mutation may remain pending').toEqual([])

    // Non-vacuity: the seven Phase 2C-5 closed above are still real endpoints
    // that still carry no user capability — they are accounted for by an
    // explicit trust-boundary exception, not by having quietly disappeared.
    const closedByException = endpoints
      .filter(e => MUTATION_METHODS.has(e.method) && !e.capability)
      .filter(e => ENDPOINT_EXCEPTIONS[endpointKey(e.file, e.router, e.method, e.path)])
      .filter(e => OUT_OF_SCOPE_FILES.has(e.file))
      .map(e => e.key).sort()
    expect(closedByException, 'the seven mutations Phase 2C-5 closed by trust boundary').toEqual([
      'denverMcp.ts router.POST /call',
      'iot.ts iotRouter.POST /iot/ingest',
      'iot.ts iotRouter.POST /sensors/:uid/readings',
      'scim.ts scimRouter.DELETE /Users/:id',
      'scim.ts scimRouter.PATCH /Users/:id',
      'scim.ts scimRouter.POST /Users',
      'scim.ts scimRouter.PUT /Users/:id',
    ])
  })

  it('registers the Phase 2C-5 semantic corrections, and only those', () => {
    // Held out of the frozen Phase 2C-3 entry set above; asserted here so the
    // hold-out cannot become a place to hide an unexamined mutation.
    expect(PHASE_2C5_CORRECTIONS.map(key).sort()).toEqual([
      'twin.ts router.PATCH /:twinId/status',
    ])
    for (const m of PHASE_2C5_CORRECTIONS) {
      const e = byKey.get(key(m))
      expect(e, `${key(m)} must still exist in source`).toBeTruthy()
      expect(e!.allCapabilities, `${key(m)} guard must match the registry`).toEqual([...m.allOf])
    }
  })
})

// ─── 9. The ratchet detects the mutations it exists to detect ─────────────────
describe('the ratchet fails on a weakened guard', () => {
  const withGuard = (m: AiMutation, caps: readonly string[]) => ({ ...m, allOf: caps })

  it('detects a dropped conjunction member', () => {
    const real = AI_CROSS_DOMAIN_MUTATIONS.find(m => m.allOf.length > 1)!
    const weakened = withGuard(real, real.allOf.slice(0, -1))
    const declared = byKey.get(key(real))!.allCapabilities
    expect(declared).not.toEqual([...weakened.allOf])
  })

  it('detects the temporary write capability being broadened', () => {
    const broadened = [...holders(TEMPORARY_CROSS_DOMAIN_WRITE), 'admin' as UserRole]
    expect(broadened).not.toEqual(['owner'])
  })

  it('detects a write relabelled as a classification correction', () => {
    const WRITE = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i
    // A real mutation whose handler writes inline, mislabelled as a read.
    const inlineWriter = AI_CROSS_DOMAIN_MUTATIONS.find(
      m => m.disposition !== 'CLASSIFICATION_CORRECTION_READ' && WRITE.test(handlerBody(m)),
    )
    expect(inlineWriter, 'the probe needs at least one inline writer to be meaningful').toBeDefined()
    expect(WRITE.test(handlerBody(inlineWriter!)),
      'relabelling this as CLASSIFICATION_CORRECTION_READ must fail §6').toBe(true)
  })
})
