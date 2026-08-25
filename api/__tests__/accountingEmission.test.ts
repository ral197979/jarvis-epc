/**
 * The emission slice — approved fact → mapped customer → outbox → acknowledgement.
 *
 * Two owner decisions are under test, and they are the reason this slice exists:
 *
 *   ONLY APPROVED DOCUMENTS EMIT. `submitted` is workflow — a person has
 *   finished preparing a document, not authorised it into the books. Emitting
 *   on `submitted` would put unapproved figures into an accounting system and
 *   rely on a later correction.
 *
 *   `paid` DOES NOT EMIT. Settlement is not a second accounting document; the
 *   receivable already exists and its settlement arrives back through the
 *   acknowledgement boundary as a status.
 *
 * And the customer rule: a receivable REFUSES without a mapped external
 * customer. `projects.client_name` is free text and is never a fallback,
 * because a receivable posted against a guessed customer is worse than one not
 * posted at all.
 *
 * Denver gains no ledger from any of this. The only persistence is the party
 * mapping (migration 088) and the existing `integration_jobs` outbox.
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
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PAYAPP    = '80000000-0000-4000-8000-00000000000b'
const PAYABLE   = '80000000-0000-4000-8000-00000000000a'

interface Caller { id: string; tenantId: string; role: UserRole }
let caller: Caller
const setCaller = (c: Caller): void => { caller = c; (globalThis as Record<string, unknown>)['__emit'] = c }

/** World state the fixture answers from. */
let PAYAPP_STATUS = 'approved'
let PARTY_LINK: { external_customer_id: string; external_customer_label: string | null } | null = null
let CONNECTOR_ID: string | null = 'conn-billbox'
let ENQUEUE_RETURNS: string | null = 'job-1'
let JOB_ROWS: Record<string, unknown>[] = []
let enqueued: { payload: Record<string, unknown>; idempotencyKey: string | null }[] = []

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__emit'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'jti' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, n: () => void) => n(),
}))
vi.mock('../middleware/tenant', () => ({
  requireTenant: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = ((globalThis as Record<string, unknown>)['__emit'] as Caller).tenantId
    next()
  },
}))

import { requireAuth } from '../auth'
import { requireTenant } from '../middleware/tenant'
import { accountingBoundaryRouter } from '../routes/accountingBoundary'
import { EMITTING_STATE, NON_EMITTING_STATE_REASON } from '../services/integration/accounting/accountingContract'

const app = (() => {
  const a = express()
  a.use(express.json())
  a.use('/api/v1/integrations/accounting', requireAuth as never, requireTenant() as never, accountingBoundaryRouter as never)
  return a
})()

const SQLRE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string => a.find((x): x is string => typeof x === 'string' && SQLRE.test(x)) ?? ''
const paramsOf = (a: unknown[]): unknown[] => (a.find(x => Array.isArray(x)) as unknown[] | undefined) ?? []
const statements = (): string[] => mockQuery.mock.calls.map(c => sqlOf(c)).filter(Boolean)

