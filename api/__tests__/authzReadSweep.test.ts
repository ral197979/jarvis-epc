/**
 * ADR-014 Phase 2B-1 — role sweeps across every high-sensitivity read.
 *
 * Every (read, role) pair is driven through the real guard: the real
 * `requireCapability`, the real `resolveCurrentUser` database lookup, the real
 * `roleHasCapability` decision. Nothing injects an effective capability, and
 * `principal()` refuses to default a role, so no sweep can silently run as owner.
 *
 * The capability under test is read from the ROUTE SOURCE, not from the
 * registry, so a route wired to the wrong capability is swept with the wrong
 * capability and the mismatch surfaces here as well as in the perimeter test.
 *
 * Expected admission is derived from the server capability matrix rather than
 * hand-listed per endpoint — the alternative is 127 × 7 hand-maintained
 * expectations that would rot on the first grant change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: vi.fn(),
}))

import { principal, principalQuery, authMiddlewareFor, ALL_ROLES, type TestPrincipal } from './helpers/testPrincipal'
import { requireCapability } from '../authz/requireCapability'
import { roleHasCapability } from '../authz/capabilities'
import { HIGH_SENSITIVITY_READS, DOMAIN_CAPABILITY, type ReadDomain } from '../authz/highSensitivityReads'
import { censusWithEffectivePaths } from './helpers/endpointCensus'

const census = new Map(censusWithEffectivePaths().map(e => [e.key, e]))

/** Each registered read, paired with the capability its route source declares. */
const READS = HIGH_SENSITIVITY_READS.map(r => {
  const e = census.get(`${r.file} ${r.router}.${r.method} ${r.path}`)
  return {
    label:      `${r.method} ${e?.effective[0] ?? r.path}`,
    domain:     r.domain,
    method:     r.method,
    /** From source — deliberately not `r.capability`. */
    capability: e?.capability ?? '<UNGUARDED>',
  }
})

let current: TestPrincipal
beforeEach(() => {
  mockQuery.mockReset()
  mockQuery.mockImplementation(principalQuery(() => current))
})

/**
 * The read's guard, mounted alone, so only authorization is under test.
 *
 * Memoised per (capability, method): the sweep makes ~900 requests and the
 * principal is read through a getter, so one app per guard is both correct and
 * the difference between seconds and minutes.
 */
const apps = new Map<string, express.Express>()
function readApp(capability: string, method: string) {
  const key = `${capability}|${method}`
  const cached = apps.get(key)
  if (cached) return cached
  const app = express()
  app.use(express.json())
  app.use(authMiddlewareFor(() => current))
  const handler = (_req: express.Request, res: express.Response) => { res.json({ disclosed: true }) }
  const verb = method.toLowerCase() as 'get' | 'post'
  app[verb]('/r', requireCapability(capability as never), handler)
  apps.set(key, app)
  return app
}

async function call(r: { capability: string; method: string }) {
  const agent = request(readApp(r.capability, r.method))
  return r.method === 'GET' ? agent.get('/r') : agent.post('/r').send({})
}

/** One sweep of the whole registry as a role: admitted vs denied. */
async function sweep(role: Parameters<typeof principal>[0]['role']) {
  current = principal({ role })
  const admitted: string[] = []
  const denied: string[] = []
  const unexpected: string[] = []
  for (const r of READS) {
    const res = await call(r)
    if (res.status === 200) admitted.push(r.label)
    else if (res.status === 403) denied.push(r.label)
    else unexpected.push(`${r.label} → ${res.status}`)
  }
  return { admitted, denied, unexpected }
}

const DOMAINS: readonly ReadDomain[] = ['portfolio', 'project_registry', 'commercial', 'crm', 'audit', 'platform']
const inDomain = (d: ReadDomain) => READS.filter(r => r.domain === d)

describe('the sweep exercises a real, fully guarded perimeter', () => {
  it('finds a source guard for every registered read', () => {
    const unguarded = READS.filter(r => r.capability === '<UNGUARDED>').map(r => r.label)
    expect(unguarded, `reads with no guard in source:\n  ${unguarded.join('\n  ')}`).toEqual([])
    expect(READS.length).toBe(HIGH_SENSITIVITY_READS.length)
  })

  it('covers every domain that still has a high-sensitivity read', () => {
    // ADR-014 Phase 3B emptied `project_registry`: its only member,
    // `projects.ts GET /`, became a record-scoped collection whose commercial
    // columns are stripped per reader, so it moved to
    // RECLASSIFIED_NOT_HIGH_SENSITIVITY_READS. The domain is kept in the
    // pattern table — it still correctly classifies `/api/v1/projects` — but it
    // has no member to sweep, and asserting otherwise would force a fake entry.
    const EMPTIED_BY_PHASE_3B = new Set(['project_registry'])
    for (const d of DOMAINS) {
      if (EMPTIED_BY_PHASE_3B.has(d)) {
        expect(inDomain(d).length, `${d} is expected to be empty since Phase 3B`).toBe(0)
        continue
      }
      expect(inDomain(d).length, `no reads registered for ${d}`).toBeGreaterThan(0)
    }
    // Non-vacuity: the sweep must still cover the other five.
    expect(DOMAINS.filter(d => !EMPTIED_BY_PHASE_3B.has(d)).length).toBe(5)
  })
})

