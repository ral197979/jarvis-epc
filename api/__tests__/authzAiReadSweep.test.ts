/**
 * ADR-014 Phase 2B-3 — role sweeps across every AI / cross-domain read.
 *
 * Expected admission is computed from the capability EXPRESSION: a role passes
 * only if it holds every capability in the conjunction. Nothing is
 * hand-maintained per endpoint, so a grant change moves the expectation and the
 * real guard together, and a disagreement between them is what fails.
 *
 * The requirement under test is read from the ROUTE SOURCE, not the registry,
 * so an endpoint that has quietly lost a capability is swept as it now is.
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
import { requireCapability, requireAllCapabilities } from '../authz/requireCapability'
import { roleHasCapability } from '../authz/capabilities'
import {
  AI_CROSS_DOMAIN_READS,
  TEMPORARY_CROSS_DOMAIN_CAPABILITY,
  type AiReadCategory,
} from '../authz/aiCrossDomainReads'
import { censusWithEffectivePaths } from './helpers/endpointCensus'

const census = new Map(censusWithEffectivePaths().map(e => [e.key, e]))

interface SweptRead {
  label:    string
  category: AiReadCategory
  method:   string
  /** From source — deliberately not the registry's `allOf`. */
  allOf:    string[]
  sources:  readonly string[]
}

const READS: SweptRead[] = AI_CROSS_DOMAIN_READS.map(r => {
  const e = census.get(`${r.file} ${r.router}.${r.method} ${r.path}`)
  return {
    label:    `${r.method} ${e?.effective[0] ?? r.path}`,
    category: r.category,
    method:   r.method,
    allOf:    e?.allCapabilities ?? [],
    sources:  r.sources,
  }
})

let current: TestPrincipal
beforeEach(() => {
  mockQuery.mockReset()
  mockQuery.mockImplementation(principalQuery(() => current))
})

/** The read's guard, mounted alone, memoised per (requirement, method). */
const apps = new Map<string, express.Express>()
function readApp(allOf: string[], method: string) {
  const k = `${allOf.join('&')}|${method}`
  const cached = apps.get(k)
  if (cached) return cached
  const app = express()
  app.use(express.json())
  app.use(authMiddlewareFor(() => current))
  const guard = allOf.length > 1
    ? requireAllCapabilities(...(allOf as never[]))
    : requireCapability(allOf[0] as never)
  app[method.toLowerCase() as 'get' | 'post' | 'patch']('/r', guard,
    (_req, res) => { res.json({ disclosed: true }) })
  apps.set(k, app)
  return app
}

const call = (r: SweptRead) => {
  const agent = request(readApp(r.allOf, r.method))
  const verb = r.method.toLowerCase() as 'get' | 'post' | 'patch'
  return verb === 'get' ? agent.get('/r') : agent[verb]('/r').send({})
}

/** What the capability expression says the role should reach. */
const shouldPass = (role: string, r: SweptRead) => r.allOf.every(c => roleHasCapability(role, c))

async function sweep(role: Parameters<typeof principal>[0]['role']) {
  current = principal({ role })
  const admitted: string[] = [], denied: string[] = [], unexpected: string[] = []
  for (const r of READS) {
    const res = await call(r)
    if (res.status === 200) admitted.push(r.label)
    else if (res.status === 403) denied.push(r.label)
    else unexpected.push(`${r.label} → ${res.status}`)
  }
  return { admitted, denied, unexpected }
}

const inCategory = (c: AiReadCategory) => READS.filter(r => r.category === c)
const withSource = (s: string) => READS.filter(r => r.sources.includes(s))
const temporary = () => READS.filter(r => r.allOf.length === 1 && r.allOf[0] === TEMPORARY_CROSS_DOMAIN_CAPABILITY)