beforeEach(() => {
  PAYAPP_STATUS = 'approved'
  PARTY_LINK = { external_customer_id: 'BB-CUST-42', external_customer_label: 'Denver Water Authority' }
  CONNECTOR_ID = 'conn-billbox'
  ENQUEUE_RETURNS = 'job-1'
  JOB_ROWS = []
  enqueued = []
  setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = paramsOf(args)
    const empty = { rows: [], rowCount: 0 }

    if (/FROM\s+users\s+WHERE\s+id/i.test(sql)) {
      return { rows: [{ id: caller.id, tenant_id: caller.tenantId, role: caller.role, is_active: true }], rowCount: 1 }
    }
    if (/AS\s+project_id/i.test(sql) && / r\b/i.test(sql)) {
      if (/tenant_id = current_setting/i.test(sql) && caller.tenantId !== TENANT_A) return empty
      return { rows: [{ project_id: PROJECT_A }], rowCount: 1 }
    }
    if (/FROM projects/i.test(sql)) {
      if (/tenant_id = current_setting/i.test(sql) && caller.tenantId !== TENANT_A) return empty
      const cands = Array.isArray(params[0]) ? params[0] as string[] : [PROJECT_A]
      return { rows: cands.map(id => ({ id })), rowCount: cands.length }
    }
    if (/FROM pay_applications pa/i.test(sql)) {
      if (caller.tenantId !== TENANT_A) return empty
      return { rows: [{
        id: PAYAPP, application_number: 3, status: PAYAPP_STATUS,
        period_start: '2026-07-01', period_end: '2026-07-31', invoice_date: '2026-08-02',
        retention_pct: '10.00', submitted_at: '2026-08-02T00:00:00Z', paid_at: null,
        project_id: PROJECT_A, project_code: 'ACME-01', client_name: 'US DOS',
      }], rowCount: 1 }
    }
    if (/FROM subcontract_invoices si/i.test(sql)) {
      return { rows: [{
        id: PAYABLE, inv_number: 7, status: 'approved',
        gross_amount: '120000.00', retention_held: '12000.00', net_amount: '108000.00',
        period_start: '2026-07-01', period_end: '2026-07-31', submitted_at: null,
        subcontract_id: 'sc-1', sc_title: 'Mech', project_id: PROJECT_A,
        project_code: 'ACME-01', currency: null, vendor_id: 'v1', vendor_name: 'PipePro',
        vendor_code: 'PIPE', vendor_email: null, vendor_country: 'US',
      }], rowCount: 1 }
    }
    if (/FROM accounting_party_links/i.test(sql)) {
      return PARTY_LINK ? { rows: [PARTY_LINK], rowCount: 1 } : empty
    }
    if (/INSERT INTO accounting_party_links/i.test(sql)) {
      return { rows: [{ external_customer_id: String(params[2]), external_customer_label: params[3] ?? null }], rowCount: 1 }
    }
    if (/FROM integration_connectors/i.test(sql)) {
      return CONNECTOR_ID ? { rows: [{ id: CONNECTOR_ID }], rowCount: 1 } : empty
    }
    if (/INSERT INTO integration_jobs/i.test(sql)) {
      enqueued.push({ payload: JSON.parse(String(params[3])) as Record<string, unknown>, idempotencyKey: (params[4] as string | null) ?? null })
      return ENQUEUE_RETURNS ? { rows: [{ id: ENQUEUE_RETURNS }], rowCount: 1 } : empty
    }
    if (/FROM integration_jobs j/i.test(sql)) {
      return { rows: JOB_ROWS, rowCount: JOB_ROWS.length }
    }
    return empty
  })
})

const emit = (type: string, id: string, provider = 'billbox') =>
  request(app).post(`/api/v1/integrations/accounting/emit/${type}/${id}`).send({ provider })

// ─── 1. Only approved documents emit ─────────────────────────────────────────

describe('emission is gated on approval, not on workflow', () => {
  it('emits an approved pay application', async () => {
    const res = await emit('receivable_application', PAYAPP)
    expect(res.status).toBe(202)
    expect(res.body.data.emitted).toBe(true)
    expect(res.body.data.provider).toBe('billbox')
  })

  it('refuses a SUBMITTED pay application, and says why', async () => {
    PAYAPP_STATUS = 'submitted'
    const res = await emit('receivable_application', PAYAPP)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('not_approved')
    expect(res.body.sourceState).toBe('submitted')
    expect(res.body.detail).toMatch(/workflow, not accounting authorization/i)
    expect(enqueued, 'nothing may be queued').toHaveLength(0)
  })

  it('refuses a PAID pay application — settlement is not a second document', async () => {
    PAYAPP_STATUS = 'paid'
    const res = await emit('receivable_application', PAYAPP)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('not_approved')
    expect(res.body.detail).toMatch(/not a new accounting document/i)
    expect(enqueued).toHaveLength(0)
  })

  it('refuses every non-approved state', async () => {
    for (const state of ['draft', 'submitted', 'rejected', 'paid']) {
      PAYAPP_STATUS = state
      enqueued = []
      const res = await emit('receivable_application', PAYAPP)
      expect(res.status, `${state} must be refused`).toBe(409)
      expect(enqueued, `${state} must queue nothing`).toHaveLength(0)
    }
  })

  it('pins approved as the only emitting state for every document type', () => {
    for (const [type, state] of Object.entries(EMITTING_STATE)) {
      expect(state, `${type} must emit only when approved`).toBe('approved')
    }
    expect(NON_EMITTING_STATE_REASON.paid).toMatch(/acknowledgement boundary/i)
  })
})

