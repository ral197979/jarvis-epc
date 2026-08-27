/**
 * The accounting boundary — what Denver sends, what it will not hold.
 *
 * Denver is a project-delivery system that owns COMMERCIAL FACTS. It is not an
 * accounting system, and the point of this contract is that it never becomes
 * one: no ledger, no journal, no AR/AP ageing, no payment allocation. These
 * tests hold that line in both directions — the payload carries Denver's own
 * vocabulary and figures, and the boundary refuses to grow an accounting model.
 *
 * The audit behind it (2026-08-25):
 *   · `vendors`, `purchase_orders`, `subcontracts`, `subcontract_invoices`,
 *     `pay_applications` are all really written by Denver services.
 *   · `contracts` and `crm_leads` have no writer, so nothing is projected from
 *     them.
 *   · There is NO customer entity — `projects.client_name` is free text — which
 *     is why a receivable carries no party and says so.
 *   · The QuickBooks connector exists as an HTTP client and nothing calls it.
 *
 * Fixture:
 *   Tenant A   OWNER_A (owner)           → tenant-wide
 *              PM_A    (project_manager) → member of PROJECT_A only
 *   Tenant B   PM_B                      → another tenant
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const mockQuery = vi.fn()
vi.mock('../db/pool', () => ({
  query:             (...a: unknown[]) => mockQuery(...a),
  tenantQuery:       (...a: unknown[]) => mockQuery(...a),
  tenantTransaction: async (_t: string, fn: (c: unknown) => unknown) => fn({ query: mockQuery }),
  pool:              { query: (...a: unknown[]) => mockQuery(...a), connect: vi.fn() },
}))

import type { UserRole } from '../authz/capabilities'

const TENANT_A  = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B  = 'bbbbbbbb-0000-4000-8000-000000000002'
const OWNER_A   = '10000000-0000-4000-8000-0000000000a1'
const PM_A      = '10000000-0000-4000-8000-0000000000a2'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'
const PAYABLE   = '80000000-0000-4000-8000-00000000000a'
const PAYAPP    = '80000000-0000-4000-8000-00000000000b'
const VENDOR    = '80000000-0000-4000-8000-00000000000c'
const PO        = '80000000-0000-4000-8000-00000000000d'

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller): void => { caller = c; (globalThis as Record<string, unknown>)['__acct'] = c }
let MEMBERS: { projectId: string; userId: string; active: boolean }[]
/** Which project the record-scope projection reports for the addressed row. */
let RECORD_PROJECT = PROJECT_A

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__acct'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, n: () => void) => n(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__acct'] as Caller).tenantId
    next()
  },
}))

import { requireAuth } from '../auth'
import { requireTenant } from '../middleware/tenant'
import { accountingBoundaryRouter } from '../routes/accountingBoundary'
import {
  ACCOUNTING_CONTRACT_VERSION, ACCOUNTING_PROVIDERS, buildIdempotencyKey,
  EMITTING_STATE, REQUIRES_CUSTOMER_MAPPING,
} from '../services/integration/accounting/accountingContract'

const app = (() => {
  const a = express()
  a.use(express.json())
  a.use('/api/v1/integrations/accounting', requireAuth as never, requireTenant() as never, accountingBoundaryRouter as never)
  return a
})()

const SQLRE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string => a.find((x): x is string => typeof x === 'string' && SQLRE.test(x)) ?? ''
const statements = (): string[] => mockQuery.mock.calls.map(c => sqlOf(c)).filter(Boolean)
const wrote = (): boolean => statements().some(s => /\b(INSERT|UPDATE|DELETE)\b/i.test(s))

/** The governed ISO-4217 declaration. Null means nobody has declared one. */
let CURRENCY: string | null = 'USD'