// ─── Viewer — the primary bypass proof (§18, §30) ─────────────────────────────
describe('Viewer is denied every high-sensitivity read', () => {
  it.each(READS.map(r => [`${r.label} (${r.capability})`, r] as const))('viewer cannot read %s', async (_l, r) => {
    current = principal({ role: 'viewer' })
    const res = await call(r)
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
  })

  it('attempts every read and succeeds at none', async () => {
    const { admitted, denied, unexpected } = await sweep('viewer')
    expect(unexpected, `non-403 denials: ${unexpected.join(', ')}`).toEqual([])
    expect(admitted, `viewer reached: ${admitted.join(', ')}`).toEqual([])
    expect(denied.length).toBe(READS.length)
  })
})

// ─── Platform Administrator (§13, §31) ────────────────────────────────────────
describe('Platform Administrator reads platform and audit — and nothing of the business', () => {
  it('is admitted to every platform and audit read', async () => {
    current = principal({ role: 'admin' })
    for (const r of READS.filter(x => x.domain === 'platform' || x.domain === 'audit')) {
      expect((await call(r)).status, `admin should read ${r.label}`).toBe(200)
    }
  })

  it('is denied portfolio, the project registry, commercial and CRM', async () => {
    current = principal({ role: 'admin' })
    const business = READS.filter(x => ['portfolio', 'project_registry', 'commercial', 'crm'].includes(x.domain))
    expect(business.length).toBeGreaterThan(0)
    for (const r of business) {
      expect((await call(r)).status, `admin must not read ${r.label}`).toBe(403)
    }
  })

  it('reports exact admitted and denied counts', async () => {
    const { admitted, denied, unexpected } = await sweep('admin')
    expect(unexpected).toEqual([])
    const platformish = inDomain('platform').length + inDomain('audit').length
    expect(admitted.length, 'admin admissions must be exactly the platform + audit reads').toBe(platformish)
    expect(denied.length).toBe(READS.length - platformish)
  })
})

// ─── Project Manager (§14, §32) ───────────────────────────────────────────────
describe('Project Manager is denied the whole high-sensitivity perimeter', () => {
  it('cannot reach portfolio, the org-wide registry, cost, CRM, audit or platform administration', async () => {
    const { admitted, denied, unexpected } = await sweep('project_manager')
    expect(unexpected).toEqual([])
    expect(admitted,
      'PM reached a high-sensitivity read — Phase 1 excludes every capability in this gate for PM: ' +
      admitted.join(', ')).toEqual([])
    expect(denied.length).toBe(READS.length)
  })

  it('does not regain project.list.all through the API', async () => {
    current = principal({ role: 'project_manager' })
    expect(roleHasCapability('project_manager', 'project.list.all')).toBe(false)
    for (const r of inDomain('project_registry')) {
      expect((await call(r)).status, `PM must not read ${r.label}`).toBe(403)
    }
  })

  it('holds delivery write authority yet still no commercial read', async () => {
    // The exact confusion §9 forbids: managing project workflow is not reading
    // project financials.
    expect(roleHasCapability('project_manager', 'project.write')).toBe(true)
    expect(roleHasCapability('project_manager', 'project.approve')).toBe(true)
    expect(roleHasCapability('project_manager', 'cost.view')).toBe(false)
    current = principal({ role: 'project_manager' })
    for (const r of inDomain('commercial')) {
      expect((await call(r)).status, `PM must not read ${r.label}`).toBe(403)
    }
  })
})

// ─── Engineer, Procurement, Field Ops (§15–§17, §33) ──────────────────────────
describe.each(['engineer', 'procurement', 'field_ops'] as const)('%s is denied the perimeter', role => {
  it('reaches no high-sensitivity read', async () => {
    const { admitted, denied, unexpected } = await sweep(role)
    expect(unexpected).toEqual([])
    expect(admitted, `${role} reached: ${admitted.join(', ')}`).toEqual([])
    expect(denied.length).toBe(READS.length)
  })
})