// ─── 2. A receivable refuses without a mapped customer ───────────────────────

describe('a receivable will not post to a guessed customer', () => {
  it('refuses when no mapping exists for the provider', async () => {
    PARTY_LINK = null
    const res = await emit('receivable_application', PAYAPP)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('customer_mapping_missing')
    expect(enqueued).toHaveLength(0)
  })

  it('never falls back to the project client name', async () => {
    PARTY_LINK = null
    const res = await emit('receivable_application', PAYAPP)
    // `US DOS` is in the fixture as `projects.client_name`. It must not appear
    // as a resolution, and must not be queued as an identifier.
    expect(JSON.stringify(res.body)).not.toContain('US DOS')
    expect(enqueued).toHaveLength(0)
  })

  it('sends the resolved external id WITH the document, so the adapter cannot substitute one', async () => {
    await emit('receivable_application', PAYAPP)
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]!.payload.externalCustomerId).toBe('BB-CUST-42')
  })

  it('does not require a mapping for a payable, which names a vendor Denver owns', async () => {
    PARTY_LINK = null
    const res = await emit('payable_invoice', PAYABLE)
    expect(res.status).toBe(202)
  })

  it('sends a NULL external customer for a payable, never a scraped string', async () => {
    // Reachability matters here: for a receivable the missing-mapping guard
    // fires before the payload is built, so a fallback there is unreachable.
    // A payable requires no mapping, so this is where a fallback would show —
    // the field must be null, not an empty string scraped from somewhere.
    PARTY_LINK = null
    await emit('payable_invoice', PAYABLE)
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]!.payload.externalCustomerId).toBeNull()
  })
})

// ─── 3. The outbox, reused rather than rebuilt ───────────────────────────────

describe('emission goes through the existing outbox', () => {
  it('enqueues onto integration_jobs with the document idempotency key', async () => {
    await emit('receivable_application', PAYAPP)
    expect(enqueued[0]!.idempotencyKey)
      .toBe(`accounting:1.0.0:receivable_application:${PAYAPP}:approved`)
  })

  it('reports already_emitted when the outbox dedupes a repeat', async () => {
    // ON CONFLICT (tenant_id, idempotency_key) DO NOTHING returns no row. That
    // is the outbox working, not a failure.
    ENQUEUE_RETURNS = null
    const res = await emit('receivable_application', PAYAPP)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('already_emitted')
  })

  it('refuses when no connector is configured for the provider', async () => {
    CONNECTOR_ID = null
    const res = await emit('receivable_application', PAYAPP)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('provider_not_configured')
    expect(enqueued).toHaveLength(0)
  })

  it('creates no accounting tables of its own', async () => {
    await emit('receivable_application', PAYAPP)
    const written = statements().filter(s => /INSERT INTO|UPDATE /i.test(s))
    for (const s of written) {
      expect(s, 'emission must not write a ledger').not.toMatch(/journal|ledger|gl_|receipt|ageing/i)
    }
    // The only insert is the outbox row.
    expect(written.every(s => /integration_jobs/i.test(s))).toBe(true)
  })

  it('carries no ledger vocabulary in the queued payload', async () => {
    await emit('receivable_application', PAYAPP)
    const body = JSON.stringify(enqueued[0]!.payload).toLowerCase()
    for (const forbidden of ['debit', 'credit', 'journal', 'ledger', 'account_code']) {
      expect(body).not.toContain(forbidden)
    }
  })
})

