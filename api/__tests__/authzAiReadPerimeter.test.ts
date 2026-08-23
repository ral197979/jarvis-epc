/**
 * ADR-014 Phase 2B-3 — the AI / cross-domain read perimeter, and its ratchet.
 *
 * The invariant this file defends is not "these routes have a guard". It is:
 *
 *   using AI must not disclose information the caller could not read directly.
 *
 * So the ratchet checks the *shape* of each requirement, not just its presence:
 * an assistant read guarded by `assistant.use` alone is a failure even though
 * it is guarded; a conjunction that has quietly lost `cost.view` is a failure
 * even though the route still has a capability; and an ALL requirement
 * downgraded to `requireAnyCapability` is a failure precisely because it still
 * looks protected.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  AI_CROSS_DOMAIN_READS,
  PENDING_AI_READS,
  RECLASSIFIED_NOT_AI_READS,
  TEMPORARY_CROSS_DOMAIN_CAPABILITY,
} from '../authz/aiCrossDomainReads'
import { HIGH_SENSITIVITY_READS } from '../authz/highSensitivityReads'
import { PROJECT_DELIVERY_READS, MIXED_PAYLOAD_DELIVERY_READS } from '../authz/projectDeliveryReads'
import { ENDPOINT_EXCEPTIONS } from '../authz/routeManifest'
import { ENFORCED_TRANSITIONS } from '../authz/transitions'
import { AI_CROSS_DOMAIN_MUTATIONS } from '../authz/aiCrossDomainMutations'
import { isServerCapability, SERVER_ROLE_CAPS, USER_ROLES, type UserRole } from '../authz/capabilities'
import { ROLE_CAPS as CLIENT_ROLE_CAPS, CAPABILITIES as CLIENT_CAPABILITIES } from '../../src/config/capabilities'
import { censusWithEffectivePaths } from './helpers/endpointCensus'

const endpoints = censusWithEffectivePaths()
const byKey = new Map(endpoints.map(e => [e.key, e]))
const key = (r: { file: string; router: string; method: string; path: string }) =>
  `${r.file} ${r.router}.${r.method} ${r.path}`

const holders = (capability: string): UserRole[] =>
  USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(capability))

/** Roles satisfying every capability in a conjunction. */
const holdersOfAll = (caps: readonly string[]): UserRole[] =>
  USER_ROLES.filter(r => caps.every(c => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(c)))

/**
 * Source-domain name → the capability that governs it. Written out rather than
 * derived from the capability name: `project.view` and `project.list.all` share
 * a prefix but are different authorities — the project record versus the
 * organisation-wide registry — and splitting on the dot conflates them.
 */
const DOMAIN_CAPABILITY: Record<string, string> = {
  // Phase 2B-1
  portfolio: 'portfolio.view',
  cost:      'cost.view',
  crm:       'crm.view',
  audit:     'audit.view',
  platform:  'platform.admin',
  // Phase 2B-2
  project:       'project.view',
  team:          'team.view',
  schedule:      'schedule.view',
  risk:          'risk.view',
  engineering:   'engineering.view',
  docs:          'docs.view',
  construction:  'construction.view',
  field:         'field.view',
  quality:       'quality.view',
  safety:        'safety.view',
  procurement:   'procurement.view',
  commissioning: 'commissioning.view',
}
const HIGH_SENSITIVITY_DOMAINS = ['portfolio', 'cost', 'crm', 'audit', 'platform']
const DELIVERY_DOMAINS = ['project', 'team', 'schedule', 'risk', 'engineering', 'docs',
  'construction', 'field', 'quality', 'safety', 'procurement', 'commissioning']

/** Route files that make up the AI / cross-domain surface. */
const AI_FILES = [...new Set(AI_CROSS_DOMAIN_READS.map(r => r.file))]

/**
 * Mounted-path patterns for the AI / cross-domain surface. The ratchet needs
 * both: file membership catches a new endpoint added to an existing AI router,
 * and the path pattern catches a whole new AI router nobody registered.
 */
const AI_PATH = /\/(adaptive|agents|agent-actions|ai|twins|scenarios|simulation|ops|optimization|readiness|evidence|copilot|coordination|field-assistant)(\/|$)/
const isAiSurface = (e: { file: string; effective: string[]; path: string }) =>
  AI_FILES.includes(e.file) || (e.effective.length ? e.effective : [e.path]).some(p => AI_PATH.test(p))