describe('domain responsibility never implies commercial or portfolio visibility', () => {
  it('denies Procurement cost reads despite procurement.view and procurement.write', async () => {
    expect(roleHasCapability('procurement', 'procurement.view')).toBe(true)
    expect(roleHasCapability('procurement', 'procurement.write')).toBe(true)
    expect(roleHasCapability('procurement', 'cost.view')).toBe(false)
    current = principal({ role: 'procurement' })
    for (const r of inDomain('commercial')) {
      expect((await call(r)).status, `procurement must not read ${r.label}`).toBe(403)
    }
  })

  it('denies Engineer commercial and portfolio reads despite engineering authority', async () => {
    expect(roleHasCapability('engineer', 'engineering.view')).toBe(true)
    expect(roleHasCapability('engineer', 'cost.view')).toBe(false)
    expect(roleHasCapability('engineer', 'portfolio.view')).toBe(false)
    current = principal({ role: 'engineer' })
    for (const r of [...inDomain('commercial'), ...inDomain('portfolio')]) {
      expect((await call(r)).status, `engineer must not read ${r.label}`).toBe(403)
    }
  })

  it('denies Field Ops the complete perimeter', async () => {
    current = principal({ role: 'field_ops' })
    for (const cap of ['portfolio.view', 'project.list.all', 'cost.view', 'crm.view', 'audit.view', 'platform.admin']) {
      expect(roleHasCapability('field_ops', cap), `field_ops holds ${cap}`).toBe(false)
    }
  })
})

// ─── Owner positive sweep (§12, §34) ──────────────────────────────────────────
describe('Owner crosses every high-sensitivity capability gate', () => {
  it('is admitted to every registered read', async () => {
    const { admitted, denied, unexpected } = await sweep('owner')
    expect(unexpected).toEqual([])
    expect(denied, `owner was denied: ${denied.join(', ')}`).toEqual([])
    expect(admitted.length).toBe(READS.length)
  })

  it('crossing authorization is not the same as HTTP 200 from a real handler', () => {
    // The sweep asserts the request passed the capability gate. A real route may
    // still 404 or 500 on a fixture that does not exist; that is downstream
    // handler behaviour, not an authorization result.
    expect(roleHasCapability('owner', 'cost.view')).toBe(true)
  })
})

// ─── Exhaustive matrix — no role reaches a capability it does not hold ────────
describe('every (read, role) pair agrees with the capability matrix', () => {
  /**
   * The sweeps above already drive every one of the seven roles against every
   * registered read over a real request, so this asserts the other half of the
   * composition: that the capability each ROUTE declares grants exactly the
   * roles Phase 1's matrix says it should. Re-issuing ~900 more HTTP requests
   * here would prove nothing the sweeps have not already proved, and the wall
   * clock is not free.
   */
  it('admits exactly the roles holding the read capability, and no others', () => {
    const disagreements: string[] = []
    for (const r of READS) {
      const granted = ALL_ROLES.filter(role => roleHasCapability(role, r.capability))
      if (!granted.length) disagreements.push(`${r.label} (${r.capability}): no role holds it — the read is unreachable`)
      for (const role of ALL_ROLES) {
        const shouldRead = granted.includes(role)
        // Nothing outside the domain's Phase 1 holder set may reach the read.
        const domainCap = DOMAIN_CAPABILITY[r.domain]
        if (shouldRead && !roleHasCapability(role, domainCap)) {
          disagreements.push(`${role} would reach ${r.label} via ${r.capability} without holding ${domainCap}`)
        }
      }
    }
    expect(disagreements, `route capability disagrees with the role matrix:\n  ${disagreements.join('\n  ')}`).toEqual([])
  })
})

// ─── Stale JWT on a high-sensitivity read (§35) ───────────────────────────────
describe('the database role is authoritative for reads too', () => {
  it.each(['cost.view', 'portfolio.view', 'audit.view'] as const)(
    'denies %s when the token says owner but the database says viewer',
    async capability => {
      current = principal({ role: 'viewer', jwtRole: 'owner' })
      const res = await call({ capability, method: 'GET' })
      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'forbidden' })
    },
  )

  it('denies a deactivated owner', async () => {
    current = principal({ role: 'owner', active: false })
    expect((await call({ capability: 'cost.view', method: 'GET' })).status).toBe(401)
  })

  it('denies an owner whose user row no longer exists', async () => {
    current = principal({ role: 'owner', exists: false })
    expect((await call({ capability: 'portfolio.view', method: 'GET' })).status).toBe(401)
  })
})