// ─── 4. Provider neutrality ──────────────────────────────────────────────────

describe('the path is provider-neutral', () => {
  it('accepts billbox', async () => {
    expect((await emit('receivable_application', PAYAPP, 'billbox')).status).toBe(202)
  })

  it('accepts quickbooks through the same path, with no special-casing', async () => {
    const res = await emit('receivable_application', PAYAPP, 'quickbooks')
    expect(res.status).toBe(202)
    expect(res.body.data.provider).toBe('quickbooks')
  })

  it('refuses an unknown provider rather than defaulting to one', async () => {
    const res = await emit('receivable_application', PAYAPP, 'sage')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unknown_provider')
    expect(enqueued).toHaveLength(0)
  })

  it('resolves the mapping for the REQUESTED provider, not any mapping', async () => {
    await emit('receivable_application', PAYAPP, 'quickbooks')
    const lookup = mockQuery.mock.calls.find(c => /FROM accounting_party_links/i.test(sqlOf(c)))!
    expect(paramsOf(lookup)[1]).toBe('quickbooks')
    // Binding the provider is not enough — the STATEMENT must constrain on it,
    // or a project mapped to BillBox would satisfy a QuickBooks emission.
    expect(sqlOf(lookup)).toMatch(/provider\s*=\s*\$\d/)
  })
})

// ─── 5. Authorization and isolation ──────────────────────────────────────────

describe('emitting is a commercial authorization', () => {
  // STRUCTURAL LIMITATION, stated once and asserted at the source instead.
  //
  // `cost.view` and `cost.approve` are BOTH Owner-only in this registry, and an
  // Owner is tenant-wide. So no principal exists who holds one and not the
  // other, and none who passes the capability gate can fail project scope —
  // which makes both guards impossible to exercise end-to-end today. They are
  // not decoration: emitting is the act of putting a figure into someone's
  // books, and record scope is what stops it being done for a project the
  // caller cannot open. Capability HOLDERS are deliberately unchanged (ADR-014
  // phases decide where authority applies, never who holds it), so the
  // declarations are pinned in the source the way the nullable-scope ratchet
  // pins its resolver.
  it('declares cost.approve on emission and on choosing the billing customer', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('api/routes/accountingBoundary.ts', 'utf8')
    expect(src).toMatch(/post\('\/emit\/:type\/:id',\s*requireCapability\('cost\.approve'\)/)
    expect(src).toMatch(/put\('\/party\/:projectId\/:provider',\s*requireCapability\('cost\.approve'\)/)
    // Reading is a lower bar than authorising.
    expect(src).toMatch(/get\('\/status\/:type\/:id',\s*requireCapability\('cost\.view'\)/)
  })

  it('resolves record scope before emitting, not after', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('api/routes/accountingBoundary.ts', 'utf8')
    const emitHandler = /post\('\/emit\/:type\/:id'[\s\S]*?\n\}\)/.exec(src)?.[0] ?? ''
    expect(emitHandler, 'the emit handler was not found').toContain('emitAccountingDocument')
    const scopeAt = emitHandler.indexOf('authorizeRecordScope')
    const emitAt  = emitHandler.indexOf('emitAccountingDocument')
    expect(scopeAt, 'emission must resolve record scope').toBeGreaterThan(-1)
    expect(scopeAt, 'scope must be resolved BEFORE the document is emitted').toBeLessThan(emitAt)
  })

  it('refuses a caller without cost.approve', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await emit('receivable_application', PAYAPP)
    expect(res.status).toBe(403)
    expect(enqueued).toHaveLength(0)
  })

  it('refuses a caller from another tenant', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_B, role: 'owner' })
    const res = await emit('receivable_application', PAYAPP)
    expect(res.status).toBe(404)
    expect(enqueued).toHaveLength(0)
  })

  it('scopes the party mapping read to the tenant', async () => {
    await emit('receivable_application', PAYAPP)
    const lookup = statements().find(s => /FROM accounting_party_links/i.test(s))!
    expect(lookup).toMatch(/tenant_id = current_setting/i)
  })
})

