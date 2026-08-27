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
/** The governed ISO-4217 declaration. Null means nobody has declared one. */
let CURRENCY: string | null = 'USD'
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
import {
  EMITTING_STATE, NON_EMITTING_STATE_REASON, ACCOUNTING_CONTRACT_VERSION,
  EMISSION_CAPABILITY, CURRENCY_DECLARATION_CAPABILITY, PARTY_MAPPING_CAPABILITY,
  MONEY_BEARING_DOCUMENT_TYPES,
  TAX_UNKNOWN_REASON,
} from '../services/integration/accounting/accountingContract'
import { USER_ROLES, SERVER_ROLE_CAPS } from '../authz/capabilities'

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
  CURRENCY = 'USD'
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
    if (/FROM accounting_currency_declarations/i.test(sql)) {
      if (caller.tenantId !== TENANT_A) return empty
      return CURRENCY
        ? { rows: [{ currency: CURRENCY, declared_by: OWNER_A, declared_at: '2026-08-20T00:00:00Z', note: null }], rowCount: 1 }
        : empty
    }
    if (/INSERT INTO accounting_currency_declarations/i.test(sql)) {
      CURRENCY = String(params[1])
      return { rows: [{ currency: CURRENCY, declared_by: OWNER_A, declared_at: '2026-08-25T00:00:00Z', note: params[3] ?? null }], rowCount: 1 }
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

// ─── 2b. A money-bearing document needs a governed currency ──────────────────

describe('emission refuses to guess what currency the money is in', () => {
  it('refuses a receivable whose project has no declaration', async () => {
    CURRENCY = null
    const res = await emit('receivable_application', PAYAPP)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('currency_not_declared')
    expect(enqueued, 'nothing may be queued').toHaveLength(0)
  })

  it('refuses a payable and a commitment on the same rule', async () => {
    CURRENCY = null
    const res = await emit('payable_invoice', PAYABLE)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('currency_not_declared')
    expect(enqueued).toHaveLength(0)
  })

  it('never falls back to USD, and says so in the refusal', async () => {
    CURRENCY = null
    const res = await emit('receivable_application', PAYAPP)
    expect(res.body.detail).toMatch(/will not default to USD|not default to USD/i)
    // The refusal must not be a rendered default either.
    expect(res.body).not.toHaveProperty('currency')
  })

  it('reads the governed declaration, not projects.currency', async () => {
    await emit('receivable_application', PAYAPP)
    const lookup = statements().find(s => /accounting_currency_declarations/i.test(s))
    expect(lookup, 'the governed declaration must be consulted').toBeTruthy()
    // `projects.currency` and `purchase_orders.currency` are DEFAULT 'USD', so
    // a value in either cannot be told apart from one nobody set.
    for (const s of statements()) {
      expect(s).not.toMatch(/\bp\.currency\b|\bpo\.currency\b/i)
    }
    expect(lookup).toMatch(/tenant_id = current_setting/i)
  })

  it('stamps the declared currency onto every amount it sends', async () => {
    CURRENCY = 'EUR'
    await emit('payable_invoice', PAYABLE)
    const d = (enqueued[0]!.payload as Record<string, unknown>)['document'] as Record<string, unknown>
    expect(d['currency']).toBe('EUR')
    expect(d['currencyBasis']).toBe('declared')
    const detail = d['detail'] as Record<string, { currency: string }>
    // The envelope and the lines must agree, or the document is unactionable.
    for (const k of ['gross', 'retention', 'net']) {
      expect(detail[k]!.currency, `${k} must carry the governed currency`).toBe('EUR')
    }
  })

  it('reports the missing currency BEFORE the missing customer mapping', async () => {
    // Order matters because it decides which refusal a person acts on. Currency
    // applies to every money-bearing type and governs what each amount MEANS;
    // the mapping applies to receivables alone and only decides who is billed.
    // Reporting the narrower problem first would send someone to map a customer
    // for a document that still could not be emitted afterwards.
    CURRENCY = null
    PARTY_LINK = null
    const res = await emit('receivable_application', PAYAPP)
    expect(res.body.error).toBe('currency_not_declared')
    expect(enqueued).toHaveLength(0)
  })

  it('does not demand a currency for a vendor, which moves no money', () => {
    expect(MONEY_BEARING_DOCUMENT_TYPES).not.toContain('vendor')
    expect(MONEY_BEARING_DOCUMENT_TYPES).toEqual(
      expect.arrayContaining(['payable_invoice', 'receivable_application', 'commitment']))
  })
})

// ─── 2c. Tax is stated as unknown, never inferred ────────────────────────────

describe('Denver states its tax position rather than staying silent', () => {
  it('carries an explicit UNKNOWN on a money-bearing document', async () => {
    await emit('payable_invoice', PAYABLE)
    const d = (enqueued[0]!.payload as Record<string, unknown>)['document'] as Record<string, unknown>
    const tax = d['tax'] as Record<string, unknown>
    // Present and unknown — not omitted. Silence would invite a provider to
    // read "no tax applies", which Denver has no basis to assert.
    expect(tax).toBeTruthy()
    expect(tax['known']).toBe(false)
    expect(String(tax['reason'])).toBe(TAX_UNKNOWN_REASON)
    expect(String(tax['reason'])).toMatch(/Absent is not zero/i)
  })

  it('never emits a derived tax amount or rate', async () => {
    await emit('payable_invoice', PAYABLE)
    const body = JSON.stringify(enqueued[0]!.payload)
    for (const forbidden of ['taxAmount', 'taxRate', 'taxCode', 'vatNumber']) {
      expect(body, `Denver must not invent ${forbidden}`).not.toContain(forbidden)
    }
  })
})

// ─── 3. The outbox, reused rather than rebuilt ───────────────────────────────

describe('emission goes through the existing outbox', () => {
  it('enqueues onto integration_jobs with the document idempotency key', async () => {
    await emit('receivable_application', PAYAPP)
    expect(enqueued[0]!.idempotencyKey)
      .toBe(`accounting:${ACCOUNTING_CONTRACT_VERSION}:receivable_application:${PAYAPP}:approved`)
  })

  it('reports already_emitted when the outbox dedupes a repeat', async () => {
    // ON CONFLICT (tenant_id, idempotency_key) DO NOTHING returns no row. That
    // is the outbox working, not a failure.
    ENQUEUE_RETURNS = null
    const res = await emit('receivable_application', PAYAPP)
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('already_emitted')
  })

  it('selects only an ACTIVE connector, by naming the state rather than excluding one', async () => {
    // Both halves of this are regressions the live path caught. The predicate
    // was `status <> 'disabled'`, a label `connector_status` does not contain,
    // so PostgreSQL rejected the comparison and EVERY emission 500'd — a mock
    // cannot see that, because it returns a row without evaluating the SQL.
    // Naming the one permitted state also means a status added to the enum
    // later is refused by default instead of silently becoming emittable.
    await emit('receivable_application', PAYAPP)
    const lookup = statements().find(s => /FROM integration_connectors/i.test(s))!
    expect(lookup).toMatch(/status\s*=\s*'active'/i)
    expect(lookup, 'excluding a state is what broke; name the allowed one').not.toMatch(/status\s*<>/i)
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
  // Every capability this route uses is Owner-only in this registry, and an
  // Owner is tenant-wide. So no principal exists who holds one and not another,
  // and none who passes the capability gate can fail project scope — which makes
  // both guards impossible to exercise end-to-end today. They are not
  // decoration: emitting is the act of putting a figure into someone's books,
  // and record scope is what stops it being done for a project the caller cannot
  // open. Capability HOLDERS are deliberately unchanged (ADR-014 phases decide
  // where authority applies, never who holds it), so the declarations are pinned
  // in the source the way the nullable-scope ratchet pins its resolver.
  it('emits under a dedicated accounting capability, never cost.approve', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('api/routes/accountingBoundary.ts', 'utf8')

    // Each type is registered under a LITERAL path segment with a LITERAL
    // capability. The literal is not cosmetic: the ADR-014 endpoint census
    // parses `requireCapability('...')` out of this file to prove every
    // mutation is guarded, and a capability resolved at runtime would be
    // invisible to it — a guard that could be dropped with nothing failing.
    for (const [type, capability] of Object.entries(EMISSION_CAPABILITY)) {
      const re = new RegExp(`post\\('/emit/${type}/:id',\\s*requireCapability\\('${capability.replace(/\./g, '\\.')}'\\)`)
      expect(src, `${type} must be guarded by ${capability}, as a literal`).toMatch(re)
    }
    expect(src).toMatch(new RegExp(`put\\('/party/:projectId/:provider',\\s*requireCapability\\('${PARTY_MAPPING_CAPABILITY.replace(/\./g, '\\.')}'\\)`))
    expect(src).toMatch(new RegExp(`put\\('/currency/:projectId',\\s*requireCapability\\('${CURRENCY_DECLARATION_CAPABILITY.replace(/\./g, '\\.')}'\\)`))

    // Reading is a lower bar than authorising.
    expect(src).toMatch(/get\('\/status\/:type\/:id',\s*requireCapability\('cost\.view'\)/)
    // The regression this slice exists to prevent: emission must never again be
    // bound to Denver-internal commercial approval.
    expect(src).not.toMatch(/requireCapability\('cost\.approve'\)/)
  })

  it('gives each document type its own capability, all Owner-only', () => {
    expect(EMISSION_CAPABILITY.receivable_application).toBe('accounting.receivables.emit')
    expect(EMISSION_CAPABILITY.payable_invoice).toBe('accounting.payables.emit')
    // Money in and money out are not one authority.
    expect(EMISSION_CAPABILITY.receivable_application).not.toBe(EMISSION_CAPABILITY.payable_invoice)

    for (const cap of Object.values(EMISSION_CAPABILITY)) {
      const holders = USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(cap))
      // Owner-only, exactly as cost.approve was: this commit narrows nothing and
      // broadens nothing, it only makes later delegation possible without
      // collateral authority.
      expect(holders, `${cap} must stay Owner-only`).toEqual(['owner'])
    }
    expect(USER_ROLES.filter(r => (SERVER_ROLE_CAPS[r] as readonly string[]).includes(CURRENCY_DECLARATION_CAPABILITY)))
      .toEqual(['owner'])
  })

  it('does not let an accounting capability imply cost approval, or the reverse', () => {
    // The accident this replaces: granting somebody the authority to push
    // receivables must not hand them change-order approval inside Denver.
    for (const cap of [...Object.values(EMISSION_CAPABILITY), CURRENCY_DECLARATION_CAPABILITY]) {
      expect(cap).not.toBe('cost.approve')
      expect(cap.startsWith('accounting.'), `${cap} must live in its own family`).toBe(true)
    }
  })

  it('resolves record scope before emitting, not after', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('api/routes/accountingBoundary.ts', 'utf8')
    // Scope is resolved INLINE in each route rather than behind a shared
    // helper, so the ADR-014 census can see it per endpoint. That makes it
    // repetitive and makes it checkable — assert it for every type, in the
    // right order, so a fifth type cannot arrive with the check missing or
    // running after the emission.
    for (const type of Object.keys(EMISSION_CAPABILITY)) {
      const route = new RegExp(`post\\('/emit/${type}/:id'[\\s\\S]*?\\n\\}\\)`).exec(src)?.[0] ?? ''
      expect(route, `the ${type} emission route was not found`).toContain('emitAfterGuards')

      if (type === 'vendor') {
        // Vendors are tenant master data with no project parent and no scope
        // policy, so there is nothing to resolve against — asserted, not
        // assumed, so a later slice cannot drop a real check and call it this.
        expect(route).not.toContain('authorizeRecordScope')
        continue
      }
      const scopeAt = route.indexOf('authorizeRecordScope')
      const emitAt  = route.indexOf('emitAfterGuards')
      expect(scopeAt, `${type} must resolve record scope`).toBeGreaterThan(-1)
      expect(scopeAt, `${type}: scope must be resolved BEFORE the document is emitted`).toBeLessThan(emitAt)
    }
  })

  it('refuses a caller without the emission capability', async () => {
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

  it('requires the receivable capability to choose which customer a project bills to', async () => {
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