beforeEach(() => {
  CURRENCY = 'USD'
  MEMBERS = [{ projectId: PROJECT_A, userId: PM_A, active: true }]
  RECORD_PROJECT = PROJECT_A
  setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }
    // record-scope projection: which project does the addressed row belong to?
    if (/AS\s+project_id/i.test(sql) && / r\b/i.test(sql)) {
      // The real resolver carries the tenant predicate, so a row in another
      // tenant is NOT_FOUND rather than reaching the membership test.
      if (/tenant_id = current_setting/i.test(sql) && caller.tenantId !== TENANT_A) return empty
      return { rows: [{ project_id: RECORD_PROJECT }], rowCount: 1 }
    }
    if (/FROM projects/i.test(sql)) {
      const wantsMembership = /project_members/i.test(sql)
      const honoursTenant   = /tenant_id = current_setting/i.test(sql)
      if (honoursTenant && caller.tenantId !== TENANT_A) return empty
      // `params` is the array of bind values; the uuid[] is its FIRST element.
      const params = (args.find(x => Array.isArray(x)) as unknown[] | undefined) ?? []
      const candidates = (Array.isArray(params[0]) ? params[0] as string[] : [PROJECT_A, PROJECT_B])
      const visible = candidates.filter(id => !wantsMembership ||
        MEMBERS.some(m => m.projectId === id && m.userId === caller.id && m.active))
      return { rows: visible.map(id => ({ id })), rowCount: visible.length }
    }
    if (/FROM subcontract_invoices si/i.test(sql)) {
      return { rows: [{
        id: PAYABLE, inv_number: 7, status: 'submitted',
        gross_amount: '120000.00', retention_held: '12000.00', net_amount: '108000.00',
        period_start: '2026-07-01', period_end: '2026-07-31', submitted_at: '2026-08-01T00:00:00Z',
        subcontract_id: 'sc-1', sc_title: 'Mechanical package',
        project_id: PROJECT_A, project_code: 'ACME-01', currency: null,
        vendor_id: VENDOR, vendor_name: 'PipePro', vendor_code: 'PIPE',
        vendor_email: 'ap@pipepro.test', vendor_country: 'US',
      }], rowCount: 1 }
    }
    if (/FROM pay_applications pa/i.test(sql)) {
      return { rows: [{
        id: PAYAPP, application_number: 3, status: 'submitted',
        period_start: '2026-07-01', period_end: '2026-07-31', invoice_date: '2026-08-02',
        retention_pct: '10.00', submitted_at: '2026-08-02T00:00:00Z', paid_at: null,
        project_id: PROJECT_A, project_code: 'ACME-01', client_name: 'US DOS',
      }], rowCount: 1 }
    }
    if (/FROM vendors\b/i.test(sql) && !/JOIN/i.test(sql)) {
      return { rows: [{ id: VENDOR, name: 'PipePro', code: 'PIPE', email: 'ap@pipepro.test', country: 'US', status: 'approved' }], rowCount: 1 }
    }
    if (/FROM accounting_currency_declarations/i.test(sql)) {
      return CURRENCY
        ? { rows: [{ currency: CURRENCY, declared_by: null, declared_at: '2026-08-20T00:00:00Z', note: null }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    if (/FROM purchase_orders po/i.test(sql)) {
      return { rows: [{
        id: PO, po_number: 'PO-1001', status: 'issued', title: 'Valves',
        total_amount: '45000.00', currency: 'USD',
        project_id: PROJECT_A, project_code: 'ACME-01',
        vendor_id: VENDOR, vendor_name: 'PipePro', vendor_code: 'PIPE',
        vendor_email: 'ap@pipepro.test', vendor_country: 'US',
      }], rowCount: 1 }
    }
    return empty
  })
})

const outbound = (type: string, id: string) =>
  request(app).get(`/api/v1/integrations/accounting/outbound/${type}/${id}`)

// ─── 1. The contract declares its own limits ─────────────────────────────────