describe('the sweep exercises a real, fully guarded AI surface', () => {
  it('finds a source requirement for every registered read', () => {
    const unguarded = READS.filter(r => !r.allOf.length).map(r => r.label)
    expect(unguarded, `reads with no guard in source:\n  ${unguarded.join('\n  ')}`).toEqual([])
    expect(READS.length).toBe(AI_CROSS_DOMAIN_READS.length)
  })

  it('covers all four categories', () => {
    for (const c of ['AI_GOVERNANCE_READ', 'DOMAIN_AI_READ', 'CROSS_DOMAIN_AI_READ', 'OPS_OR_READINESS_AGGREGATE'] as const) {
      expect(inCategory(c).length, `no reads registered for ${c}`).toBeGreaterThan(0)
    }
  })
})

// ─── Every role agrees with its capability expression (§45) ───────────────────
describe.each(ALL_ROLES)('%s', role => {
  it('is admitted to exactly the reads its capabilities satisfy', async () => {
    const { admitted, denied, unexpected } = await sweep(role)
    const expected = READS.filter(r => shouldPass(role, r)).map(r => r.label)
    expect(unexpected, `non-200/403 outcomes: ${unexpected.join(', ')}`).toEqual([])
    expect([...admitted].sort(), `${role} admissions disagree with the capability expression`)
      .toEqual([...expected].sort())
    expect(admitted.length + denied.length).toBe(READS.length)
  })
})

// ─── assistant.use is not data authority (§6) ─────────────────────────────────
describe('AI use never yields source data the role cannot read directly', () => {
  it('denies every cost-bearing AI read to the roles without cost.view', async () => {
    const costReads = withSource('cost')
    expect(costReads.length).toBeGreaterThan(0)
    for (const role of ['project_manager', 'engineer', 'procurement'] as const) {
      expect(roleHasCapability(role, 'assistant.use'), `${role} should hold assistant.use`).toBe(true)
      expect(roleHasCapability(role, 'cost.view')).toBe(false)
      current = principal({ role })
      for (const r of costReads) {
        expect((await call(r)).status, `${role} holds assistant.use but must not read ${r.label}`).toBe(403)
      }
    }
  })

  it('denies a procurement user the engineering assistant surface', async () => {
    // §6, stated literally: assistant.use must not carry engineering data.
    expect(roleHasCapability('procurement', 'assistant.use')).toBe(true)
    expect(roleHasCapability('procurement', 'engineering.view')).toBe(false)
    current = principal({ role: 'procurement' })
    for (const r of withSource('engineering')) {
      expect((await call(r)).status, `procurement must not read ${r.label}`).toBe(403)
    }
  })

  it('admits a role only where it holds both AI authority and the domain', async () => {
    // The RFI copilot is the one single-domain assistant read: construction.
    const rfi = READS.find(r => r.label.includes('/copilot') && r.sources.includes('construction') && r.sources.length === 1)
    expect(rfi, 'expected a bounded single-domain assistant read').toBeDefined()

    current = principal({ role: 'engineer' })   // assistant.use + construction.view
    expect((await call(rfi!)).status).toBe(200)

    current = principal({ role: 'field_ops' })  // construction.view, no assistant.use
    expect((await call(rfi!)).status, 'domain access alone must not open an assistant').toBe(403)

    current = principal({ role: 'procurement' }) // assistant.use, no construction.view
    expect((await call(rfi!)).status, 'AI access alone must not open a domain').toBe(403)
  })
})

// ─── ai.govern is not business-data authority (§8, §51) ───────────────────────
describe('Platform Administrator governs AI without reading the business', () => {
  it('is admitted to the AI governance surface', async () => {
    current = principal({ role: 'admin' })
    for (const r of inCategory('AI_GOVERNANCE_READ')) {
      expect((await call(r)).status, `admin should govern ${r.label}`).toBe(200)
    }
  })

  it('is denied every AI read that discloses business data', async () => {
    current = principal({ role: 'admin' })
    const business = READS.filter(r => !r.sources.includes('ai-governance'))
    expect(business.length).toBeGreaterThan(0)
    for (const r of business) {
      expect((await call(r)).status, `ai.govern must not open ${r.label}`).toBe(403)
    }
  })

  it('reports exact counts', async () => {
    const { admitted, denied, unexpected } = await sweep('admin')
    expect(unexpected).toEqual([])
    expect(admitted.length).toBe(inCategory('AI_GOVERNANCE_READ').length)
    expect(denied.length).toBe(READS.length - admitted.length)
  })
})

