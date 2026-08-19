/**
 * ADR-014 Phase 2B-2 — the project-delivery read perimeter, and its ratchet.
 *
 * Five invariants:
 *   1. Every registered delivery read exists in source and carries exactly the
 *      guard the registry declares — a swapped capability is a failure.
 *   2. The perimeter is complete: a read-shaped endpoint whose mounted path
 *      names a delivery domain is registered, or deferred with a reason, or the
 *      build fails. The disposable probe proves it.
 *   3. Nothing crosses between perimeters: an endpoint cannot be both a
 *      Phase 2B-1 high-sensitivity read and a weaker delivery read.
 *   4. No guard is wider than the payload it protects.
 *   5. Server delivery authority still equals Phase 1's, capability by capability.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  PROJECT_DELIVERY_READS,
  MIXED_PAYLOAD_DELIVERY_READS,
  PENDING_DELIVERY_READS,
  DEFERRED_DELIVERY_READS,
  DELIVERY_DOMAIN_CAPABILITY,
  type DeliveryDomain,
} from '../authz/projectDeliveryReads'
import {
  HIGH_SENSITIVITY_READS,
  RECLASSIFIED_NOT_HIGH_SENSITIVITY_READS,
} from '../authz/highSensitivityReads'
import { ENDPOINT_EXCEPTIONS } from '../authz/routeManifest'
import { isServerCapability, SERVER_ROLE_CAPS, USER_ROLES, type UserRole } from '../authz/capabilities'
import { ROLE_CAPS as CLIENT_ROLE_CAPS } from '../../src/config/capabilities'
import { censusWithEffectivePaths } from './helpers/endpointCensus'

const endpoints = censusWithEffectivePaths()
const byKey = new Map(endpoints.map(e => [e.key, e]))

const key = (r: { file: string; router: string; method: string; path: string }) =>
  `${r.file} ${r.router}.${r.method} ${r.path}`

/**
 * Mounted-path patterns that mark a read as project-delivery. Deliberately
 * broad: over-matching costs a one-line deferral with a reason; under-matching
 * silently leaves a delivery domain readable by every authenticated user.
 */
const DOMAIN_PATTERNS: ReadonlyArray<readonly [DeliveryDomain, RegExp]> = [
  ['project',       /\/(lifecycle|meetings|nova-integration)(\/|$)/],
  ['team',          /\/(team|timesheets)(\/|$)/],
  ['schedule',      /\/(schedule|critical-path|forecast)(\/|$)/],
  ['risk',          /\/(risks|risk-register)(\/|$)/],
  ['engineering',   /\/(engineering|calc-sessions|drawings|bim-models|bim-issues|knowledge-fixes)(\/|$)/],
  ['docs',          /\/(files|documents|transmittals|turnover-packages)(\/|$)/],
  ['construction',  /\/(daily-logs|sensors|rfis|submittals)(\/|$)/],
  ['field',         /\/(field|field-sync|sync)(\/|$)/],
  ['quality',       /\/(inspections|inspection-templates|punch-lists|ncrs|ncr-summary|deficiencies|quality-intelligence)(\/|$)/],
  ['safety',        /\/(safety|compliance-tasks)(\/|$)/],
  ['procurement',   /\/(vendors|purchase-orders|bid-packages|subcontracts|procurement-risk|vendor-scorecard)(\/|$)/],
  ['commissioning', /\/(commissioning|commissioning-items|systems|tags|coverage|test-packs)(\/|$)/],
]

/** Read semantics are not defined by GET (§14). */
const READ_SHAPED_PATH =
  /\/(search|query|preview|analytics|report|reports|lookup|filter|export|exports|download|summary|stats|metrics|evaluate|detect|check|health|compute|simulate|explain|recommendations|insights|status|versions|capabilities)(\/|$)/i

const isReadCandidate = (e: { method: string; path: string }) =>
  e.method === 'GET' || READ_SHAPED_PATH.test(e.path)

