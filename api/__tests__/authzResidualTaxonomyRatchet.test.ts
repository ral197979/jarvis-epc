/**
 * ADR-014 Phase 2C-5 — the residual authorization taxonomy ratchet.
 *
 * The Phase 2 exit invariant is NOT `PENDING_PHASE2 === 2`. A count can be held
 * at two while a different endpoint quietly becomes pending. This file asserts
 * the EXACT remaining set, so substitution fails as loudly as growth:
 *
 *     PENDING_PHASE2 = { projects GET /:id, related GET /related/:source/:id }
 *     pending ordinary mutations = {}
 *
 * It also holds the source honest about the twelve endpoints Phase 2C-5
 * dispositioned. Every structural assertion here first proves it FOUND its
 * target (§35): a regex that stops matching, a renamed router or a moved file
 * fails the test instead of passing it vacuously.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ENDPOINT_EXCEPTIONS, endpointKey, type RouteClass } from '../authz/routeManifest'
import { RESIDUAL_ENDPOINTS, CONSEQUENTIAL_NOTE } from '../authz/residualTaxonomy'
import { censusWithEffectivePaths } from './helpers/endpointCensus'
import { USER_ROLES, SERVER_ROLE_CAPS, type UserRole } from '../authz/capabilities'

const endpoints = censusWithEffectivePaths()
const key = (r: { file: string; router: string; method: string; path: string }) =>
  `${r.file} ${r.router}.${r.method} ${r.path}`

const classOf = (e: { file: string; router: string; method: string; path: string; capability: string | null }): RouteClass => {
  const ex = ENDPOINT_EXCEPTIONS[endpointKey(e.file, e.router, e.method, e.path)]
  return ex ? ex.klass : e.capability ? 'CAPABILITY' : 'PENDING_PHASE2'
}

const routeSrc = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), 'api', 'routes', file), 'utf8')

const holders = (capability: string): UserRole[] =>
  USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(capability))

// ─── 1. The exact pending set ─────────────────────────────────────────────────
describe('ADR-014 Phase 2 exit: the exact pending set', () => {
  const pending = endpoints.filter(e => classOf(e) === 'PENDING_PHASE2')

  it('leaves exactly the two Phase-3-owned reads pending, and nothing else', () => {
    expect(pending.map(e => e.key).sort(),
      'the ONLY endpoints that may remain PENDING_PHASE2 are the two whose ' +
      'unresolved question is record scope, which Phase 3 owns').toEqual([
      'projects.ts router.GET /:id',
      'related.ts router.GET /related/:source/:id',
    ])
  })

  it('leaves no pending ordinary mutation anywhere', () => {
    expect(pending.filter(e => e.method !== 'GET').map(e => e.key)).toEqual([])
  })

  it('leaves the two pending reads genuinely reachable, so this is a real deferral', () => {
    // Non-vacuity: a deferral that pointed at a dead route would prove nothing.
    for (const e of pending) {
      expect(e.effective.length, `${e.key} must still be mounted`).toBeGreaterThan(0)
    }
    expect(pending.map(e => e.effective[0]).sort())
      .toEqual(['/api/v1/projects/:id', '/api/v1/related/:source/:id'])
  })

  it('classifies every endpoint, with none unclassified', () => {
    const KNOWN: RouteClass[] = [
      'CAPABILITY', 'PUBLIC', 'SERVICE_HMAC',
      'SERVICE_TOKEN', 'HYBRID_SERVICE_CAPABILITY', 'UNMOUNTED', 'PENDING_PHASE2',
    ]
    const counted = KNOWN
      .map(k => endpoints.filter(e => classOf(e) === k).length)
      .reduce((a, b) => a + b, 0)
    expect(counted, 'every endpoint carries exactly one known class').toBe(endpoints.length)
    expect(endpoints.length).toBeGreaterThan(700)
  })
})

// ─── 2. The twelve-endpoint ledger agrees with source ─────────────────────────
describe('the residual ledger describes the endpoints that actually exist', () => {
  it('covers exactly twelve endpoints', () => {
    expect(RESIDUAL_ENDPOINTS.length).toBe(12)
  })

  it('names a real endpoint on every row, with the class the census computes', () => {
    const byKey = new Map(endpoints.map(e => [e.key, e]))
    for (const r of RESIDUAL_ENDPOINTS) {
      const e = byKey.get(key(r))
      expect(e, `${key(r)}: no such endpoint in source`).toBeTruthy()
      expect(classOf(e!), `${key(r)}: ledger and census disagree`).toBe(r.disposition)
    }
  })

  it('leaves no residual endpoint carrying a user capability', () => {
    // These are machine or unreachable boundaries. If one acquires a capability
    // guard the ledger is wrong and must be revisited, not silently outgrown.
    const byKey = new Map(endpoints.map(e => [e.key, e]))
    for (const r of RESIDUAL_ENDPOINTS) {
      expect(byKey.get(key(r))!.capability, `${key(r)} unexpectedly carries a capability`).toBeNull()
    }
  })

  it('gives every row a substantive caller and authority, not a label', () => {
    for (const r of RESIDUAL_ENDPOINTS) {
      expect(r.caller.length, `${key(r)} needs a caller`).toBeGreaterThan(20)
      expect(r.authority.length, `${key(r)} needs an authority`).toBeGreaterThan(20)
    }
  })
})

// ─── 3. SCIM trust boundary, structurally ─────────────────────────────────────
describe('SCIM is behind a verified, revocable, tenant-bound service credential', () => {
  const src = routeSrc('scim.ts')

  it('applies requireScimToken router-wide, before every route declaration', () => {
    const guardAt = src.indexOf('scimRouter.use(requireScimToken)')
    expect(guardAt, 'the router-wide SCIM guard must exist').toBeGreaterThan(-1)

    const routes = [...src.matchAll(/scimRouter\.(get|post|put|patch|delete)\(/g)]
    expect(routes.length, 'expected the eight SCIM routes to be found').toBe(8)
    for (const m of routes) {
      expect(m.index!, `a SCIM route is declared before the guard`).toBeGreaterThan(guardAt)
    }
  })

  it('verifies the credential against a hashed, active, unexpired token row', () => {
    expect(src).toMatch(/createHash\('sha256'\)\.update\(rawToken\)/)
    expect(src).toMatch(/FROM scim_tokens/)
    expect(src).toMatch(/is_active=true/)
    expect(src).toMatch(/expires_at IS NULL OR expires_at > NOW\(\)/)
  })

  it('refuses a missing or unknown credential rather than falling through', () => {
    expect(src).toMatch(/Bearer token required/)
    expect(src).toMatch(/Invalid or expired SCIM token/)
  })

  it('binds tenant from the verified token row, never from the request', () => {
    expect(src, 'tenant comes off the token record').toMatch(/req\.scimTenantId\s*=\s*token\.tenant_id/)
    // Every handler must scope through the verified tenant, not a body/query value.
    const handlerTenants = [...src.matchAll(/const tenantId\s*=\s*req\.scimTenantId!/g)]
    expect(handlerTenants.length, 'every data handler binds the verified tenant').toBe(6)
    expect(src).not.toMatch(/scimTenantId\s*=\s*(req\.body|req\.query)/)
  })

  it('keeps the D7 role gate: SCIM may not assign owner, nor an unknown role', () => {
    expect(src).toMatch(/const SCIM_FORBIDDEN_ROLE = 'owner'/)
    expect(src).toMatch(/USER_ROLES as readonly string\[\]\)\.includes\(role\)/)
    // Applied on all three role-accepting mutations.
    expect([...src.matchAll(/_rejectScimRole\(/g)].length,
      'the role gate must be called on create, replace and patch').toBeGreaterThanOrEqual(4)
  })

  it('issues and revokes the credential behind a real administrative authority', () => {
    expect(src).toMatch(/adminRouter\.post\('\/tokens', requireCapability\('platform\.identity'\)[\s\S]{0,80}requireRole\('owner', 'admin'\)/)
    expect(src).toMatch(/adminRouter\.delete\('\/tokens\/:id', requireCapability\('platform\.identity'\)/)
    // Identity administration is the platform administrator's remit (ADR-014 D2),
    // so the holder set is owner + admin — and nothing wider. Pinned exactly so a
    // later grant to a delivery role has to be argued here.
    expect(holders('platform.identity')).toEqual(['owner', 'admin'])
    // The route additionally re-checks the live role, so a capability grant
    // alone would not be enough to mint a provisioning credential.
    expect(src).toMatch(/requireRole\('owner', 'admin'\)/)
  })

  it('records identity lifecycle as consequential without faking a transition', () => {
    const consequential = RESIDUAL_ENDPOINTS.filter(r => r.file === 'scim.ts' && r.consequential)
    expect(consequential.map(r => r.method).sort(), 'the four identity-lifecycle mutations')
      .toEqual(['DELETE', 'PATCH', 'POST', 'PUT'])
    expect(CONSEQUENTIAL_NOTE.registeredInTransitions).toBe(false)
    expect(CONSEQUENTIAL_NOTE.reason.length).toBeGreaterThan(40)
    expect(CONSEQUENTIAL_NOTE.compensatingControls.length).toBeGreaterThanOrEqual(5)
  })
})

// ─── 4. IoT hybrid: both halves exist and both fail closed ────────────────────
describe('IoT ingest carries two independently authenticated trust paths', () => {
  const src = routeSrc('iot.ts')

  it('guards both ingest routes with the hybrid guard, naming the human capability', () => {
    const guarded = [...src.matchAll(/iotRouter\.post\('([^']+)',\s*hybridIngestAuth\('([^']+)'\)/g)]
    expect(guarded.length, 'expected exactly the two hybrid ingest routes').toBe(2)
    expect(guarded.map(m => m[1]).sort()).toEqual(['/iot/ingest', '/sensors/:uid/readings'])
    for (const m of guarded) {
      expect(m[2], 'the human path must require platform.integrations').toBe('platform.integrations')
    }
  })

  it('decides the mode from the credential shape and never reconsiders it', () => {
    expect(src).toMatch(/const INGEST_TOKEN_SHAPE = \/\^\[0-9a-f\]\{64\}\$\/i/)
    // A token-shaped credential that does not resolve is refused, not retried.
    expect(src).toMatch(/if \(!resolved\) \{ res\.status\(401\)\.json\(\{ error: 'Invalid ingest token' \}\); return \}/)
  })

  it('binds tenant from the resolved token row on the service path', () => {
    expect(src).toMatch(/\(req as R\)\.tenantId = resolved\.tenantId/)
  })

  it('runs a real capability chain on the human path', () => {
    expect(src).toMatch(/requireAuth as unknown as RequestHandler/)
    expect(src).toMatch(/requireTenant\(\) as unknown as RequestHandler/)
    expect(src).toMatch(/requireCapability\(capability\)/)
  })

  it('keeps the human path narrow — owner and platform administrator only', () => {
    // Using an integration is platform administration (ADR-014 D2), so admin
    // holds it deliberately. No delivery, field, procurement or viewer role may.
    expect(holders('platform.integrations')).toEqual(['owner', 'admin'])
  })

  it('keeps ingest-credential issuance separate from ingest itself', () => {
    // Using an integration is integration administration; minting the credential
    // that drives it is platform.security. Conflating them would let the weaker
    // authority mint the stronger one.
    expect(src).toMatch(/authRouter\.post\('\/sensors\/tokens', requireCapability\('platform\.security'\)/)
  })
})

// ─── 5. denverMcp stays unreachable ───────────────────────────────────────────
describe('denverMcp is declared but has no request path', () => {
  const serverSrc = fs.readFileSync(path.join(process.cwd(), 'api', 'server.ts'), 'utf8')

  it('is never imported or mounted by server.ts', () => {
    expect(serverSrc, 'server.ts must not import the denverMcp route module')
      .not.toMatch(/from '\.\/routes\/denverMcp'/)
    expect(serverSrc, 'server.ts must not mount denverMcpRouter')
      .not.toMatch(/denverMcpRouter/)
  })

  it('computes zero effective paths for both endpoints', () => {
    const mcp = endpoints.filter(e => e.file === 'denverMcp.ts')
    expect(mcp.length, 'expected both denverMcp endpoints to be found').toBe(2)
    for (const e of mcp) {
      expect(e.effective, `${e.key} must have no mounted path`).toEqual([])
      expect(classOf(e)).toBe('UNMOUNTED')
    }
  })

  it('is the only unmounted surface, so UNMOUNTED cannot become a dumping ground', () => {
    const unmounted = endpoints.filter(e => classOf(e) === 'UNMOUNTED').map(e => e.key).sort()
    expect(unmounted).toEqual([
      'denverMcp.ts router.GET /tools',
      'denverMcp.ts router.POST /call',
    ])
    // And nothing else in the census may be mountless without being classified.
    const mountless = endpoints.filter(e => e.effective.length === 0).map(e => e.key).sort()
    expect(mountless, 'an unmounted endpoint must be classified UNMOUNTED').toEqual(unmounted)
  })

  it('stays flag-gated off wherever the flag is configured', () => {
    for (const f of ['.env.example', 'fly.toml', 'fly.staging.toml']) {
      const text = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
      expect(text, `${f} must keep DENVER_MCP_SERVER off`).toMatch(/DENVER_MCP_SERVER\s*=\s*"?false"?/)
    }
  })
})

// ─── 6. Read-authorized GETs create no durable work ───────────────────────────
describe('a GET authorized as a read does not create durable work', () => {
  const CASES = [
    { file: 'agentReadiness.ts', router: 'agentReadinessRouter', path: '/plan/:scope/:id' },
    { file: 'agentRisk.ts',      router: 'agentRiskRouter',      path: '/overview' },
  ] as const

  for (const c of CASES) {
    it(`${c.file} GET ${c.path} does not enqueue`, () => {
      const src = routeSrc(c.file)
      const esc = c.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`${c.router}\\.get\\('${esc}'[\\s\\S]*?\\n\\}\\)`)
      const body = re.exec(src)?.[0]
      expect(body, `${c.file} GET ${c.path}: handler not found — the ratchet must not pass vacuously`).toBeTruthy()
      expect(body!, 'a read handler must not enqueue durable work').not.toMatch(/enqueueTask\(/)
      expect(body!, 'and must read the existing task instead').toMatch(/latestTaskForScope\(/)
    })
  }

  it('keeps the durable-work creation path on a write capability', () => {
    // §20 Option B: the job is still creatable, just not by a reader.
    expect(routeSrc('agentRisk.ts'))
      .toMatch(/agentRiskRouter\.post\('\/analyze', requireCapability\('crossdomain\.write'\)/)
    // The readiness plan job is scheduled by the orchestrator, which is ai.govern.
    expect(routeSrc('agentReadiness.ts'))
      .toMatch(/agentReadinessRouter\.post\('\/coordinate', requireCapability\('ai\.govern'\)/)
  })

  it('still enqueues from the mutation routes, so the check is not vacuous', () => {
    expect(routeSrc('agentRisk.ts')).toMatch(/enqueueTask\(/)
    expect(routeSrc('agentReadiness.ts')).toMatch(/enqueueTask\(/)
  })
})

// ─── 7. Twin status is a write, guarded as one ────────────────────────────────
describe('twin status no longer relies on read authority', () => {
  it('guards PATCH /:twinId/status with crossdomain.write', () => {
    const src = routeSrc('twin.ts')
    const m = /router\.patch\('\/:twinId\/status', requireCapability\('([^']+)'\)/.exec(src)
    expect(m, 'the twin status route must exist').toBeTruthy()
    expect(m![1]).toBe('crossdomain.write')
  })

  it('keeps write authority strictly narrower than read authority', () => {
    const readers = holders('crossdomain.read')
    const writers = holders('crossdomain.write')
    expect(writers.length).toBeGreaterThan(0)
    for (const w of writers) {
      expect(readers, `${w} writes but cannot read — the matrix is inconsistent`).toContain(w)
    }
    expect(writers.length,
      'a write capability held by everyone who can read would be no correction at all')
      .toBeLessThanOrEqual(readers.length)
  })
})

// ─── 8. Viewer and platform-admin invariants (§29, §30) ───────────────────────
describe('closing the residual surface granted nobody new authority', () => {
  it('leaves the viewer strictly read-only — ADR-014 D3', () => {
    // D3 is "no action authority", not "no capability": the viewer legitimately
    // holds view capabilities. The invariant is that it holds NOTHING that can
    // change state or administer anything.
    const viewerCaps = SERVER_ROLE_CAPS['viewer'] as readonly string[]
    expect(viewerCaps.length, 'the viewer must still be able to see something').toBeGreaterThan(0)
    const mutating = viewerCaps.filter(c => !c.endsWith('.view'))
    expect(mutating, 'the viewer may hold only *.view capabilities').toEqual([])
  })

  it('keeps the viewer out of every capability Phase 2C-5 touched', () => {
    for (const cap of ['crossdomain.read', 'crossdomain.write', 'platform.integrations',
      'platform.identity', 'platform.security', 'personal.admin', 'personal.write', 'ai.govern']) {
      expect(holders(cap), `viewer must not hold ${cap}`).not.toContain('viewer')
    }
  })

  it('keeps the platform administrator out of tenant business authority — ADR-014 D2', () => {
    // "admin" is not a universal bypass. It holds platform administration and,
    // by Phase 2A §22, AI governance — and no delivery, commercial or personal
    // authority. Phase 2C-5 must not have widened that.
    const adminCaps = SERVER_ROLE_CAPS['admin'] as readonly string[]
    for (const cap of ['crossdomain.read', 'crossdomain.write', 'personal.admin', 'personal.write',
      'personal.view', 'cost.approve', 'project.write', 'construction.write', 'procurement.write']) {
      expect(adminCaps, `admin must not hold ${cap}`).not.toContain(cap)
    }
    // Non-vacuity: admin does hold its own platform authority.
    expect(adminCaps).toContain('platform.admin')
    expect(adminCaps).toContain('platform.identity')
  })

  it('grants the Phase 2C-5 capabilities to no role beyond owner and platform admin', () => {
    // Phase 2C-5 invented no capability; it reused existing ones. This pins the
    // holder set of each capability it leaned on, so a later widening to make
    // some route "work" has to be argued rather than slipped in.
    expect(holders('crossdomain.write')).toEqual(['owner'])
    expect(holders('crossdomain.read')).toEqual(['owner'])
    expect(holders('platform.integrations')).toEqual(['owner', 'admin'])
    expect(holders('platform.identity')).toEqual(['owner', 'admin'])
    expect(holders('platform.security')).toEqual(['owner'])
  })
})