// ─── 6. Acknowledgement and visible status ───────────────────────────────────

describe('the acknowledgement is the only thing Denver records', () => {
  it('reports no integration for a document never emitted', async () => {
    const res = await request(app).get(`/api/v1/integrations/accounting/status/receivable_application/${PAYAPP}`)
    expect(res.status).toBe(200)
    expect(res.body.data.latest).toBeNull()
    expect(res.body.data.history).toBe(0)
  })

  it('surfaces the provider acknowledgement, including settlement as a status', async () => {
    JOB_ROWS = [{
      id: 'job-1', connector_type: 'billbox', status: 'completed',
      idempotency_key: 'k', attempts: 1, error: null,
      created_at: '2026-08-25T10:00:00Z', completed_at: '2026-08-25T10:00:05Z',
      result: {
        state: 'accepted', externalId: 'BB-INV-77',
        externalUrl: 'https://billbox.test/invoices/BB-INV-77',
        settlement: { settled: true, settledAt: '2026-08-30', amount: { amount: '108000.00', currency: 'USD' } },
      },
    }]
    const res = await request(app).get(`/api/v1/integrations/accounting/status/receivable_application/${PAYAPP}`)
    expect(res.body.data.latest.jobStatus).toBe('completed')
    expect(res.body.data.latest.ack.externalId).toBe('BB-INV-77')
    expect(res.body.data.latest.ack.settlement.settled).toBe(true)
  })

  it('scopes the status lookup to the tenant', async () => {
    await request(app).get(`/api/v1/integrations/accounting/status/receivable_application/${PAYAPP}`)
    const s = statements().find(x => /FROM integration_jobs j/i.test(x))!
    expect(s).toMatch(/tenant_id = current_setting/i)
  })

  it('refuses status for a caller from another tenant', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_B, role: 'owner' })
    const res = await request(app).get(`/api/v1/integrations/accounting/status/receivable_application/${PAYAPP}`)
    expect(res.status).toBe(404)
  })
})

// ─── 7. The mapping is a mapping, not a customer master ──────────────────────

describe('the party mapping holds an identifier and nothing else', () => {
  it('stores an external id against a project and provider', async () => {
    const res = await request(app)
      .put(`/api/v1/integrations/accounting/party/${PROJECT_A}/billbox`)
      .send({ external_customer_id: 'BB-CUST-42', external_customer_label: 'Denver Water' })
    expect(res.status).toBe(200)
    expect(res.body.data.externalCustomerId).toBe('BB-CUST-42')
  })

  it('refuses a blank external id', async () => {
    const res = await request(app)
      .put(`/api/v1/integrations/accounting/party/${PROJECT_A}/billbox`)
      .send({ external_customer_id: '   ' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('external_customer_id_required')
  })

  it('requires cost.approve to choose which customer a project bills to', async () => {
    setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'project_manager' })
    const res = await request(app)
      .put(`/api/v1/integrations/accounting/party/${PROJECT_A}/billbox`)
      .send({ external_customer_id: 'X' })
    expect(res.status).toBe(403)
  })

  it('stores no customer master fields', async () => {
    await request(app)
      .put(`/api/v1/integrations/accounting/party/${PROJECT_A}/billbox`)
      .send({ external_customer_id: 'BB-1', address: '1 Main St', tax_id: 'VAT123', terms: 'NET30' })
    const insert = statements().find(s => /INSERT INTO accounting_party_links/i.test(s))!
    for (const forbidden of ['address', 'tax_id', 'terms', 'credit_limit']) {
      expect(insert, `the mapping must not persist ${forbidden}`).not.toMatch(new RegExp(forbidden, 'i'))
    }
  })
})
