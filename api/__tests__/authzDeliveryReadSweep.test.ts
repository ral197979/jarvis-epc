/**
 * ADR-014 Phase 2B-2 — role sweeps across every project-delivery read.
 *
 * Unlike Phase 2B-1, this perimeter is not "deny everything but owner": Phase 1
 * grants each of the six non-admin roles a different slice of it, and a viewer
 * legitimately reads project context and documents. So every expectation here is
 * DERIVED from the capability matrix — `roleHasCapability(role, requiredCap)` —
 * and compared against what the real guard actually does. There is not one
 * hand-maintained per-route exception, because 108 × 7 of them would rot on the
 * first grant change and would only ever restate the table they came from.
 *
 * The capability under test is read from the ROUTE SOURCE, not the registry, so
 * a route wired to the wrong capability is swept with the wrong capability.
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
import {
  PROJECT_DELIVERY_READS,
  MIXED_PAYLOAD_DELIVERY_READS,
  DELIVERY_DOMAIN_CAPABILITY,
  type DeliveryDomain,
} from '../authz/projectDeliveryReads'
import { censusWithEffectivePaths } from './helpers/endpointCensus'

const census = new Map(censusWithEffectivePaths().map(e => [e.key, e]))

interface SweptRead {
  label:      string
  domain:     DeliveryDomain | 'mixed'
  method:     string
  capability: string
}

const READS: SweptRead[] = [
  ...PROJECT_DELIVERY_READS.map(r => {
    const e = census.get(`${r.file} ${r.router}.${r.method} ${r.path}`)
    return {
      label:      `${r.method} ${e?.effective[0] ?? r.path}`,
      domain:     r.domain as DeliveryDomain | 'mixed',
      method:     r.method,
      capability: e?.capability ?? '<UNGUARDED>',   // from source, deliberately
    }
  }),
  ...MIXED_PAYLOAD_DELIVERY_READS.map(r => {
    const e = census.get(`${r.file} ${r.router}.${r.method} ${r.path}`)
    return {
      label:      `${r.method} ${e?.effective[0] ?? r.path}`,
      domain:     'mixed' as const,
      method:     r.method,
      capability: e?.capability ?? '<UNGUARDED>',
    }
  }),
]

let current: TestPrincipal
beforeEach(() => {
  mockQuery.mockReset()
  mockQuery.mockImplementation(principalQuery(() => current))
})

/** The read's guard, mounted alone, memoised per (capability, method). */
const apps = new Map<string, express.Express>()
function readApp(capability: string, method: string) {
  const k = `${capability}|${method}`
  const cached = apps.get(k)
  if (cached) return cached
  const app = express()
  app.use(express.json())
  app.use(authMiddlewareFor(() => current))
  const handler = (_req: express.Request, res: express.Response) => { res.json({ disclosed: true }) }
  app[method.toLowerCase() as 'get' | 'post']('/r', requireCapability(capability as never), handler)
  apps.set(k, app)
  return app
}

const call = (r: SweptRead) => {
  const agent = request(readApp(r.capability, r.method))
  return r.method === 'GET' ? agent.get('/r') : agent.post('/r').send({})
}

/** One sweep of the whole registry as a role. */
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

/** What the capability matrix says the role should reach. */
const expectedAdmissions = (role: string) =>
  READS.filter(r => roleHasCapability(role, r.capability))

const DOMAINS = Object.keys(DELIVERY_DOMAIN_CAPABILITY) as DeliveryDomain[]
const inDomain = (d: DeliveryDomain | 'mixed') => READS.filter(r => r.domain === d)

describe('the sweep exercises a real, fully guarded perimeter', () => {
  it('finds a source guard for every registered read', () => {
    const unguarded = READS.filter(r => r.capability === '<UNGUARDED>').map(r => r.label)
    expect(unguarded, `reads with no guard in source:\n  ${unguarded.join('\n  ')}`).toEqual([])
    expect(READS.length).toBe(PROJECT_DELIVERY_READS.length + MIXED_PAYLOAD_DELIVERY_READS.length)
  })

  it('covers all twelve delivery domains', () => {
    for (const d of DOMAINS) expect(inDomain(d).length, `no reads registered for ${d}`).toBeGreaterThan(0)
  })
})