// ─── Viewer (§46) and Field Ops (§47) lack assistant.use ──────────────────────
describe('AI authority is not inferred from domain visibility', () => {
  it('denies the viewer every AI read despite project and document access', async () => {
    expect(roleHasCapability('viewer', 'project.view')).toBe(true)
    expect(roleHasCapability('viewer', 'docs.view')).toBe(true)
    expect(roleHasCapability('viewer', 'assistant.use')).toBe(false)
    const { admitted, denied, unexpected } = await sweep('viewer')
    expect(unexpected).toEqual([])
    expect(admitted, `viewer reached: ${admitted.join(', ')}`).toEqual([])
    expect(denied.length).toBe(READS.length)
  })

  it('denies field ops the assistant surfaces over domains it owns', async () => {
    expect(roleHasCapability('field_ops', 'field.view')).toBe(true)
    expect(roleHasCapability('field_ops', 'construction.view')).toBe(true)
    expect(roleHasCapability('field_ops', 'assistant.use')).toBe(false)
    current = principal({ role: 'field_ops' })
    for (const r of [...inCategory('DOMAIN_AI_READ'), ...inCategory('CROSS_DOMAIN_AI_READ')]) {
      expect((await call(r)).status, `field_ops must not read ${r.label}`).toBe(403)
    }
  })
})

// ─── Project Manager (§50) — the primary assertion ────────────────────────────
describe('Project Manager gains no closed domain through AI', () => {
  it('is denied every AI read that touches cost, portfolio, CRM or audit', async () => {
    current = principal({ role: 'project_manager' })
    const closed = READS.filter(r => ['cost', 'portfolio', 'crm', 'audit'].some(d => r.sources.includes(d)))
    expect(closed.length).toBeGreaterThan(0)
    for (const r of closed) {
      expect((await call(r)).status, `PM must not read ${r.label}`).toBe(403)
    }
  })

  it('is denied every unbounded cross-domain read', async () => {
    current = principal({ role: 'project_manager' })
    for (const r of temporary()) {
      expect((await call(r)).status, `PM must not read ${r.label}`).toBe(403)
    }
  })

  it('still reaches the operational aggregates its delivery capabilities open', async () => {
    current = principal({ role: 'project_manager' })
    for (const r of inCategory('OPS_OR_READINESS_AGGREGATE')) {
      expect((await call(r)).status, `PM should read ${r.label}`).toBe(200)
    }
  })
})

// ─── Engineer (§49) and Procurement (§48) ─────────────────────────────────────
describe('Engineer', () => {
  it('is denied cost, procurement, commissioning and governance AI', async () => {
    current = principal({ role: 'engineer' })
    const denied = READS.filter(r =>
      r.sources.some(s => ['cost', 'procurement', 'commissioning', 'portfolio', 'crm', 'ai-governance'].includes(s)) ||
      r.allOf.includes(TEMPORARY_CROSS_DOMAIN_CAPABILITY))
    expect(denied.length).toBeGreaterThan(0)
    for (const r of denied) {
      expect((await call(r)).status, `engineer must not read ${r.label}`).toBe(403)
    }
  })
})

describe('Procurement', () => {
  it('holds AI authority yet reaches no domain it lacks', async () => {
    expect(roleHasCapability('procurement', 'assistant.use')).toBe(true)
    const { admitted, unexpected } = await sweep('procurement')
    expect(unexpected).toEqual([])
    for (const label of admitted) {
      const r = READS.find(x => x.label === label)!
      for (const c of r.allOf) {
        expect(roleHasCapability('procurement', c), `${label} admitted without ${c}`).toBe(true)
      }
    }
  })
})