const domainOf = (effective: string): DeliveryDomain | null =>
  DOMAIN_PATTERNS.find(([, re]) => re.test(effective))?.[0] ?? null

/** Holder set for a capability, as the server will decide it. */
const holders = (capability: string): UserRole[] =>
  USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(capability))

// ─── 1. Registry integrity ────────────────────────────────────────────────────
describe('project-delivery read registry', () => {
  it('declares a registered capability for every read', () => {
    for (const r of [...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS]) {
      expect(isServerCapability(r.capability),
        `${r.file} ${r.method} ${r.path}: unknown capability ${r.capability}`).toBe(true)
    }
  })

  it('uses the capability its domain declares — no per-endpoint improvisation', () => {
    const wrong = PROJECT_DELIVERY_READS
      .filter(r => r.capability !== DELIVERY_DOMAIN_CAPABILITY[r.domain])
      .map(r => `${r.file} ${r.method} ${r.path}: domain ${r.domain} → ${DELIVERY_DOMAIN_CAPABILITY[r.domain]}, registry says ${r.capability}`)
    expect(wrong, `domain/capability mismatches:\n  ${wrong.join('\n  ')}`).toEqual([])
  })

  it('holds no duplicate entries', () => {
    const seen = new Map<string, number>()
    for (const r of [...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS]) {
      seen.set(key(r), (seen.get(key(r)) ?? 0) + 1)
    }
    const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k)
    expect(dupes, `duplicated reads: ${dupes.join(', ')}`).toEqual([])
  })

  it('names only endpoints that exist in source', () => {
    const missing = [...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS]
      .map(key).filter(k => !byKey.has(k))
    expect(missing, `registered reads with no matching route:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('gives every deferral a substantive reason and a valid category', () => {
    const CATEGORIES = ['AI_READ_POLICY', 'PERSONAL_INBOX', 'MIXED_PAYLOAD_PHASE3', 'MUTATION', 'PROTOCOL_AUTH', 'DEAD_ROUTE']
    for (const d of DEFERRED_DELIVERY_READS) {
      expect(CATEGORIES, `${d.file} ${d.path}: bad category ${d.category}`).toContain(d.category)
      expect(d.reason.length, `${d.file} ${d.method} ${d.path} needs a reason`).toBeGreaterThan(40)
    }
  })

  it('holds no stale deferrals', () => {
    const real = new Set(endpoints.map(e => `${e.file} ${e.method} ${e.path}`))
    const stale = DEFERRED_DELIVERY_READS
      .map(d => `${d.file} ${d.method} ${d.path}`)
      .filter(k => !real.has(k))
    expect(stale, `deferrals naming endpoints that no longer exist: ${stale.join(', ')}`).toEqual([])
  })

  it('has no pending in-scope delivery reads', () => {
    // Phase 2B-2 closes only when this is empty.
    expect(PENDING_DELIVERY_READS).toEqual([])
  })
})

// ─── 2. The guard in source is the guard in the registry ──────────────────────
describe('every registered delivery read is guarded, with the declared capability', () => {
  it.each([...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS]
    .map(r => [`${r.file} ${r.method} ${r.path}`, r] as const))(
    '%s',
    (_label, r) => {
      const e = byKey.get(key(r))
      expect(e, 'no such endpoint in source').toBeDefined()
      expect(e!.capability,
        `${r.file} ${r.method} ${r.path}: registry says ${r.capability}, route says ${e!.capability}`,
      ).toBe(r.capability)
    },
  )

  it('places the guard before the handler, after any auth/tenant middleware', () => {
    const problems: string[] = []
    for (const r of [...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS]) {
      const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', r.file), 'utf8')
      const esc = r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const decl = new RegExp(
        `${r.router}\\s*\\.\\s*${r.method.toLowerCase()}\\s*\\(\\s*'${esc}'\\s*,([\\s\\S]{0,240}?)(?:async\\s*\\(|\\(\\s*_?req)`,
      )
      const head = decl.exec(src)?.[1] ?? ''
      if (!head.includes(`requireCapability('${r.capability}')`)) {
        problems.push(`${r.file} ${r.method} ${r.path} is not guarded by ${r.capability} before its handler`)
      }
      // A guard that runs before requireTenant() would authorize outside tenant
      // context — the ordering ADR-014 fixes.
      if (/requireTenant/.test(head)) {
        const tenantAt = head.indexOf('requireTenant')
        const capAt = head.indexOf('requireCapability')
        if (capAt !== -1 && capAt < tenantAt) {
          problems.push(`${r.file} ${r.method} ${r.path}: capability guard runs before requireTenant()`)
        }
      }
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })

  it('stacks no ad-hoc role check on a migrated read', () => {
    const AD_HOC = /requireRole\(|\breq\.auth\??\.role\b|_requireAdmin\(|_requireRole\(/
    const problems: string[] = []
    for (const r of [...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS]) {
      const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', r.file), 'utf8')
      const esc = r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const decl = new RegExp(`${r.router}\\s*\\.\\s*${r.method.toLowerCase()}\\s*\\(\\s*'${esc}'\\s*,[\\s\\S]{0,600}`)
      const head = (decl.exec(src)?.[0] ?? '').split('\n').slice(0, 6).join('\n')
      if (AD_HOC.test(head)) problems.push(`${r.file} ${r.method} ${r.path} still carries an ad-hoc role check`)
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })
})

// ─── 3. The ratchet ───────────────────────────────────────────────────────────
describe('project-delivery read ratchet', () => {
  const registered   = new Set([...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS].map(key))
  const deferred     = new Set(DEFERRED_DELIVERY_READS.map(d => `${d.file} ${d.method} ${d.path}`))
  const highSens     = new Set(HIGH_SENSITIVITY_READS.map(key))
  const hsDeferred   = new Set(RECLASSIFIED_NOT_HIGH_SENSITIVITY_READS.map(r => `${r.file} ${r.method} ${r.path}`))
  const exceptions   = new Set(Object.keys(ENDPOINT_EXCEPTIONS))

  it('leaves no read-shaped endpoint in a delivery domain unaccounted for', () => {
    const unaccounted = endpoints.filter(e => {
      if (!isReadCandidate(e)) return false
      const paths = e.effective.length ? e.effective : [e.path]
      if (!paths.some(p => domainOf(p))) return false
      if (registered.has(e.key) || highSens.has(e.key) || exceptions.has(e.key)) return false
      if (deferred.has(`${e.file} ${e.method} ${e.path}`)) return false
      if (hsDeferred.has(`${e.file} ${e.method} ${e.path}`)) return false
      return true
    }).map(e => `${e.method} ${e.effective[0] ?? e.path}  (${e.key})`)

    expect(unaccounted,
      'unprotected project-delivery reads — register them in api/authz/projectDeliveryReads.ts ' +
      `or record why they are deferred:\n  ${unaccounted.join('\n  ')}`).toEqual([])
  })

  it('classifies every candidate exactly once', () => {
    // Registry entries carry the router variable; deferrals do not, so compare
    // on the identity both express.
    const registeredPlain = new Set([...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS]
      .map(r => `${r.file} ${r.method} ${r.path}`))
    const overlap = DEFERRED_DELIVERY_READS
      .map(d => `${d.file} ${d.method} ${d.path}`)
      .filter(k => registeredPlain.has(k))
    expect(overlap, `both registered and deferred: ${overlap.join(', ')}`).toEqual([])
  })

  it('accounts for every read-shaped endpoint the gate started from', () => {
    // 224 pending read-shaped endpoints at 7c99ac9 → registered + deferred, with
    // nothing lost. Deferrals also cover a few endpoints Phase 2B-1 recorded, so
    // the delivery classification must at least span what this gate closed.
    const closed = PROJECT_DELIVERY_READS.length + MIXED_PAYLOAD_DELIVERY_READS.length
    expect(closed + DEFERRED_DELIVERY_READS.length).toBe(224)
    expect(closed).toBe(108)
  })

  it('recognises a disposable unprotected delivery read', () => {
    // The §37 probe, evaluated through the same predicates the ratchet uses.
    const probe = {
      file: '_probe.ts', router: 'router', method: 'GET', path: '/engineering',
      effective: ['/api/v1/_authz-delivery-read-probe/engineering'],
    }
    expect(isReadCandidate(probe)).toBe(true)
    expect(domainOf(probe.effective[0])).toBe('engineering')
    expect(registered.has(key(probe))).toBe(false)
  })
})

// ─── 4. Perimeter separation and mixed payloads ───────────────────────────────
describe('the two read perimeters do not leak into each other', () => {
  it('shares no endpoint between the high-sensitivity and delivery registries', () => {
    const hs = new Set(HIGH_SENSITIVITY_READS.map(key))
    const overlap = [...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS]
      .map(key).filter(k => hs.has(k))
    expect(overlap,
      `an endpoint cannot hold two capabilities — a Phase 2B-1 read must not reappear here: ${overlap.join(', ')}`,
    ).toEqual([])
  })

  it('never weakens a Phase 2B-1 capability through a delivery guard', () => {
    // A delivery read guarded by a *high-sensitivity* capability is allowed —
    // that is the mixed-payload case — but the reverse, a commercial endpoint
    // demoted to a delivery capability, is not.
    const HS_CAPS = ['portfolio.view', 'project.list.all', 'cost.view', 'crm.view', 'audit.view', 'platform.admin']
    const demoted = HIGH_SENSITIVITY_READS.filter(r => {
      const e = byKey.get(key(r))
      return e && e.capability !== null && !HS_CAPS.includes(e.capability)
    }).map(r => `${r.file} ${r.method} ${r.path} → ${byKey.get(key(r))!.capability}`)
    expect(demoted, `high-sensitivity reads demoted to a weaker capability:\n  ${demoted.join('\n  ')}`).toEqual([])
  })

  it('guards every mixed payload no wider than the narrowest domain it discloses', () => {
    const problems: string[] = []
    for (const m of MIXED_PAYLOAD_DELIVERY_READS) {
      const guardHolders = holders(m.capability)
      expect(guardHolders.length, `${m.path}: guard ${m.capability} grants nobody`).toBeGreaterThan(0)
      for (const domainCap of m.contains) {
        const overshare = guardHolders.filter(r => !holders(domainCap).includes(r))
        if (overshare.length) {
          problems.push(`${m.file} ${m.method} ${m.path} guarded by ${m.capability} would disclose ${domainCap} to ${overshare.join(', ')}`)
        }
      }
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })

  it('uses no requireAnyCapability on a delivery read', () => {
    const problems: string[] = []
    for (const r of [...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS]) {
      const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', r.file), 'utf8')
      const esc = r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const decl = new RegExp(`${r.router}\\s*\\.\\s*${r.method.toLowerCase()}\\s*\\(\\s*'${esc}'\\s*,([\\s\\S]{0,240}?)(?:async\\s*\\(|\\(\\s*_?req)`)
      if (/requireAnyCapability\(/.test(decl.exec(src)?.[1] ?? '')) problems.push(`${r.file} ${r.method} ${r.path}`)
    }
    expect(problems, `an "any of" guard weakens a single-domain read:\n  ${problems.join('\n  ')}`).toEqual([])
  })
})

// ─── 5. Phase 1 parity for the twelve delivery capabilities ───────────────────
describe('server delivery authority equals Phase 1', () => {
  const GATE_CAPABILITIES = [
    'project.view', 'team.view', 'schedule.view', 'risk.view',
    'engineering.view', 'docs.view', 'construction.view', 'field.view',
    'quality.view', 'safety.view', 'procurement.view', 'commissioning.view',
  ] as const

  it.each(GATE_CAPABILITIES)('%s has the same holders on both sides', cap => {
    const server = holders(cap).sort()
    const client = USER_ROLES.filter(r => (CLIENT_ROLE_CAPS[r] as readonly string[]).includes(cap)).sort()
    expect(server, `server read policy has drifted from the Phase 1 projection for ${cap}`).toEqual(client)
  })

  it('matches the established delivery role model exactly', () => {
    const expected: Record<string, UserRole[]> = {
      'project.view':       ['owner', 'project_manager', 'engineer', 'procurement', 'field_ops', 'viewer'],
      'team.view':          ['owner', 'project_manager'],
      'schedule.view':      ['owner', 'project_manager', 'engineer'],
      'risk.view':          ['owner', 'project_manager', 'engineer'],
      'engineering.view':   ['owner', 'project_manager', 'engineer'],
      'docs.view':          ['owner', 'project_manager', 'engineer', 'procurement', 'field_ops', 'viewer'],
      'construction.view':  ['owner', 'project_manager', 'engineer', 'field_ops'],
      'field.view':         ['owner', 'project_manager', 'field_ops'],
      'quality.view':       ['owner', 'project_manager', 'engineer', 'field_ops'],
      'safety.view':        ['owner', 'project_manager', 'field_ops'],
      'procurement.view':   ['owner', 'project_manager', 'procurement'],
      'commissioning.view': ['owner', 'project_manager'],
    }
    for (const [cap, roles] of Object.entries(expected)) {
      expect(holders(cap).sort(), `${cap} holder set changed`).toEqual([...roles].sort())
    }
  })

  it('gives the platform administrator no delivery domain at all', () => {
    for (const cap of Object.values(DELIVERY_DOMAIN_CAPABILITY)) {
      expect(holders(cap), `admin must not hold ${cap}`).not.toContain('admin')
    }
    // …while keeping the platform authority Phase 2B-1 established.
    expect(holders('platform.admin')).toContain('admin')
    expect(holders('audit.view')).toContain('admin')
  })

  it('does not restore the Phase 2B-1 exclusions to the project manager', () => {
    for (const cap of ['portfolio.view', 'project.list.all', 'cost.view', 'crm.view', 'platform.admin', 'audit.view']) {
      expect(holders(cap), `PM must not hold ${cap}`).not.toContain('project_manager')
    }
  })
})

// ─── 6. Coverage arithmetic ───────────────────────────────────────────────────
describe('delivery read coverage arithmetic', () => {
  it('protects every confirmed in-scope delivery read', () => {
    const all = [...PROJECT_DELIVERY_READS, ...MIXED_PAYLOAD_DELIVERY_READS]
    const protectedCount = all.filter(r => byKey.get(key(r))?.capability === r.capability).length
    expect(protectedCount).toBe(all.length)
    expect(PENDING_DELIVERY_READS.length).toBe(0)
  })

  it('keeps the Phase 2B-1 perimeter intact', () => {
    const stillProtected = HIGH_SENSITIVITY_READS
      .filter(r => byKey.get(key(r))?.capability === r.capability).length
    expect(stillProtected, 'a Phase 2B-1 read lost or changed its guard').toBe(HIGH_SENSITIVITY_READS.length)
    // ADR-014 Phase 3B moved `projects.ts GET /` out of this gate and into
    // RECLASSIFIED_NOT_HIGH_SENSITIVITY_READS: it became a record-scoped
    // collection whose commercial columns are stripped per reader, so the
    // Owner-only guard this gate required no longer describes it. 127 → 126.
    expect(HIGH_SENSITIVITY_READS.length).toBe(126)
  })
})