describe('the contract states what Denver will never hold', () => {
  it('publishes the not-in-scope list as part of the contract', async () => {
    const res = await request(app).get('/api/v1/integrations/accounting/contract')
    expect(res.status).toBe(200)
    const scope = (res.body.data.notInScope as string[]).join(' ').toLowerCase()
    for (const forbidden of ['general ledger', 'journal', 'ageing', 'payment ledger', 'reconciliation']) {
      expect(scope, `${forbidden} must be declared out of scope`).toContain(forbidden)
    }
  })

  it('is provider-neutral and names BillBox alongside QuickBooks', async () => {
    const res = await request(app).get('/api/v1/integrations/accounting/contract')
    expect(res.body.data.providers).toEqual([...ACCOUNTING_PROVIDERS])
    expect(res.body.data.providers).toContain('billbox')
    expect(res.body.data.providers).toContain('quickbooks')
  })

  it('reports only decisions that are genuinely still open', async () => {
    const res = await request(app).get('/api/v1/integrations/accounting/contract')
    const ids = (res.body.data.openDecisions as { id: string }[]).map(d => d.id)
    // Reconciliation is deliberately undesigned, and no provider has published
    // a receiving contract. Both are real, and saying so is the point.
    expect(ids).toContain('settlement-reconciliation')
    expect(ids).toContain('provider-receiving-contract')
  })

  it('does not publish as OPEN a decision the implementation has already made', async () => {
    // The failure this prevents: `/contract` is what an integrator reads
    // instead of the source, so a decision listed as open while the code
    // enforces an answer is the endpoint lying about the boundary. Both of
    // these were settled and left in the open list by an earlier slice.
    const res = await request(app).get('/api/v1/integrations/accounting/contract')
    const open = (res.body.data.openDecisions as { id: string }[]).map(d => d.id)
    const settled = (res.body.data.settledDecisions as { id: string }[]).map(d => d.id)

    for (const id of ['customer-entity', 'emission-trigger']) {
      expect(settled, `${id} is enforced in code and must be published as settled`).toContain(id)
      expect(open, `${id} must no longer be published as open`).not.toContain(id)
    }
  })

  it('publishes an emission policy that matches what the code actually enforces', async () => {
    // A structural check rather than a restatement: the endpoint's emission
    // policy is read back against the module the service gates on, so the two
    // cannot drift the way the decision registers did.
    const res = await request(app).get('/api/v1/integrations/accounting/contract')
    expect(res.body.data.emissionPolicy.emittingState).toEqual(EMITTING_STATE)
    expect(res.body.data.emissionPolicy.requiresCustomerMapping).toEqual([...REQUIRES_CUSTOMER_MAPPING])
    // And the settled entries name the code that enforces them.
    const settled = res.body.data.settledDecisions as { id: string; enforcedBy: string }[]
    expect(settled.find(d => d.id === 'emission-trigger')!.enforcedBy).toMatch(/EMITTING_STATE/)
    expect(settled.find(d => d.id === 'customer-entity')!.enforcedBy).toMatch(/accounting_party_links|REQUIRES_CUSTOMER_MAPPING/)
  })

  it('publishes the decisions it has SETTLED, with what enforces each', async () => {
    // An integrator needs to know what Denver has settled as much as what it
    // has not, and a decision recorded only in a commit message is one nobody
    // downstream can read.
    const res = await request(app).get('/api/v1/integrations/accounting/contract')
    const settled = res.body.data.settledDecisions as { id: string; decision: string; enforcedBy: string }[]
    const ids = settled.map(d => d.id)
    for (const id of ['tax-treatment', 'durable-document-link', 'currency-policy', 'settlement-lifecycle']) {
      expect(ids, `${id} must be published as settled`).toContain(id)
    }
    // A decision with nothing enforcing it is a preference.
    for (const d of settled) expect(d.enforcedBy, `${d.id} names no enforcement`).toBeTruthy()

    // Nothing may be in both registers at once.
    const open = (res.body.data.openDecisions as { id: string }[]).map(d => d.id)
    for (const id of ids) expect(open, `${id} is both open and settled`).not.toContain(id)
  })

  it('states the tax position as UNKNOWN rather than omitting the subject', async () => {
    const res = await request(app).get('/api/v1/integrations/accounting/contract')
    expect(res.body.data.taxPolicy.known).toBe(false)
    expect(res.body.data.taxPolicy.reason).toMatch(/Absent is not zero/i)
  })

  it('declares that Denver\'s own identity is authoritative, and a deep link is not', async () => {
    const res = await request(app).get('/api/v1/integrations/accounting/contract')
    const identity = res.body.data.identityPolicy
    expect(identity.authoritative).toEqual(['denverId', 'idempotencyKey'])
    expect(identity.presentationalOnly).toContain('externalUrl')
  })

  it('declares the currency policy, with no fallback anywhere in it', async () => {
    const res = await request(app).get('/api/v1/integrations/accounting/contract')
    const policy = res.body.data.currencyPolicy
    expect(policy.required).toEqual(expect.arrayContaining(['receivable_application', 'payable_invoice', 'commitment']))
    expect(policy.required).not.toContain('vendor')
    expect(policy.note).toMatch(/no USD fallback/i)
  })

  it('says plainly that no provider adapter is deployed yet', async () => {
    // The transport is complete and has nothing to send through it, because no
    // provider has published a receiving contract. Saying so is the point.
    const res = await request(app).get('/api/v1/integrations/accounting/contract')
    expect(res.body.data.transport.registeredProviders).toEqual([])
    expect(res.body.data.providers).toContain('billbox')
  })

  it('asks for settlement as a status, never as a ledger entry', async () => {
    const res = await request(app).get('/api/v1/integrations/accounting/contract')
    const ack = res.body.data.acknowledgement
    expect(ack.states).toEqual(['accepted', 'rejected', 'failed'])
    expect(JSON.stringify(ack).toLowerCase()).not.toMatch(/debit|credit|journal|account_code/)
  })

  it('requires platform.integrations to read the contract', async () => {
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'engineer' })
    expect((await request(app).get('/api/v1/integrations/accounting/contract')).status).toBe(403)
  })
})