// ─── Owner (§52) ──────────────────────────────────────────────────────────────
describe('Owner crosses every AI authorization boundary', () => {
  it('is admitted to every registered read', async () => {
    const { admitted, denied, unexpected } = await sweep('owner')
    expect(unexpected).toEqual([])
    expect(denied, `owner was denied: ${denied.join(', ')}`).toEqual([])
    expect(admitted.length).toBe(READS.length)
  })

  it('is the only holder of the temporary cross-domain capability', async () => {
    for (const role of ALL_ROLES.filter(r => r !== 'owner')) {
      expect(roleHasCapability(role, TEMPORARY_CROSS_DOMAIN_CAPABILITY), `${role} holds it`).toBe(false)
    }
  })
})

// ─── Stale JWT on an AI read (§56) ────────────────────────────────────────────
describe('the database role governs AI authorization', () => {
  it('denies an engineering assistant read when the token says project_manager and the database says viewer', async () => {
    current = principal({ role: 'viewer', jwtRole: 'project_manager' })
    const res = await call({ label: 'x', category: 'DOMAIN_AI_READ', method: 'GET',
                             allOf: ['assistant.use', 'engineering.view'], sources: ['engineering'] })
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
  })

  it('admits a caller whose current role is broader than a stale narrow token', async () => {
    current = principal({ role: 'owner', jwtRole: 'viewer' })
    const res = await call({ label: 'x', category: 'CROSS_DOMAIN_AI_READ', method: 'GET',
                             allOf: [TEMPORARY_CROSS_DOMAIN_CAPABILITY], sources: ['any'] })
    expect(res.status).toBe(200)
  })

  it('denies a deactivated owner', async () => {
    current = principal({ role: 'owner', active: false })
    expect((await call({ label: 'x', category: 'CROSS_DOMAIN_AI_READ', method: 'GET',
                         allOf: [TEMPORARY_CROSS_DOMAIN_CAPABILITY], sources: ['any'] })).status).toBe(401)
  })

  it('denies an owner whose user row no longer exists', async () => {
    current = principal({ role: 'owner', exists: false })
    expect((await call({ label: 'x', category: 'AI_GOVERNANCE_READ', method: 'GET',
                         allOf: ['ai.govern'], sources: ['ai-governance'] })).status).toBe(401)
  })
})

// ─── requireAllCapabilities behaves as AND (§10) ──────────────────────────────
describe('requireAllCapabilities', () => {
  it('denies when any one capability is missing', async () => {
    current = principal({ role: 'engineer' })   // holds engineering.view, not cost.view
    const res = await call({ label: 'x', category: 'CROSS_DOMAIN_AI_READ', method: 'GET',
                             allOf: ['assistant.use', 'engineering.view', 'cost.view'], sources: ['engineering', 'cost'] })
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
  })

  it('admits only when every capability is held', async () => {
    current = principal({ role: 'owner' })
    expect((await call({ label: 'x', category: 'CROSS_DOMAIN_AI_READ', method: 'GET',
                         allOf: ['assistant.use', 'engineering.view', 'cost.view'], sources: ['engineering', 'cost'] })).status).toBe(200)
  })

  it('resolves the current user once, however many capabilities are required', async () => {
    current = principal({ role: 'owner' })
    mockQuery.mockClear()
    await call({ label: 'x', category: 'CROSS_DOMAIN_AI_READ', method: 'GET',
                 allOf: ['assistant.use', 'project.view', 'construction.view', 'risk.view', 'quality.view', 'cost.view'],
                 sources: ['any'] })
    const lookups = mockQuery.mock.calls.filter(args =>
      args.some(a => typeof a === 'string' && /FROM\s+users\s+WHERE\s+id/i.test(a)))
    expect(lookups.length, 'a six-capability conjunction must still cost one lookup').toBe(1)
  })

  it('fails closed on an unknown capability and on an empty list', () => {
    expect(() => requireAllCapabilities('not.a.capability' as never)).toThrow(/unknown capability/)
    expect(() => requireAllCapabilities()).toThrow(/at least one/)
  })
})
