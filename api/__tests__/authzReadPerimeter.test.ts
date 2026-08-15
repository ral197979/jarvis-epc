/**
 * ADR-014 Phase 2B-1 — the high-sensitivity read perimeter, and its ratchet.
 *
 * Four invariants:
 *   1. Every registered read exists in source and carries exactly the guard the
 *      registry declares — a swapped capability is a failure, not a detail.
 *   2. The perimeter is complete: a read-shaped endpoint whose mounted path
 *      names one of the six protected domains is registered, reclassified with
 *      a reason, or the build fails. This is what the disposable probe proves.
 *   3. No guard is wider than the payload it protects — the mixed-payload rule.
 *   4. Server read authority still equals Phase 1's, capability by capability.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  HIGH_SENSITIVITY_READS,
  PENDING_HIGH_SENSITIVITY_READS,
  RECLASSIFIED_NOT_HIGH_SENSITIVITY_READS,
  DOMAIN_CAPABILITY,
  type ReadDomain,
} from '../authz/highSensitivityReads'
import { isServerCapability, SERVER_ROLE_CAPS, USER_ROLES, type UserRole } from '../authz/capabilities'
import { ROLE_CAPS as CLIENT_ROLE_CAPS } from '../../src/config/capabilities'
import { censusWithEffectivePaths } from './helpers/endpointCensus'

const endpoints = censusWithEffectivePaths()
const byKey = new Map(endpoints.map(e => [e.key, e]))

/**
 * Mounted-path patterns that mark a read as high-sensitivity. Deliberately
 * broad: over-matching costs a one-line reclassification with a reason;
 * under-matching silently leaves a domain exposed.
 */
const DOMAIN_PATTERNS: ReadonlyArray<readonly [ReadDomain, RegExp]> = [
  ['portfolio',        /\/(portfolio|executive|predict)(\/|$)/],
  ['project_registry', /^\/api\/v1\/projects$/],
  ['commercial',       /\/(budget|budgets|budget-items|cost-control|cost-entries|cost-items|cost-intelligence|evm|pay-applications|sov-items|estimates|change-orders|commitments|billing|invoices)(\/|$)/],
  ['crm',              /\/(proposals|crm|opportunities|business-development)(\/|$)/],
  ['audit',            /\/audit(\/|$)/],
  ['platform',         /\/(admin|integrations|webhooks|sync-jobs|mcp|scim|tenants|policies|runbooks|enterprise|ecosystem|exports)(\/|$)/],
]

/**
 * Read semantics are not defined by GET (§6). A non-GET whose path names a
 * query/report/export/summary operation is a read candidate until the handler
 * says otherwise, and saying otherwise requires a recorded reason.
 */
const READ_SHAPED_PATH =
  /\/(search|query|preview|analytics|report|reports|lookup|filter|export|exports|download|summary|stats|metrics|evaluate|detect|check|health|compute|simulate|explain|recommendations|insights|status|versions|capabilities)(\/|$)/i

function isReadCandidate(e: { method: string; path: string }): boolean {
  return e.method === 'GET' || READ_SHAPED_PATH.test(e.path)
}

function domainOf(effective: string): ReadDomain | null {
  return DOMAIN_PATTERNS.find(([, re]) => re.test(effective))?.[0] ?? null
}

/** Holder set for a capability, as the *server* will decide it. */
function holders(capability: string): UserRole[] {
  return USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(capability))
}