const READ_SHAPED_PATH =
  /\/(search|query|preview|analytics|report|reports|lookup|filter|export|exports|download|summary|stats|metrics|evaluate|detect|check|health|compute|simulate|explain|recommendations|insights|status|versions|capabilities)(\/|$)/i
const isReadCandidate = (e: { method: string; path: string }) =>
  e.method === 'GET' || READ_SHAPED_PATH.test(e.path)

// ─── 1. Registry integrity ────────────────────────────────────────────────────
describe('AI / cross-domain read registry', () => {
  it('declares only registered capabilities', () => {
    for (const r of AI_CROSS_DOMAIN_READS) {
      expect(r.allOf.length, `${r.file} ${r.path}: empty requirement`).toBeGreaterThan(0)
      for (const c of r.allOf) {
        expect(isServerCapability(c), `${r.file} ${r.path}: unknown capability ${c}`).toBe(true)
      }
    }
  })

  it('holds no duplicate entries', () => {
    const seen = new Map<string, number>()
    for (const r of AI_CROSS_DOMAIN_READS) seen.set(key(r), (seen.get(key(r)) ?? 0) + 1)
    const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k)
    expect(dupes, `duplicated reads: ${dupes.join(', ')}`).toEqual([])
  })

  it('names only endpoints that exist in source', () => {
    const missing = AI_CROSS_DOMAIN_READS.map(key).filter(k => !byKey.has(k))
    expect(missing, `registered reads with no matching route:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('holds no stale reclassifications, and each has a reason', () => {
    const real = new Set(endpoints.map(e => `${e.file} ${e.method} ${e.path}`))
    for (const r of RECLASSIFIED_NOT_AI_READS) {
      expect(real.has(`${r.file} ${r.method} ${r.path}`), `${r.file} ${r.path} no longer exists`).toBe(true)
      expect(r.reason.length, `${r.file} ${r.path} needs a reason`).toBeGreaterThan(40)
    }
  })

  it('gives every entry a substantive, evidence-bearing reason', () => {
    for (const r of AI_CROSS_DOMAIN_READS) {
      expect(r.reason.length, `${r.file} ${r.method} ${r.path} needs a reason`).toBeGreaterThan(60)
    }
  })

  it('has no pending in-scope AI reads', () => {
    expect(PENDING_AI_READS).toEqual([])
  })
})

// ─── 2. The AI authorization rule, expressed as invariants ────────────────────
describe('AI authority never substitutes for data authority', () => {
  it('never protects source-domain data with assistant.use alone', () => {
    const bad = AI_CROSS_DOMAIN_READS
      .filter(r => r.allOf.length === 1 && r.allOf[0] === 'assistant.use')
      .map(r => `${r.file} ${r.method} ${r.path}`)
    expect(bad, `assistant.use is not data authority (§6):\n  ${bad.join('\n  ')}`).toEqual([])
  })

  it('requires assistant.use alongside the domain for every end-user assistant read', () => {
    const missing = AI_CROSS_DOMAIN_READS
      .filter(r => r.category === 'DOMAIN_AI_READ' || (r.category === 'CROSS_DOMAIN_AI_READ' && !r.temporary))
      .filter(r => !r.allOf.includes('assistant.use'))
      .map(r => `${r.file} ${r.method} ${r.path}`)
    expect(missing, `an assistant surface must require AI authority too (§7):\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('never lets ai.govern alone open project or commercial data', () => {
    const bad = AI_CROSS_DOMAIN_READS
      .filter(r => r.allOf.includes('ai.govern'))
      .filter(r => r.sources.some(s => s !== 'ai-governance'))
      .map(r => `${r.file} ${r.method} ${r.path}: ai.govern over ${r.sources.join(', ')}`)
    expect(bad, `ai.govern is not a business-data capability (§8, §15):\n  ${bad.join('\n  ')}`).toEqual([])
  })

  it('grants no ai.govern endpoint to a role lacking the domains it discloses', () => {
    // The §51 boundary: an admin holding ai.govern must not thereby read
    // delivery or commercial records. Governance reads disclose only governance.
    for (const r of AI_CROSS_DOMAIN_READS.filter(x => x.allOf.includes('ai.govern'))) {
      expect(r.sources, `${r.file} ${r.path} claims a business source under ai.govern`).toEqual(['ai-governance'])
    }
  })

  it('keeps every Phase 2B-1 domain behind its own capability, even inside AI output', () => {
    const problems: string[] = []
    for (const r of AI_CROSS_DOMAIN_READS) {
      const admitted = holdersOfAll(r.allOf)
      for (const domain of HIGH_SENSITIVITY_DOMAINS) {
        // If the payload discloses a high-sensitivity domain, no admitted role
        // may lack that domain's capability.
        if (!r.sources.includes(domain)) continue
        const cap = DOMAIN_CAPABILITY[domain]
        const overshare = admitted.filter(role => !holders(cap).includes(role))
        if (overshare.length) problems.push(`${r.file} ${r.method} ${r.path} would disclose ${cap} to ${overshare.join(', ')}`)
      }
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })

  it('keeps every Phase 2B-2 delivery domain behind its own capability', () => {
    const problems: string[] = []
    for (const r of AI_CROSS_DOMAIN_READS) {
      const admitted = holdersOfAll(r.allOf)
      for (const domain of DELIVERY_DOMAINS) {
        if (!r.sources.includes(domain)) continue
        const cap = DOMAIN_CAPABILITY[domain]
        const overshare = admitted.filter(role => !holders(cap).includes(role))
        if (overshare.length) problems.push(`${r.file} ${r.method} ${r.path} would disclose ${cap} to ${overshare.join(', ')}`)
      }
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })

  it('fails closed on an unbounded payload — Owner only', () => {
    for (const r of AI_CROSS_DOMAIN_READS.filter(x => x.temporary)) {
      expect(r.sources, `${r.file} ${r.path}: a temporary entry claims bounded sources`).toEqual(['any'])
      expect(r.allOf, `${r.file} ${r.path}`).toEqual([TEMPORARY_CROSS_DOMAIN_CAPABILITY])
      expect(holdersOfAll(r.allOf), `${r.file} ${r.path} must stay Owner-only`).toEqual(['owner'])
    }
  })
})

// ─── 3. The guard in source matches the registry, capability for capability ───
describe('every registered AI read is guarded with its full requirement', () => {
  it.each(AI_CROSS_DOMAIN_READS.map(r => [`${r.file} ${r.method} ${r.path}`, r] as const))(
    '%s',
    (_label, r) => {
      const e = byKey.get(key(r))
      expect(e, 'no such endpoint in source').toBeDefined()
      expect(e!.allCapabilities,
        `${r.file} ${r.method} ${r.path}: registry requires ${r.allOf.join(' AND ')}, ` +
        `route declares ${e!.allCapabilities?.join(' AND ') ?? 'nothing'}`,
      ).toEqual([...r.allOf])
    },
  )

  it('uses requireAllCapabilities wherever more than one capability is required', () => {
    const problems: string[] = []
    for (const r of AI_CROSS_DOMAIN_READS.filter(x => x.allOf.length > 1)) {
      const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', r.file), 'utf8')
      const esc = r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const decl = new RegExp(`${r.router}\\s*\\.\\s*${r.method.toLowerCase()}\\s*\\(\\s*'${esc}'\\s*,([\\s\\S]{0,400}?)(?:async\\s*\\(|\\(\\s*_?req)`)
      const head = decl.exec(src)?.[1] ?? ''
      if (!/requireAllCapabilities\(/.test(head)) problems.push(`${r.file} ${r.method} ${r.path} does not use requireAllCapabilities`)
      if (/requireAnyCapability\(/.test(head)) problems.push(`${r.file} ${r.method} ${r.path} uses ANY where ALL is required`)
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })

  it('uses requireAnyCapability nowhere in the AI surface', () => {
    const problems: string[] = []
    for (const file of AI_FILES) {
      const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', file), 'utf8')
      if (/requireAnyCapability\(/.test(src)) problems.push(file)
    }
    expect(problems, `an "any of" guard on combined output leaks each half (§9):\n  ${problems.join('\n  ')}`).toEqual([])
  })

  it('stacks no ad-hoc role check on a migrated AI read', () => {
    const AD_HOC = /requireRole\(|\breq\.auth\??\.role\b|_requireAdmin\(|_requireRole\(/
    const problems: string[] = []
    for (const r of AI_CROSS_DOMAIN_READS) {
      const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', r.file), 'utf8')
      const esc = r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const decl = new RegExp(`${r.router}\\s*\\.\\s*${r.method.toLowerCase()}\\s*\\(\\s*'${esc}'\\s*,[\\s\\S]{0,600}`)
      const head = (decl.exec(src)?.[0] ?? '').split('\n').slice(0, 6).join('\n')
      if (AD_HOC.test(head)) problems.push(`${r.file} ${r.method} ${r.path}`)
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })
})

// ─── 4. The ratchet ───────────────────────────────────────────────────────────
describe('AI / cross-domain read ratchet', () => {
  const registered = new Set(AI_CROSS_DOMAIN_READS.map(key))
  const reclassified = new Set(RECLASSIFIED_NOT_AI_READS.map(r => `${r.file} ${r.method} ${r.path}`))
  const otherGates = new Set([
    ...HIGH_SENSITIVITY_READS.map(key),
    ...PROJECT_DELIVERY_READS.map(key),
    ...MIXED_PAYLOAD_DELIVERY_READS.map(key),
  ])
  const exceptions = new Set(Object.keys(ENDPOINT_EXCEPTIONS))
  // Consequential transitions are owned by the Phase 2A ratchet, which checks
  // them more strictly than this one. Routing them there is not an exemption:
  // an unregistered transition still fails, just in the other suite.
  const transitions = new Set(ENFORCED_TRANSITIONS.map(t => `${t.file} ${t.router}.${t.method} ${t.path}`))
  // A route registered as an AI / cross-domain MUTATION is accounted for by the
  // mutation ratchet, which checks it more strictly than this sweep does.
  // Needed because READ_SHAPED_PATH matches nouns like `/status`, so a genuine
  // write such as `twin.ts PATCH /:twinId/status` is "read-shaped" by name.
  // Excluding it here is not an exemption: the same endpoint must still appear
  // in AI_CROSS_DOMAIN_MUTATIONS with a guard the census agrees with.
  const aiMutations = new Set(AI_CROSS_DOMAIN_MUTATIONS.map(key))

  it('leaves no read-shaped endpoint in an AI route file unaccounted for', () => {
    const unaccounted = endpoints.filter(e => {
      if (!isAiSurface(e)) return false
      if (!isReadCandidate(e)) return false
      if (registered.has(e.key) || otherGates.has(e.key) || exceptions.has(e.key)) return false
      if (transitions.has(e.key)) return false
      if (aiMutations.has(e.key)) return false
      if (reclassified.has(`${e.file} ${e.method} ${e.path}`)) return false
      return true
    }).map(e => `${e.method} ${e.effective[0] ?? e.path}  (${e.key})`)

    expect(unaccounted,
      'unprotected AI / cross-domain reads — register them in api/authz/aiCrossDomainReads.ts ' +
      `or record why they are out of scope:\n  ${unaccounted.join('\n  ')}`).toEqual([])
  })

  it('classifies every candidate exactly once', () => {
    const plain = new Set(AI_CROSS_DOMAIN_READS.map(r => `${r.file} ${r.method} ${r.path}`))
    const overlap = RECLASSIFIED_NOT_AI_READS
      .map(r => `${r.file} ${r.method} ${r.path}`).filter(k => plain.has(k))
    expect(overlap, `both registered and reclassified: ${overlap.join(', ')}`).toEqual([])
  })

  it('detects an assistant-only under-guard', () => {
    // The subtle failure §44 targets: the route IS guarded, but with AI
    // authority only. Simulate the registry entry a careless change would
    // produce and run it through the same predicate the invariants use.
    const real = AI_CROSS_DOMAIN_READS.find(r => r.sources.includes('cost'))!
    const underGuarded = { ...real, allOf: ['assistant.use'] as const }

    const admitted = holdersOfAll(underGuarded.allOf)
    const overshare = admitted.filter(role => !holders('cost.view').includes(role))
    expect(overshare.length,
      'an assistant.use-only guard over cost data must be detected as an overshare').toBeGreaterThan(0)
    expect(overshare).toContain('project_manager')
  })

  it('detects a dropped capability in a conjunction', () => {
    const real = AI_CROSS_DOMAIN_READS.find(r => r.allOf.length > 2 && r.sources.includes('cost'))!
    const weakened = real.allOf.filter(c => c !== 'cost.view')
    const admitted = holdersOfAll(weakened)
    const overshare = admitted.filter(role => !holders('cost.view').includes(role))
    expect(overshare.length, 'dropping cost.view must widen the admitted set').toBeGreaterThan(0)
  })

  it('detects ALL downgraded to ANY', () => {
    const real = AI_CROSS_DOMAIN_READS.find(r => r.allOf.length > 2)!
    const anyHolders = USER_ROLES.filter(r =>
      real.allOf.some(c => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(c)))
    expect(anyHolders.length,
      'ANY semantics must admit strictly more roles than ALL — which is why it is forbidden',
    ).toBeGreaterThan(holdersOfAll(real.allOf).length)
  })

  it('detects the temporary Owner-only policy being broadened', () => {
    const broadened = ['crossdomain.read', 'assistant.use']
    const anyHolders = USER_ROLES.filter(r =>
      broadened.some(c => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(c)))
    expect(anyHolders.length).toBeGreaterThan(1)
    expect(holders(TEMPORARY_CROSS_DOMAIN_CAPABILITY), 'the temporary capability must stay Owner-only').toEqual(['owner'])
  })

  it('recognises a disposable unprotected AI read', () => {
    const probe = { file: '_probe.ts', router: 'router', method: 'GET', path: '/cost-summary',
                    effective: ['/api/v1/ai/cost-summary'] }
    expect(isReadCandidate(probe)).toBe(true)
    expect(isAiSurface(probe), 'the probe must fall inside the ratchet scope').toBe(true)
    expect(registered.has(key(probe))).toBe(false)
  })
})

// ─── 5. Capability model integrity ────────────────────────────────────────────
describe('the temporary cross-domain capability is server-only and Owner-only', () => {
  it('has no Phase 1 counterpart', () => {
    expect((CLIENT_CAPABILITIES as readonly string[]).includes(TEMPORARY_CROSS_DOMAIN_CAPABILITY),
      'crossdomain.read must not appear in the client projection').toBe(false)
    for (const role of USER_ROLES) {
      expect((CLIENT_ROLE_CAPS[role] as readonly string[]).includes(TEMPORARY_CROSS_DOMAIN_CAPABILITY)).toBe(false)
    }
  })

  it('is granted to the owner alone — not to the platform administrator', () => {
    expect(holders(TEMPORARY_CROSS_DOMAIN_CAPABILITY)).toEqual(['owner'])
    expect(holders(TEMPORARY_CROSS_DOMAIN_CAPABILITY)).not.toContain('admin')
  })

  it('is enumerated: every endpoint relying on it is listed as temporary', () => {
    const usingIt = endpoints.filter(e => e.allCapabilities?.includes(TEMPORARY_CROSS_DOMAIN_CAPABILITY))
    const listed = new Set(AI_CROSS_DOMAIN_READS.filter(r => r.temporary).map(key))
    const unlisted = usingIt.filter(e => !listed.has(e.key)).map(e => e.key)
    expect(unlisted, `routes using the temporary capability without a registry entry:\n  ${unlisted.join('\n  ')}`).toEqual([])
    expect(usingIt.length).toBe(listed.size)
  })
})

// ─── 6. Prior gates intact ────────────────────────────────────────────────────
describe('prior read perimeters are untouched', () => {
  it('keeps all 126 high-sensitivity reads on their own capability', () => {
    const kept = HIGH_SENSITIVITY_READS.filter(r => byKey.get(key(r))?.capability === r.capability).length
    expect(kept).toBe(HIGH_SENSITIVITY_READS.length)
    // ADR-014 Phase 3B moved `projects.ts GET /` out of this gate and into
    // RECLASSIFIED_NOT_HIGH_SENSITIVITY_READS: it became a record-scoped
    // collection whose commercial columns are stripped per reader, so the
    // Owner-only guard this gate required no longer describes it. 127 → 126.
    expect(HIGH_SENSITIVITY_READS.length).toBe(126)
  })

  it('keeps every project-delivery read on its own capability', () => {
    const all = [...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS]
    const kept = all.filter(r => byKey.get(key(r))?.capability === r.capability).length
    // The property is CONSERVATION: no delivery read may drift onto a different
    // capability. That is the line above and it does not depend on the count.
    expect(kept).toBe(all.length)
    // 108 → 109 on 2026-08-23 with `GET /files/documents/:id/content`, the
    // in-app viewer route. New surface on `docs.view`, not a reclassification.
    expect(all.length).toBe(109)
  })

  it('registers no endpoint in two gates at once', () => {
    const overlap = AI_CROSS_DOMAIN_READS.map(key).filter(k => otherGatesKeys.has(k))
    expect(overlap, `an endpoint cannot carry two policies: ${overlap.join(', ')}`).toEqual([])
  })
})

const otherGatesKeys = new Set([
  ...HIGH_SENSITIVITY_READS.map(key),
  ...PROJECT_DELIVERY_READS.map(key),
  ...MIXED_PAYLOAD_DELIVERY_READS.map(key),
])