// ─── Every role agrees with the matrix, endpoint by endpoint (§41–§47) ────────
describe.each(ALL_ROLES)('%s', role => {
  it('is admitted to exactly the reads its capabilities open', async () => {
    const { admitted, denied, unexpected } = await sweep(role)
    const expected = expectedAdmissions(role).map(r => r.label)

    expect(unexpected, `non-200/403 outcomes: ${unexpected.join(', ')}`).toEqual([])
    expect([...admitted].sort(), `${role} admissions disagree with the capability matrix`)
      .toEqual([...expected].sort())
    expect(admitted.length + denied.length).toBe(READS.length)
  })
})

// ─── Viewer (§11, §41) — not "deny everything" ────────────────────────────────
describe('Viewer reads project context and documents, and nothing else', () => {
  it('is admitted to the project and docs domains', async () => {
    current = principal({ role: 'viewer' })
    for (const r of [...inDomain('project'), ...inDomain('docs')]) {
      expect((await call(r)).status, `viewer should read ${r.label}`).toBe(200)
    }
  })

  it('is denied every other delivery domain', async () => {
    current = principal({ role: 'viewer' })
    const others = DOMAINS.filter(d => d !== 'project' && d !== 'docs')
    for (const r of [...others.flatMap(inDomain), ...inDomain('mixed')]) {
      expect((await call(r)).status, `viewer must not read ${r.label}`).toBe(403)
    }
  })

  it('reports exact counts', async () => {
    const { admitted, denied } = await sweep('viewer')
    expect(admitted.length).toBe(inDomain('project').length + inDomain('docs').length)
    expect(denied.length).toBe(READS.length - admitted.length)
  })
})

// ─── Platform Administrator (§6, §42) — the primary product boundary ──────────
describe('Platform Administrator receives no project-delivery read', () => {
  it('is denied every one', async () => {
    const { admitted, denied, unexpected } = await sweep('admin')
    expect(unexpected).toEqual([])
    expect(admitted,
      'admin reached a delivery read — a platform administrator is not a delivery role: ' +
      admitted.join(', ')).toEqual([])
    expect(denied.length).toBe(READS.length)
  })

  it('holds none of the twelve delivery capabilities', () => {
    for (const cap of Object.values(DELIVERY_DOMAIN_CAPABILITY)) {
      expect(roleHasCapability('admin', cap), `admin holds ${cap}`).toBe(false)
    }
  })
})

// ─── Project Manager (§7, §43) ────────────────────────────────────────────────
describe('Project Manager reads the delivery surface but not the closed perimeter', () => {
  it('is admitted to all twelve delivery domains', async () => {
    current = principal({ role: 'project_manager' })
    for (const r of DOMAINS.flatMap(inDomain)) {
      expect((await call(r)).status, `PM should read ${r.label}`).toBe(200)
    }
  })

  it('is still denied the Phase 2B-1 perimeter', async () => {
    current = principal({ role: 'project_manager' })
    for (const cap of ['portfolio.view', 'project.list.all', 'cost.view', 'crm.view', 'audit.view', 'platform.admin']) {
      expect((await call({ label: cap, domain: 'mixed', method: 'GET', capability: cap })).status,
        `PM must not hold ${cap}`).toBe(403)
    }
    // …including the mixed schedule+cost reads this gate guarded with cost.view.
    for (const r of inDomain('mixed')) {
      expect((await call(r)).status, `PM must not read ${r.label}`).toBe(403)
    }
  })
})

// ─── Engineer (§8, §44) ───────────────────────────────────────────────────────
describe('Engineer', () => {
  const GRANTED = ['project', 'schedule', 'risk', 'engineering', 'docs', 'construction', 'quality'] as const
  const DENIED  = ['team', 'field', 'safety', 'procurement', 'commissioning'] as const

  it('reads its established delivery domains', async () => {
    current = principal({ role: 'engineer' })
    for (const r of GRANTED.flatMap(inDomain)) {
      expect((await call(r)).status, `engineer should read ${r.label}`).toBe(200)
    }
  })

  it('is denied procurement, commissioning, team, field and safety', async () => {
    current = principal({ role: 'engineer' })
    for (const r of DENIED.flatMap(inDomain)) {
      expect((await call(r)).status, `engineer must not read ${r.label}`).toBe(403)
    }
  })
})