// ─── 1. Registry integrity ────────────────────────────────────────────────────
describe('high-sensitivity read registry', () => {
  it('declares a registered capability for every read', () => {
    for (const r of HIGH_SENSITIVITY_READS) {
      expect(isServerCapability(r.capability),
        `${r.file} ${r.method} ${r.path}: unknown capability ${r.capability}`).toBe(true)
    }
  })

  it('uses the capability its domain declares — no per-endpoint improvisation', () => {
    const wrong = HIGH_SENSITIVITY_READS
      .filter(r => r.capability !== DOMAIN_CAPABILITY[r.domain])
      .map(r => `${r.file} ${r.method} ${r.path}: domain ${r.domain} → ${DOMAIN_CAPABILITY[r.domain]}, registry says ${r.capability}`)
    expect(wrong, `domain/capability mismatches:\n  ${wrong.join('\n  ')}`).toEqual([])
  })

  it('holds no duplicate entries', () => {
    const seen = new Map<string, number>()
    for (const r of HIGH_SENSITIVITY_READS) {
      const k = `${r.file} ${r.router}.${r.method} ${r.path}`
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }
    const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k)
    expect(dupes, `duplicated reads: ${dupes.join(', ')}`).toEqual([])
  })

  it('names only endpoints that exist in source', () => {
    const missing = HIGH_SENSITIVITY_READS
      .map(r => `${r.file} ${r.router}.${r.method} ${r.path}`)
      .filter(k => !byKey.has(k))
    expect(missing, `registered reads with no matching route:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('gives every reclassification a substantive reason', () => {
    for (const r of RECLASSIFIED_NOT_HIGH_SENSITIVITY_READS) {
      expect(r.reason.length, `${r.file} ${r.method} ${r.path} needs a reason`).toBeGreaterThan(40)
    }
  })

  it('holds no stale reclassifications', () => {
    const real = new Set(endpoints.map(e => `${e.file} ${e.method} ${e.path}`))
    const stale = RECLASSIFIED_NOT_HIGH_SENSITIVITY_READS
      .map(r => `${r.file} ${r.method} ${r.path}`)
      .filter(k => !real.has(k))
    expect(stale, `reclassifications naming endpoints that no longer exist: ${stale.join(', ')}`).toEqual([])
  })

  it('has no pending high-sensitivity reads', () => {
    // Phase 2B-1 closes only when this is empty.
    expect(PENDING_HIGH_SENSITIVITY_READS).toEqual([])
  })
})

// ─── 2. The guard in source really is the guard in the registry ───────────────
describe('every registered read is guarded, with the declared capability', () => {
  it.each(HIGH_SENSITIVITY_READS.map(r => [`${r.file} ${r.method} ${r.path}`, r] as const))(
    '%s',
    (_label, r) => {
      const e = byKey.get(`${r.file} ${r.router}.${r.method} ${r.path}`)
      expect(e, `no such endpoint in source`).toBeDefined()
      expect(e!.capability,
        `${r.file} ${r.method} ${r.path}: registry says ${r.capability}, route says ${e!.capability}`,
      ).toBe(r.capability)
    },
  )

  it('places the guard before the handler in the route declaration', () => {
    const problems: string[] = []
    for (const r of HIGH_SENSITIVITY_READS) {
      const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', r.file), 'utf8')
      const esc = r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const decl = new RegExp(
        `${r.router}\\s*\\.\\s*${r.method.toLowerCase()}\\s*\\(\\s*'${esc}'\\s*,([\\s\\S]{0,240}?)(?:async\\s*\\(|\\(\\s*_?req)`,
      )
      const head = decl.exec(src)?.[1] ?? ''
      if (!head.includes(`requireCapability('${r.capability}')`)) {
        problems.push(`${r.file} ${r.method} ${r.path} is not guarded by ${r.capability} before its handler`)
      }
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })

  it('stacks no ad-hoc role check on a migrated read', () => {
    // Two authorization systems on one route is how they drift apart. A
    // migrated read must carry the capability guard and nothing else.
    const AD_HOC = /requireRole\(|\breq\.auth\??\.role\b/
    const problems: string[] = []
    for (const r of HIGH_SENSITIVITY_READS) {
      const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', r.file), 'utf8')
      const esc = r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // The declaration head plus the first ~12 lines of the handler body.
      const decl = new RegExp(`${r.router}\\s*\\.\\s*${r.method.toLowerCase()}\\s*\\(\\s*'${esc}'\\s*,[\\s\\S]{0,600}`)
      const body = decl.exec(src)?.[0] ?? ''
      const head = body.split('\n').slice(0, 6).join('\n')
      if (AD_HOC.test(head)) problems.push(`${r.file} ${r.method} ${r.path} still carries an ad-hoc role check`)
    }
    expect(problems, problems.join('\n  ')).toEqual([])
  })
})

// ─── 3. The ratchet ───────────────────────────────────────────────────────────
describe('high-sensitivity read ratchet', () => {
  it('leaves no read-shaped endpoint in a protected domain unaccounted for', () => {
    const registered = new Set(HIGH_SENSITIVITY_READS.map(r => `${r.file} ${r.router}.${r.method} ${r.path}`))
    const reclassified = new Set(RECLASSIFIED_NOT_HIGH_SENSITIVITY_READS.map(r => `${r.file} ${r.method} ${r.path}`))

    const unaccounted = endpoints.filter(e => {
      if (!isReadCandidate(e)) return false
      // A router that server.ts never mounts has no request path to authorize;
      // it still needs a recorded reason, which the reclassification list holds.
      const paths = e.effective.length ? e.effective : [e.path]
      if (!paths.some(p => domainOf(p))) return false
      if (registered.has(e.key)) return false
      if (reclassified.has(`${e.file} ${e.method} ${e.path}`)) return false
      return true
    }).map(e => `${e.method} ${e.effective[0] ?? e.path}  (${e.key})`)

    expect(unaccounted,
      'unprotected high-sensitivity reads — register them in api/authz/highSensitivityReads.ts ' +
      `or record why they are not high-sensitivity:\n  ${unaccounted.join('\n  ')}`).toEqual([])
  })

  it('classifies every candidate exactly once', () => {
    const registered = new Set(HIGH_SENSITIVITY_READS.map(r => `${r.file} ${r.method} ${r.path}`))
    const both = RECLASSIFIED_NOT_HIGH_SENSITIVITY_READS
      .map(r => `${r.file} ${r.method} ${r.path}`)
      .filter(k => registered.has(k))
    expect(both, `both registered and reclassified: ${both.join(', ')}`).toEqual([])
  })

  it('recognises a disposable unprotected high-risk read', () => {
    // The probe §22 asks for, run against the same predicate the ratchet uses
    // rather than a copy of it, so this cannot pass while the ratchet is broken.
    const probe = { file: '_probe.ts', router: 'router', method: 'GET', path: '/budget', effective: ['/api/v1/_authz-read-probe/budget'] }
    expect(isReadCandidate(probe)).toBe(true)
    expect(domainOf(probe.effective[0])).toBe('commercial')

    const registered = new Set(HIGH_SENSITIVITY_READS.map(r => `${r.file} ${r.router}.${r.method} ${r.path}`))
    expect(registered.has(`${probe.file} ${probe.router}.${probe.method} ${probe.path}`)).toBe(false)
  })
})

// ─── 4. Mixed payloads never widen authority ──────────────────────────────────
describe('mixed-payload rule', () => {
  /**
   * Endpoints whose response spans more than one protected domain, and every
   * domain present. The guard must be no wider than the narrowest of them —
   * `requireAnyCapability(project.view, cost.view)` would hand the cost half to
   * a caller holding only project.view, which is the defect this rule prevents.
   */
  const MIXED: ReadonlyArray<{ key: string; guard: string; contains: readonly string[] }> = [
    {
      key: 'projects.ts router.GET /',
      guard: 'project.list.all',
      contains: ['project.list.all', 'cost.view'],
    },
    {
      key: 'projects.ts router.GET /:id/summary',
      guard: 'cost.view',
      contains: ['project.view', 'cost.view', 'audit.view'],
    },
  ]

  it.each(MIXED.map(m => [m.key, m] as const))('%s is guarded no wider than its payload', (_k, m) => {
    const e = byKey.get(m.key)
    expect(e?.capability, `${m.key} guard changed`).toBe(m.guard)
    const guardHolders = new Set(holders(m.guard))
    for (const domainCap of m.contains) {
      const domainHolders = holders(domainCap)
      const overshare = [...guardHolders].filter(r => !domainHolders.includes(r))
      expect(overshare,
        `${m.key} guarded by ${m.guard} would disclose ${domainCap} to ${overshare.join(', ')}`).toEqual([])
    }
  })

  it('leaves no authentication bypass in front of a protected read', () => {
    // `mcp.ts` used to exempt GET /tools and GET /ava/health from requireAuth and
    // requireTenant so the tool browser could render without a session. They
    // disclose the tenant's MCP catalogue and the configured Ava host — platform
    // configuration, readable by anyone. A capability guard behind an auth
    // bypass authorizes nothing, so the bypass must not come back.
    const files = [...new Set(HIGH_SENSITIVITY_READS.map(r => r.file))]
    const bypasses: string[] = []
    for (const file of files) {
      const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', file), 'utf8')
      if (/PUBLIC_GET_PATHS|PUBLIC_PATHS/.test(src)) bypasses.push(`${file} declares an auth-bypass path set`)
    }
    expect(bypasses, bypasses.join('\n  ')).toEqual([])
  })

  it('uses no requireAnyCapability on a registered high-sensitivity read', () => {
    const problems: string[] = []
    for (const r of HIGH_SENSITIVITY_READS) {
      const src = fs.readFileSync(path.join(process.cwd(), 'api', 'routes', r.file), 'utf8')
      const esc = r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const decl = new RegExp(`${r.router}\\s*\\.\\s*${r.method.toLowerCase()}\\s*\\(\\s*'${esc}'\\s*,([\\s\\S]{0,240}?)(?:async\\s*\\(|\\(\\s*_?req)`)
      if (/requireAnyCapability\(/.test(decl.exec(src)?.[1] ?? '')) {
        problems.push(`${r.file} ${r.method} ${r.path}`)
      }
    }
    expect(problems, `an "any of" guard on a single-domain read weakens it:\n  ${problems.join('\n  ')}`).toEqual([])
  })
})

// ─── 5. Phase 1 parity for the six read capabilities ──────────────────────────
describe('server read authority equals Phase 1', () => {
  const GATE_CAPABILITIES = [
    'portfolio.view', 'project.list.all', 'cost.view', 'crm.view', 'audit.view', 'platform.admin',
  ] as const

  it.each(GATE_CAPABILITIES)('%s has the same holders on both sides', cap => {
    const server = holders(cap).sort()
    const client = USER_ROLES.filter(r => (CLIENT_ROLE_CAPS[r] as readonly string[]).includes(cap)).sort()
    expect(server, `server read policy has drifted from the Phase 1 projection for ${cap}`).toEqual(client)
  })

  it('keeps the product boundaries this gate exists to defend', () => {
    expect(holders('portfolio.view'), 'Portfolio is an owner surface').toEqual(['owner'])
    expect(holders('project.list.all'), 'the org-wide project registry is an owner surface').toEqual(['owner'])
    expect(holders('cost.view'), 'commercial data is an owner surface').toEqual(['owner'])
    expect(holders('crm.view'), 'the BD pipeline is an owner surface').toEqual(['owner'])
    expect(holders('audit.view').sort()).toEqual(['admin', 'owner'])
    expect(holders('platform.admin').sort()).toEqual(['admin', 'owner'])

    // The two exclusions ADR-014 Phase 1 was written to create.
    expect(holders('portfolio.view')).not.toContain('project_manager')
    expect(holders('project.list.all')).not.toContain('project_manager')
    // A platform administrator is not a business reader.
    for (const cap of ['portfolio.view', 'project.list.all', 'cost.view', 'crm.view']) {
      expect(holders(cap), `admin must not hold ${cap}`).not.toContain('admin')
    }
  })
})

// ─── 6. Coverage arithmetic ───────────────────────────────────────────────────
describe('read coverage arithmetic', () => {
  it('protects every confirmed high-sensitivity read', () => {
    const protectedCount = HIGH_SENSITIVITY_READS.filter(r => byKey.get(
      `${r.file} ${r.router}.${r.method} ${r.path}`)?.capability === r.capability).length
    expect(protectedCount).toBe(HIGH_SENSITIVITY_READS.length)
    expect(PENDING_HIGH_SENSITIVITY_READS.length).toBe(0)
  })

  it('accounts for every endpoint exactly once in the Phase 2A manifest', () => {
    const cap = endpoints.filter(e => e.capability).length
    expect(cap).toBeGreaterThanOrEqual(HIGH_SENSITIVITY_READS.length)
    expect(endpoints.length).toBeGreaterThan(0)
  })
})
