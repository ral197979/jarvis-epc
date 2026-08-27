/**
 * The accounting boundary against a REAL PostgreSQL and the REAL router.
 *
 * Why this file exists
 * ────────────────────
 * Every other suite here mocks `../db/pool`, which means it proves the code is
 * internally consistent and nothing about whether the database agrees. That gap
 * is not theoretical: the mocked suites happily emitted to `billbox` because the
 * fixture returned a connector id for it, while the live `connector_type` enum
 * had no such label — so a BillBox connector row could not exist and every real
 * emission would have refused with `provider_not_configured`. Migration 090
 * closes that, and this file is what found it.
 *
 * What is real here: PostgreSQL, all 90 migrations, row-level security under the
 * non-owner `jarvis_app` role, `requireTenant`, `requireCapability`,
 * `resolveCurrentUser`, `authorizeRecordScope`, the projection, the emission
 * service and the `integration_jobs` outbox. Only the JWT layer is stubbed, so
 * that a request can carry an identity without minting a token.
 *
 * Running it
 * ──────────
 * Skipped unless `ACCOUNTING_IT_DATABASE_URL` points at a migrated database, so
 * `npm test` stays green on a machine with no PostgreSQL. Set
 * `ACCOUNTING_IT_DATABASE_URL_APP` to a NON-OWNER role to exercise RLS as
 * production does; without it the owner connection is used and RLS is not the
 * control under test.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import express, { type Express } from 'express'
import request from 'supertest'

const IT_URL     = process.env['ACCOUNTING_IT_DATABASE_URL']
const IT_URL_APP = process.env['ACCOUNTING_IT_DATABASE_URL_APP']

// ─── Identity, the one stubbed layer ─────────────────────────────────────────
interface Caller { id: string; tenantId: string; role: string }
const g = globalThis as Record<string, unknown>
const setCaller = (c: Caller): void => { g['__itCaller'] = c }

vi.mock('../auth', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    const c = (globalThis as Record<string, unknown>)['__itCaller'] as Caller
    req['auth'] = { sub: c.id, tid: c.tenantId, role: c.role, jti: 'it' }
    next()
  },
  requireRole: () => (_r: unknown, _s: unknown, n: () => void) => n(),
}))

const TENANT_A  = 'a0000000-0000-4000-8000-00000000ac01'
const TENANT_B  = 'b0000000-0000-4000-8000-00000000ac02'
const OWNER_A   = 'a1000000-0000-4000-8000-00000000ac01'
const PM_A      = 'a2000000-0000-4000-8000-00000000ac01'
const OWNER_B   = 'b1000000-0000-4000-8000-00000000ac02'
const PROJECT_A = 'a3000000-0000-4000-8000-00000000ac01'
const PROJECT_A2= 'a4000000-0000-4000-8000-00000000ac01'
const PROJECT_B = 'b3000000-0000-4000-8000-00000000ac02'
const APP_APPROVED  = 'a5000000-0000-4000-8000-00000000ac01'
const APP_SUBMITTED = 'a6000000-0000-4000-8000-00000000ac01'
const APP_PAID      = 'a7000000-0000-4000-8000-00000000ac01'
const APP_OTHER_PRJ = 'a8000000-0000-4000-8000-00000000ac01'

const BASE = '/api/v1/integrations/accounting'

const describeIt = IT_URL ? describe : describe.skip

describeIt('the accounting boundary, against a real database', () => {
  let app: Express
  let query: (t: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>
  let closePools: () => Promise<void>

  beforeAll(async () => {
    // Must precede the first import of `../db/pool`, which reads these at load.
    process.env['DATABASE_URL']     = IT_URL
    process.env['DATABASE_URL_APP'] = IT_URL_APP ?? IT_URL

    const pool = await import('../db/pool')
    query = pool.query as never
    closePools = async () => { try { await pool.pool.end() } catch { /* already closed */ } }

    const { requireAuth } = await import('../auth')
    const { requireTenant } = await import('../middleware/tenant')
    const { accountingBoundaryRouter } = await import('../routes/accountingBoundary')

    app = express()
    app.use(express.json())
    app.use(BASE, requireAuth as never, requireTenant() as never, accountingBoundaryRouter as never)

    await seed()
  })

  afterAll(async () => {
    if (!IT_URL) return
    await teardown()
    await closePools()
  })

  /**
   * Clean only the LEAF tables this suite writes.
   *
   * Tenants, users and projects are upserted rather than deleted. That is not
   * tidiness: `action_events` is an append-only table whose INSTEAD rules block
   * UPDATE and DELETE, so the `ON DELETE SET NULL` foreign key from
   * `action_events.actor_id` to `users.id` can never fire — PostgreSQL refuses
   * the delete with "referential integrity query ... gave unexpected result".
   * No user row can be removed from this schema at all. That is a pre-existing
   * defect this suite discovered and does not fix; it is recorded rather than
   * worked around silently.
   */
  async function teardown(): Promise<void> {
    await query(`DELETE FROM integration_jobs WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]])
    await query(`DELETE FROM integration_connectors WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]])
    await query(`DELETE FROM accounting_currency_declarations WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]])
    await query(`DELETE FROM accounting_party_links WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]])
    await query(`DELETE FROM pay_applications WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]])
  }

  async function seed(): Promise<void> {
    await teardown()
    await query(`
      INSERT INTO tenants (id, name, slug, status) VALUES
        ($1,'IT Tenant A','it-tenant-a','active'),
        ($2,'IT Tenant B','it-tenant-b','active')
      ON CONFLICT (id) DO UPDATE SET status = 'active'
    `, [TENANT_A, TENANT_B])
    // `tenants.status` DEFAULTs to 'pending' and requireTenant admits only
    // 'active'. Seeding without it produced a uniform 403 that looked like an
    // authorization failure and was not one — worth stating so the next reader
    // of this fixture does not chase the capability guard.

    await query(`
      INSERT INTO users (id, tenant_id, email, display_name, password_hash, role, is_active) VALUES
        ($1,$4,'it-owner-a@example.test','IT Owner A','x','owner',true),
        ($2,$4,'it-pm-a@example.test','IT PM A','x','project_manager',true),
        ($3,$5,'it-owner-b@example.test','IT Owner B','x','owner',true)
      ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, is_active = EXCLUDED.is_active
    `, [OWNER_A, PM_A, OWNER_B, TENANT_A, TENANT_B])
    await query(`
      INSERT INTO projects (id, tenant_id, code, name) VALUES
        ($1,$4,'IT-A-01','IT Project A'),
        ($2,$4,'IT-A-02','IT Project A2'),
        ($3,$5,'IT-B-01','IT Project B')
      ON CONFLICT (id) DO UPDATE SET client_name = NULL
    `, [PROJECT_A, PROJECT_A2, PROJECT_B, TENANT_A, TENANT_B])
    await query(`
      INSERT INTO pay_applications (id, tenant_id, project_id, application_number, status, period_start, period_end)
      VALUES ($1,$5,$6,101,'approved','2026-07-01','2026-07-31'),
             ($2,$5,$6,102,'submitted','2026-07-01','2026-07-31'),
             ($3,$5,$6,103,'paid','2026-07-01','2026-07-31'),
             ($4,$5,$7,104,'approved','2026-07-01','2026-07-31')
    `, [APP_APPROVED, APP_SUBMITTED, APP_PAID, APP_OTHER_PRJ, TENANT_A, PROJECT_A, PROJECT_A2])
    // Both providers are configured for tenant A, so provider selection is a
    // real choice rather than the only option available.
    await query(`
      INSERT INTO integration_connectors (tenant_id, name, connector_type, status, created_by) VALUES
        ($1,'IT BillBox','billbox','active',$2),
        ($1,'IT QuickBooks','quickbooks','active',$2)
    `, [TENANT_A, OWNER_A])
    // `status` is stated because it DEFAULTs to 'configuring', which does not
    // receive emissions. An operator activating a connector is a real step, and
    // the fixture performs it rather than assuming it away.
  }

  const asOwnerA = (): void => setCaller({ id: OWNER_A, tenantId: TENANT_A, role: 'owner' })
  const emit = (type: string, id: string, provider: string) =>
    request(app).post(`${BASE}/emit/${type}/${id}`).send({ provider })
  const jobsFor = async (denverId: string) => (await query(
    `SELECT id, payload, idempotency_key, status FROM integration_jobs
      WHERE payload -> 'document' ->> 'denverId' = $1 ORDER BY created_at`, [denverId])).rows

  // ─── 1. Undeclared currency blocks emission ────────────────────────────────

  describe('a project with no declared currency cannot emit', () => {
    it('refuses with currency_not_declared, and queues nothing', async () => {
      asOwnerA()
      const res = await emit('receivable_application', APP_APPROVED, 'billbox')

      expect(res.status).toBe(409)
      expect(res.body.error).toBe('currency_not_declared')
      expect(await jobsFor(APP_APPROVED), 'nothing may reach the outbox').toHaveLength(0)
    })

    it('refuses even though the project row itself says USD', async () => {
      // The exact failure the decision exists to prevent. `projects.currency` is
      // DEFAULT 'USD', so this project reads USD without anyone having said so.
      const { rows } = await query(`SELECT currency FROM projects WHERE id = $1`, [PROJECT_A])
      expect(rows[0]!['currency'], 'the DEFAULT is present in the column').toBe('USD')

      asOwnerA()
      const res = await emit('receivable_application', APP_APPROVED, 'billbox')
      expect(res.status).toBe(409)
      expect(res.body.error).toBe('currency_not_declared')
      expect(res.body.detail).toMatch(/will not default to USD/i)
    })

    it('reports the project as undeclared through the read route', async () => {
      asOwnerA()
      const res = await request(app).get(`${BASE}/currency/${PROJECT_A}`)
      expect(res.status).toBe(200)
      expect(res.body.data.declaration).toBeNull()
      expect(res.body.data.basis).toBe('undeclared')
    })
  })

  // ─── 2. Declaring through the API ──────────────────────────────────────────

  describe('the currency is declared through the API and persists', () => {
    it('accepts a governed ISO-4217 code and writes one row', async () => {
      asOwnerA()
      const res = await request(app).put(`${BASE}/currency/${PROJECT_A}`)
        .send({ currency: 'EUR', note: 'contract is euro-denominated' })

      expect(res.status).toBe(200)
      expect(res.body.data.declaration.currency).toBe('EUR')
      expect(res.body.data.basis).toBe('declared')

      const { rows } = await query(
        `SELECT currency, declared_by, note FROM accounting_currency_declarations WHERE project_id = $1`, [PROJECT_A])
      expect(rows).toHaveLength(1)
      expect(rows[0]!['currency']).toBe('EUR')
      // Governed means attributable: a declaration with no author is not one.
      expect(rows[0]!['declared_by']).toBe(OWNER_A)
    })

    it('normalises case but never invents a code', async () => {
      asOwnerA()
      expect((await request(app).put(`${BASE}/currency/${PROJECT_A2}`).send({ currency: 'gbp' })).body.data.declaration.currency)
        .toBe('GBP')

      const bad = await request(app).put(`${BASE}/currency/${PROJECT_A2}`).send({ currency: 'XYZ' })
      expect(bad.status).toBe(400)
      expect(bad.body.error).toBe('unknown_currency')
      // The rejected write must not have disturbed the good one.
      const { rows } = await query(`SELECT currency FROM accounting_currency_declarations WHERE project_id = $1`, [PROJECT_A2])
      expect(rows[0]!['currency']).toBe('GBP')
    })

    it('re-declares in place rather than creating a second row', async () => {
      asOwnerA()
      await request(app).put(`${BASE}/currency/${PROJECT_A}`).send({ currency: 'USD', note: 're-denominated' })
      const { rows } = await query(
        `SELECT currency FROM accounting_currency_declarations WHERE project_id = $1`, [PROJECT_A])
      expect(rows, 'one project has exactly one denomination').toHaveLength(1)
      expect(rows[0]!['currency']).toBe('USD')
    })

    it('refuses a caller without accounting.currency.declare', async () => {
      setCaller({ id: PM_A, tenantId: TENANT_A, role: 'project_manager' })
      const res = await request(app).put(`${BASE}/currency/${PROJECT_A}`).send({ currency: 'JPY' })
      expect(res.status).toBe(403)
      const { rows } = await query(`SELECT currency FROM accounting_currency_declarations WHERE project_id = $1`, [PROJECT_A])
      expect(rows[0]!['currency'], 'a refused write must change nothing').toBe('USD')
    })
  })

  // ─── 3. The party mapping is per provider ──────────────────────────────────

  describe('the customer mapping is resolved for the requested provider', () => {
    it('still refuses a receivable when only the OTHER provider is mapped', async () => {
      asOwnerA()
      await request(app).put(`${BASE}/party/${PROJECT_A}/quickbooks`)
        .send({ external_customer_id: 'QB-CUST-1', external_customer_label: 'QuickBooks Co' })

      // Currency is declared and a mapping exists — but not for BillBox.
      const res = await emit('receivable_application', APP_APPROVED, 'billbox')
      expect(res.status).toBe(409)
      expect(res.body.error).toBe('customer_mapping_missing')
      expect(await jobsFor(APP_APPROVED)).toHaveLength(0)
    })

    it('never substitutes the project client name for a missing mapping', async () => {
      await query(`UPDATE projects SET client_name = 'Denver Water Authority' WHERE id = $1`, [PROJECT_A])
      asOwnerA()
      const res = await emit('receivable_application', APP_APPROVED, 'billbox')
      expect(JSON.stringify(res.body)).not.toContain('Denver Water Authority')
      expect(await jobsFor(APP_APPROVED)).toHaveLength(0)
    })

    it('stores a distinct external id per provider', async () => {
      asOwnerA()
      await request(app).put(`${BASE}/party/${PROJECT_A}/billbox`)
        .send({ external_customer_id: 'BB-CUST-42', external_customer_label: 'BillBox Co' })

      const { rows } = await query(
        `SELECT provider, external_customer_id FROM accounting_party_links WHERE project_id = $1 ORDER BY provider`, [PROJECT_A])
      expect(rows).toEqual([
        { provider: 'billbox',    external_customer_id: 'BB-CUST-42' },
        { provider: 'quickbooks', external_customer_id: 'QB-CUST-1'  },
      ])
    })
  })

  // ─── 4. The approved receivable reaches the outbox ─────────────────────────

  describe('an approved receivable reaches the outbox with the right identity', () => {
    it('enqueues one job carrying the declared currency and the mapped customer', async () => {
      asOwnerA()
      const res = await emit('receivable_application', APP_APPROVED, 'billbox')
      expect(res.status, JSON.stringify(res.body)).toBe(202)
      expect(res.body.data.emitted).toBe(true)

      const jobs = await jobsFor(APP_APPROVED)
      expect(jobs).toHaveLength(1)
      const payload = jobs[0]!['payload'] as Record<string, unknown>
      const doc = payload['document'] as Record<string, unknown>

      expect(payload['provider']).toBe('billbox')
      // The customer resolved for THIS provider, carried with the document so
      // the adapter cannot look up or substitute a different one.
      expect(payload['externalCustomerId']).toBe('BB-CUST-42')
      expect(doc['currency']).toBe('USD')
      expect(doc['currencyBasis']).toBe('declared')
      expect(doc['denverId']).toBe(APP_APPROVED)
      expect(jobs[0]!['idempotency_key'])
        .toBe(`accounting:1.1.0:receivable_application:${APP_APPROVED}:approved`)
    })

    it('states tax as explicitly unknown rather than omitting it', async () => {
      const doc = ((await jobsFor(APP_APPROVED))[0]!['payload'] as Record<string, unknown>)['document'] as Record<string, unknown>
      const tax = doc['tax'] as Record<string, unknown>
      expect(tax['known']).toBe(false)
      expect(String(tax['reason'])).toMatch(/Absent is not zero/i)
    })

    it('dedupes a repeat emission on the real unique index, not in memory', async () => {
      asOwnerA()
      const res = await emit('receivable_application', APP_APPROVED, 'billbox')
      expect(res.status).toBe(409)
      expect(res.body.error).toBe('already_emitted')
      expect(await jobsFor(APP_APPROVED), 'still exactly one row').toHaveLength(1)
    })

    it('writes no ledger and touches no lifecycle table', async () => {
      const { rows } = await query(`SELECT status FROM pay_applications WHERE id = $1`, [APP_APPROVED])
      expect(rows[0]!['status'], 'emission must not advance the document').toBe('approved')
      const body = JSON.stringify((await jobsFor(APP_APPROVED))[0]!['payload']).toLowerCase()
      for (const forbidden of ['debit', 'credit', 'journal', 'ledger']) expect(body).not.toContain(forbidden)
    })

    it('refuses a provider the tenant has not configured', async () => {
      // PROJECT_A2 is declared GBP and mapped below, so the only thing missing
      // is an ACTIVE connector. Pausing rather than deleting is what an operator
      // actually does, and it is the case the old `status <> 'disabled'`
      // predicate got wrong.
      asOwnerA()
      await request(app).put(`${BASE}/party/${PROJECT_A2}/quickbooks`).send({ external_customer_id: 'QB-CUST-2' })
      await query(`UPDATE integration_connectors SET status = 'paused' WHERE tenant_id = $1 AND connector_type = 'quickbooks'`, [TENANT_A])

      const res = await emit('receivable_application', APP_OTHER_PRJ, 'quickbooks')
      expect(res.status, JSON.stringify(res.body)).toBe(409)
      expect(res.body.error).toBe('provider_not_configured')
      expect(res.body.detail).toMatch(/paused|active/i)

      await query(`UPDATE integration_connectors SET status = 'active' WHERE tenant_id = $1 AND connector_type = 'quickbooks'`, [TENANT_A])
    })
  })

  // ─── 5. Submitted and paid refuse, for different reasons ───────────────────

  describe('workflow and settlement are refused, each in its own words', () => {
    it('refuses a SUBMITTED application because submitted is workflow', async () => {
      asOwnerA()
      const res = await emit('receivable_application', APP_SUBMITTED, 'billbox')
      expect(res.status).toBe(409)
      expect(res.body.error).toBe('not_approved')
      expect(res.body.sourceState).toBe('submitted')
      expect(res.body.detail).toMatch(/workflow, not accounting authorization/i)
      expect(await jobsFor(APP_SUBMITTED)).toHaveLength(0)
    })

    it('refuses a PAID application because settlement is not a second document', async () => {
      asOwnerA()
      const res = await emit('receivable_application', APP_PAID, 'billbox')
      expect(res.status).toBe(409)
      expect(res.body.error).toBe('not_approved')
      expect(res.body.sourceState).toBe('paid')
      expect(res.body.detail).toMatch(/acknowledgement boundary/i)
      expect(await jobsFor(APP_PAID)).toHaveLength(0)
    })

    it('gives the two refusals genuinely different reasons', async () => {
      asOwnerA()
      const submitted = (await emit('receivable_application', APP_SUBMITTED, 'billbox')).body.detail
      const paid      = (await emit('receivable_application', APP_PAID, 'billbox')).body.detail
      expect(submitted).not.toBe(paid)
    })
  })

  // ─── 6. Tenant isolation, under real row-level security ────────────────────

  describe('tenant isolation holds against the database, not just the code', () => {
    it('hides another tenant\'s pay application behind a 404', async () => {
      setCaller({ id: OWNER_B, tenantId: TENANT_B, role: 'owner' })
      const res = await emit('receivable_application', APP_APPROVED, 'billbox')
      expect(res.status).toBe(404)
      expect(await jobsFor(APP_APPROVED), 'no new job for a cross-tenant attempt').toHaveLength(1)
    })

    it('hides another tenant\'s currency declaration', async () => {
      setCaller({ id: OWNER_B, tenantId: TENANT_B, role: 'owner' })
      const res = await request(app).get(`${BASE}/currency/${PROJECT_A}`)
      // Project scope refuses before the read; either way tenant A's EUR/USD
      // declaration must not be disclosed.
      expect([403, 404]).toContain(res.status)
      expect(JSON.stringify(res.body)).not.toContain('USD')
    })

    it('confirms RLS is the control under test, not just a WHERE clause', async () => {
      // If the app pool is the owner, this suite proves app-layer filtering
      // only. Stated rather than assumed, so a green run is not over-read.
      const appRoleIsNonOwner = Boolean(IT_URL_APP) && IT_URL_APP !== IT_URL
      const { rows } = await query(`SELECT relforcerowsecurity FROM pg_class WHERE relname = 'accounting_currency_declarations'`)
      expect(rows[0]!['relforcerowsecurity'], 'FORCE RLS must be set on the new table').toBe(true)
      expect(appRoleIsNonOwner, 'set ACCOUNTING_IT_DATABASE_URL_APP to a non-owner role').toBe(true)
    })
  })
})