// ─── Field Ops (§9, §45) ──────────────────────────────────────────────────────
describe('Field Ops', () => {
  const GRANTED = ['project', 'field', 'construction', 'quality', 'safety', 'docs'] as const
  const DENIED  = ['team', 'schedule', 'risk', 'engineering', 'procurement', 'commissioning'] as const

  it('reads its established delivery domains', async () => {
    current = principal({ role: 'field_ops' })
    for (const r of GRANTED.flatMap(inDomain)) {
      expect((await call(r)).status, `field_ops should read ${r.label}`).toBe(200)
    }
  })

  it('is denied engineering, schedule, risk, team, procurement and commissioning', async () => {
    current = principal({ role: 'field_ops' })
    for (const r of DENIED.flatMap(inDomain)) {
      expect((await call(r)).status, `field_ops must not read ${r.label}`).toBe(403)
    }
  })
})

// ─── Procurement (§10, §46) ───────────────────────────────────────────────────
describe('Procurement', () => {
  const GRANTED = ['project', 'procurement', 'docs'] as const
  const DENIED  = ['team', 'schedule', 'risk', 'engineering', 'construction', 'field', 'quality', 'safety', 'commissioning'] as const

  it('reads project context, procurement and documents', async () => {
    current = principal({ role: 'procurement' })
    for (const r of GRANTED.flatMap(inDomain)) {
      expect((await call(r)).status, `procurement should read ${r.label}`).toBe(200)
    }
  })

  it('is denied every other delivery domain, and schedule in particular', async () => {
    current = principal({ role: 'procurement' })
    for (const r of DENIED.flatMap(inDomain)) {
      expect((await call(r)).status, `procurement must not read ${r.label}`).toBe(403)
    }
    // The recorded product gap: required-on-site dates live behind schedule.view,
    // which also opens Monte Carlo forecasting. Still withheld, not widened.
    expect(roleHasCapability('procurement', 'schedule.view')).toBe(false)
  })

  it('still cannot read commercial data through a procurement grant', async () => {
    current = principal({ role: 'procurement' })
    expect(roleHasCapability('procurement', 'cost.view')).toBe(false)
    for (const r of inDomain('mixed')) {
      expect((await call(r)).status, `procurement must not read ${r.label}`).toBe(403)
    }
  })
})

// ─── Owner (§47) ──────────────────────────────────────────────────────────────
describe('Owner crosses every delivery-read guard', () => {
  it('is admitted to every registered read', async () => {
    const { admitted, denied, unexpected } = await sweep('owner')
    expect(unexpected).toEqual([])
    expect(denied, `owner was denied: ${denied.join(', ')}`).toEqual([])
    expect(admitted.length).toBe(READS.length)
  })
})

// ─── Stale JWT on a delivery read (§48) ───────────────────────────────────────
describe('the database role is authoritative for delivery reads', () => {
  it('denies commissioning when the token says project_manager and the database says viewer', async () => {
    current = principal({ role: 'viewer', jwtRole: 'project_manager' })
    const res = await call({ label: 'commissioning', domain: 'commissioning', method: 'GET', capability: 'commissioning.view' })
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'forbidden' })
  })

  it('admits engineering when the token says viewer and the database says engineer', async () => {
    // The reverse direction: a stale *narrow* claim must not deny a user whose
    // current role is broader. The database governs both ways.
    current = principal({ role: 'engineer', jwtRole: 'viewer' })
    const res = await call({ label: 'engineering', domain: 'engineering', method: 'GET', capability: 'engineering.view' })
    expect(res.status).toBe(200)
  })

  it('denies a deactivated project manager', async () => {
    current = principal({ role: 'project_manager', active: false })
    expect((await call({ label: 'x', domain: 'quality', method: 'GET', capability: 'quality.view' })).status).toBe(401)
  })

  it('denies a project manager whose user row no longer exists', async () => {
    current = principal({ role: 'project_manager', exists: false })
    expect((await call({ label: 'x', domain: 'docs', method: 'GET', capability: 'docs.view' })).status).toBe(401)
  })
})