// ─── 2. Denver's own facts, in Denver's own vocabulary ───────────────────────

describe('an outbound document carries Denver facts, not accounting ones', () => {
  it('projects a payable invoice from the persisted columns', async () => {
    const res = await outbound('payable_invoice', PAYABLE)
    expect(res.status).toBe(200)
    const d = res.body.data
    expect(d.type).toBe('payable_invoice')
    expect(d.contractVersion).toBe(ACCOUNTING_CONTRACT_VERSION)
    // Denver's OWN lifecycle value, passed through rather than mapped.
    expect(d.sourceState).toBe('submitted')
    expect(d.detail.gross.amount).toBe('120000.00')
    expect(d.detail.retention.amount).toBe('12000.00')
    expect(d.detail.net.amount).toBe('108000.00')
  })

  it('keeps amounts as strings so no float rounding is introduced', async () => {
    const res = await outbound('payable_invoice', PAYABLE)
    for (const k of ['gross', 'retention', 'net']) {
      expect(typeof res.body.data.detail[k].amount, `${k} must be a string`).toBe('string')
    }
  })

  it('carries no ledger vocabulary anywhere in the payload', async () => {
    const res = await outbound('payable_invoice', PAYABLE)
    const body = JSON.stringify(res.body).toLowerCase()
    for (const forbidden of ['debit', 'credit', 'journal', 'ledger', 'account_code', 'gl_']) {
      expect(body, `payload must not contain ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('builds a stable idempotency key that includes the source state', async () => {
    // The same document moving submitted → approved is a NEW fact; a key
    // without the state would silently suppress the second send.
    const res = await outbound('payable_invoice', PAYABLE)
    expect(res.body.data.idempotencyKey).toBe(buildIdempotencyKey('payable_invoice', PAYABLE, 'submitted'))
    expect(buildIdempotencyKey('payable_invoice', PAYABLE, 'approved'))
      .not.toBe(buildIdempotencyKey('payable_invoice', PAYABLE, 'submitted'))
  })

  it('projects a commitment in its GOVERNED currency, never converting it', async () => {
    const res = await outbound('commitment', PO)
    expect(res.body.data.detail.total).toEqual({ amount: '45000.00', currency: 'USD' })
    expect(res.body.data.currency).toBe('USD')
    expect(res.body.data.currencyBasis).toBe('declared')
  })

  it('shows a money-bearing projection as UNDECLARED when nobody has declared', async () => {
    // The preview must be as honest as the emission. Rendering 'USD' here would
    // be the fallback the decision forbids, one screen removed.
    CURRENCY = null
    const res = await outbound('commitment', PO)
    expect(res.body.data.currency).toBeNull()
    expect(res.body.data.currencyBasis).toBe('undeclared')
    expect(res.body.data.detail.total.currency).toBeNull()
  })

  it('reads no DEFAULT-bearing currency column to fill the gap', async () => {
    CURRENCY = null
    await outbound('commitment', PO)
    // purchase_orders.currency and projects.currency are both DEFAULT 'USD'.
    for (const s of statements()) expect(s).not.toMatch(/\bpo\.currency\b|\bp\.currency\b/i)
  })

  it('projects a vendor as a party with no accounting classification', async () => {
    const res = await outbound('vendor', VENDOR)
    expect(res.body.data.party.name).toBe('PipePro')
    // Denver's approval lifecycle, not "supplier"/"customer".
    expect(res.body.data.sourceState).toBe('approved')
  })
})

// ─── 3. The missing customer entity is disclosed, not invented ───────────────

describe('a receivable admits it has no customer', () => {
  it('carries no party, because Denver has no customer entity', async () => {
    const res = await outbound('receivable_application', PAYAPP)
    expect(res.status).toBe(200)
    expect(res.body.data.party).toBeNull()
  })

  it('labels the client name as unverified free text', async () => {
    // `projects.client_name` is a string, not a master-data reference. Sending
    // it as a party would invent a relationship Denver does not have.
    const res = await outbound('receivable_application', PAYAPP)
    expect(res.body.data.detail.clientNameUnverified).toBe('US DOS')
    expect(res.body.data.detail.customerResolution).toBe('unresolved')
  })
})

// ─── 4. Tenant and project isolation ─────────────────────────────────────────

describe('the boundary is not a way around ADR-014', () => {
  it('refuses a caller from another tenant', async () => {
    // Owner of tenant B, so the capability gate opens and the refusal has to
    // come from the tenant predicate rather than from the role.
    setCaller({ id: OWNER_A, tenantId: TENANT_B, role: 'owner' })
    const res = await outbound('payable_invoice', PAYABLE)
    expect(res.status).toBe(404)
  })

  it('applies the project guard the route declares, even though no role can currently exercise it', async () => {
    // HONEST LIMITATION: `cost.view` is Owner-only in this registry, and an
    // Owner is tenant-wide — so every caller who passes the capability gate
    // also passes project scope, and the project dimension cannot be
    // demonstrated end-to-end today. It is not decoration: if cost.view is ever
    // widened, it is the only thing standing between a project member and
    // another project's commercial figures. Capability HOLDERS are deliberately
    // not changed here — ADR-014 phases decide where authority applies, never
    // who holds it.
    //
    // So the guard is exercised directly, against the same resource the route
    // names, with a principal who is not tenant-wide.
    const { authorizeRecordScope } = await import('../authz/recordScope')
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
    RECORD_PROJECT = PROJECT_B                 // a project PM_A is not a member of
    const refused = await authorizeRecordScope(
      { id: PM_A, tenantId: TENANT_A, role: 'project_manager' }, 'subcontract_invoices', PAYABLE)
    expect(refused).toBe('REFUSE')

    RECORD_PROJECT = PROJECT_A                 // a project PM_A IS a member of
    const admitted = await authorizeRecordScope(
      { id: PM_A, tenantId: TENANT_A, role: 'project_manager' }, 'subcontract_invoices', PAYABLE)
    expect(admitted).toBe('ADMIT')
  })

  it('names a scope-resolvable resource for every project-bound document type', async () => {
    // The route resolves scope against DOCUMENT_SOURCE_RESOURCE. If a type ever
    // named a resource with no policy, the guard would fail closed and the
    // document would be permanently unreachable — or, worse, someone would
    // remove the guard to "fix" it.
    const { policyFor } = await import('../authz/recordScopePolicies')
    const { DOCUMENT_SOURCE_RESOURCE } = await import('../services/integration/accounting/accountingContract')
    for (const [type, resource] of Object.entries(DOCUMENT_SOURCE_RESOURCE)) {
      if (resource === 'vendors') continue      // tenant master data, no project parent
      expect(policyFor(resource), `${type} → ${resource} must have a scope policy`).toBeTruthy()
    }
  })

  it('carries the tenant predicate on every projection query', async () => {
    await outbound('payable_invoice', PAYABLE)
    await outbound('receivable_application', PAYAPP)
    await outbound('commitment', PO)
    await outbound('vendor', VENDOR)
    const projections = statements().filter(s =>
      /FROM (subcontract_invoices|pay_applications|purchase_orders|vendors)/i.test(s))
    expect(projections.length).toBeGreaterThan(3)
    for (const s of projections) {
      expect(s, 'a projection must be tenant-bounded').toMatch(/tenant_id = current_setting/i)
    }
  })

  it('requires cost.view, not merely integration rights', async () => {
    // A platform administrator with integration rights but no commercial
    // capability must not read project money through the boundary.
    setCaller({ id: PM_A, tenantId: TENANT_A, role: 'admin' })
    expect((await outbound('payable_invoice', PAYABLE)).status).toBe(403)
  })
})

// ─── 5. The boundary is read-only ────────────────────────────────────────────

describe('inspecting the boundary changes nothing', () => {
  it('writes nothing when a document is projected', async () => {
    await outbound('payable_invoice', PAYABLE)
    expect(wrote()).toBe(false)
  })

  it('enqueues no job — emission needs a product decision first', async () => {
    await outbound('payable_invoice', PAYABLE)
    expect(statements().some(s => /integration_jobs/i.test(s))).toBe(false)
  })

  it('refuses an unknown document type rather than guessing', async () => {
    const res = await outbound('journal_entry', PAYABLE)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unknown_document_type')
  })

  it('exposes no route that emits to a provider', async () => {
    for (const [method, path] of [
      ['post', '/api/v1/integrations/accounting/outbound/payable_invoice/' + PAYABLE],
      ['post', '/api/v1/integrations/accounting/send'],
    ] as const) {
      const res = await (request(app) as never as Record<string, (p: string) => { send: (b: unknown) => Promise<{ status: number }> }>)[method]!(path).send({})
      expect([404, 405], `${method} ${path} must not be routed`).toContain(res.status)
    }
  })
})
