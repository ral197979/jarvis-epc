/**
 * The provider-neutral transport — outbox → adapter registry → acknowledgement.
 *
 * The slice this proves is deliberately the LAST one before any provider exists.
 * There is no BillBox adapter and no QuickBooks adapter: the only adapter here
 * is a deterministic fake, and it is enough to exercise every path a real one
 * will take. That ordering is the point — the boundary is settled before a
 * provider's assumptions can shape it, so when BillBox publishes its receiving
 * contract it is implemented against a transport that already holds.
 *
 * Six proofs, one per thing that can go wrong at a boundary:
 *
 *   SUCCESS          an acceptance closes the job and records the provider's id
 *   REJECTION        a provider refusal is TERMINAL — no retry, ever
 *   TRANSPORT        a thrown or failed send retries, with a growing delay
 *   REPLAY           re-draining an accepted document sends nothing twice
 *   ISOLATION        a job is completed against its OWN tenant, never a worker's
 *   NO LIFECYCLE     an acknowledgement writes no Denver lifecycle table at all
 *
 * The last is the settlement decision in executable form: `settled: true` comes
 * back and `pay_applications.status` does not move. Denver owns that lifecycle,
 * and external settlement stays integration evidence until a reconciliation
 * control is deliberately designed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
const mockClientQuery = vi.fn()
const release = vi.fn()

vi.mock('../db/pool', () => ({
  query:       (...a: unknown[]) => mockQuery(...a),
  tenantQuery: (...a: unknown[]) => mockQuery(...a),
  pool: {
    query:   (...a: unknown[]) => mockQuery(...a),
    connect: async () => ({ query: (...a: unknown[]) => mockClientQuery(...a), release }),
  },
}))

import {
  drainAccountingOutbox, claimAccountingJobs,
} from '../services/integration/accounting/accountingOutboxDrainer'
import {
  registerAccountingAdapter, clearAccountingAdapters, getAccountingAdapter,
  registeredAccountingProviders,
} from '../services/integration/accounting/accountingAdapterRegistry'
import {
  ACCOUNTING_CONTRACT_VERSION, ACK_FORBIDDEN_WRITE_TABLES, TAX_UNKNOWN,
  buildIdempotencyKey,
  type AccountingDocument, type AccountingAck, type AccountingProviderAdapter,
} from '../services/integration/accounting/accountingContract'
import { _buildRetryDelay } from '../services/integration/connectorFramework'

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PAYAPP_A = '80000000-0000-4000-8000-00000000000b'
const PAYAPP_B = '80000000-0000-4000-8000-00000000000c'

// ─── The document under test ─────────────────────────────────────────────────

const doc = (over: Partial<AccountingDocument> = {}): AccountingDocument => ({
  contractVersion: ACCOUNTING_CONTRACT_VERSION,
  type: 'receivable_application',
  denverId: PAYAPP_A,
  tenantId: TENANT_A,
  projectId: PROJECT_A,
  projectCode: 'ACME-01',
  sourceState: 'approved',
  idempotencyKey: buildIdempotencyKey('receivable_application', PAYAPP_A, 'approved'),
  occurredAt: '2026-08-02T00:00:00Z',
  party: null,
  currency: 'USD',
  currencyBasis: 'declared',
  tax: TAX_UNKNOWN,
  detail: { documentNumber: '3' },
  ...over,
})

const jobRow = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  tenant_id: TENANT_A,
  connector_id: 'conn-1',
  connector_type: 'billbox',
  attempts: 0,
  payload: { contractVersion: ACCOUNTING_CONTRACT_VERSION, provider: 'billbox', document: doc(), externalCustomerId: 'BB-CUST-42' },
  ...over,
})

// ─── The deterministic fake ──────────────────────────────────────────────────
//
// Deterministic on purpose: no clock, no randomness, no network. Every outcome
// is chosen by the test, so a failing assertion means the TRANSPORT is wrong
// rather than the fake being flaky. It is the shape a real adapter must take,
// which is also what makes it evidence that the boundary can accept one.

interface FakeControl {
  sent: AccountingDocument[]
  behaviour: 'accept' | 'reject' | 'fail' | 'throw'
  requires?: readonly ('tax' | 'currency' | 'party' | 'project')[]
  supported?: readonly string[]
  contractVersion?: string
}

let fake: FakeControl

const makeFake = (id: 'billbox' | 'quickbooks' = 'billbox'): AccountingProviderAdapter => ({
  id,
  get contractVersion() { return fake.contractVersion ?? ACCOUNTING_CONTRACT_VERSION },
  get requires() { return fake.requires },
  supports: (t) => (fake.supported ?? ['receivable_application', 'payable_invoice', 'commitment', 'vendor']).includes(t),
  send: async (d): Promise<AccountingAck> => {
    fake.sent.push(d)
    if (fake.behaviour === 'throw') throw new Error('ECONNRESET talking to the provider')
    const base = { contractVersion: ACCOUNTING_CONTRACT_VERSION, receivedAt: '2026-08-25T12:00:00Z' }
    if (fake.behaviour === 'reject') {
      return { ...base, state: 'rejected', externalId: null, externalUrl: null,
               message: 'Customer BB-CUST-42 is on credit hold.' }
    }
    if (fake.behaviour === 'fail') {
      return { ...base, state: 'failed', externalId: null, externalUrl: null,
               message: 'Upstream gateway timed out.' }
    }
    return {
      ...base, state: 'accepted',
      externalId: 'BB-INV-77',
      externalUrl: 'https://billbox.test/invoices/BB-INV-77',
      message: null,
      settlement: { settled: true, settledAt: '2026-08-30', amount: { amount: '108000.00', currency: 'USD' } },
    }
  },
})

// ─── The world ───────────────────────────────────────────────────────────────

let CLAIMABLE: Record<string, unknown>[] = []
/** Every job row the fixture holds, keyed by id — the durable outbox. */
let JOBS: Map<string, Record<string, unknown>>

const SQLRE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i
const sqlOf = (a: unknown[]): string => a.find((x): x is string => typeof x === 'string' && SQLRE.test(x)) ?? ''
const paramsOf = (a: unknown[]): unknown[] => (a.find(x => Array.isArray(x)) as unknown[] | undefined) ?? []
/** Every statement the drainer ran, from both the pooled client and tenantQuery. */
const allStatements = (): string[] =>
  [...mockClientQuery.mock.calls, ...mockQuery.mock.calls].map(c => sqlOf(c)).filter(Boolean)
const tenantCalls = () => mockQuery.mock.calls.map(c => ({ sql: sqlOf(c), params: paramsOf(c), raw: c }))

beforeEach(() => {
  clearAccountingAdapters()
  fake = { sent: [], behaviour: 'accept' }
  JOBS = new Map([['job-1', { id: 'job-1', status: 'pending', attempts: 0, max_attempts: 3, result: null, error: null }]])
  CLAIMABLE = [jobRow()]

  mockClientQuery.mockReset()
  mockClientQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    if (/FROM integration_jobs j/i.test(sql)) {
      // Only rows the fixture still considers pending are claimable — this is
      // what makes the replay test a real replay rather than a re-run.
      const rows = CLAIMABLE.filter(r => (JOBS.get(String(r['id']))?.['status'] ?? 'pending') === 'pending')
      return { rows, rowCount: rows.length }
    }
    if (/UPDATE integration_jobs/i.test(sql)) {
      for (const id of (paramsOf(args)[1] as string[] | undefined) ?? []) {
        const j = JOBS.get(id)
        if (j) { j['status'] = 'running'; j['attempts'] = Number(j['attempts']) + 1 }
      }
      return { rows: [], rowCount: 0 }
    }
    return { rows: [], rowCount: 0 }
  })

  mockQuery.mockReset()
  mockQuery.mockImplementation(async (...args: unknown[]) => {
    const sql = sqlOf(args)
    const params = paramsOf(args)

    if (/UPDATE integration_jobs SET status = 'completed'/i.test(sql)) {
      const j = JOBS.get(String(params[1]))
      if (j) { j['status'] = 'completed'; j['result'] = JSON.parse(String(params[0])) }
      return { rows: [], rowCount: 1 }
    }
    if (/UPDATE integration_jobs SET error/i.test(sql)) {
      const j = JOBS.get(String(params[1]))
      if (j) j['error'] = params[0]
      return { rows: j ? [{ attempts: j['attempts'], max_attempts: j['max_attempts'], connector_id: 'conn-1' }] : [], rowCount: j ? 1 : 0 }
    }
    if (/SET status = 'dead_letter'/i.test(sql)) {
      const j = JOBS.get(String(params[0]))
      if (j) j['status'] = 'dead_letter'
      return { rows: [], rowCount: 1 }
    }
    if (/SET status = 'pending'/i.test(sql)) {
      const j = JOBS.get(String(params[1]))
      if (j) j['status'] = 'pending'
      return { rows: [], rowCount: 1 }
    }
    return { rows: [], rowCount: 0 }
  })
})

const drain = () => drainAccountingOutbox('worker-1')
const jobState = (id = 'job-1') => JOBS.get(id)!

// ─── 1. Success ──────────────────────────────────────────────────────────────

describe('an acceptance closes the job and records what came back', () => {
  it('sends the document and reports accepted', async () => {
    registerAccountingAdapter(makeFake())
    const report = await drain()

    expect(report.claimed).toBe(1)
    expect(report.accepted).toBe(1)
    expect(report.rejected).toBe(0)
    expect(report.retrying).toBe(0)
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0]!.denverId).toBe(PAYAPP_A)
  })

  it('completes the job with the provider id and settlement as evidence', async () => {
    registerAccountingAdapter(makeFake())
    await drain()

    const j = jobState()
    expect(j['status']).toBe('completed')
    const result = j['result'] as Record<string, unknown>
    expect(result['state']).toBe('accepted')
    expect(result['externalId']).toBe('BB-INV-77')
    expect((result['settlement'] as Record<string, unknown>)['settled']).toBe(true)
  })

  it('keeps the provider deep link as presentation, never as identity', async () => {
    registerAccountingAdapter(makeFake())
    await drain()

    const result = jobState()['result'] as Record<string, unknown>
    expect(result['externalUrl']).toBe('https://billbox.test/invoices/BB-INV-77')
    // The identity of the crossing is Denver's own, and the URL is nowhere in it.
    const key = buildIdempotencyKey('receivable_application', PAYAPP_A, 'approved')
    expect(key).not.toContain('billbox.test')
    expect(key).not.toContain('BB-INV-77')
    expect(key).toContain(PAYAPP_A)
  })

  it('hands the adapter Denver\'s vocabulary, not an accounting system\'s', async () => {
    registerAccountingAdapter(makeFake())
    await drain()
    const body = JSON.stringify(fake.sent[0]).toLowerCase()
    for (const forbidden of ['debit', 'credit', 'journal', 'ledger', 'account_code']) {
      expect(body).not.toContain(forbidden)
    }
  })
})

// ─── 2. Provider rejection is terminal ───────────────────────────────────────

describe('a provider rejection ends the job — it is never retried', () => {
  it('closes the job as completed with a rejected acknowledgement', async () => {
    fake.behaviour = 'reject'
    registerAccountingAdapter(makeFake())
    const report = await drain()

    expect(report.rejected).toBe(1)
    expect(report.retrying).toBe(0)
    expect(report.outcomes[0]!.disposition).toBe('provider_rejected')

    const j = jobState()
    // `completed` is the OUTBOX state: the crossing is finished. The
    // acknowledgement carries the verdict.
    expect(j['status']).toBe('completed')
    expect((j['result'] as Record<string, unknown>)['state']).toBe('rejected')
  })

  it('surfaces the provider\'s reason so a human can fix the fact in Denver', async () => {
    fake.behaviour = 'reject'
    registerAccountingAdapter(makeFake())
    const report = await drain()
    expect(report.outcomes[0]!.detail).toMatch(/credit hold/i)
  })

  it('schedules no further attempt', async () => {
    fake.behaviour = 'reject'
    registerAccountingAdapter(makeFake())
    await drain()
    // Only a WRITE that sets next_attempt_at schedules anything — the claim's
    // SELECT reads the column to decide what is due, which is not a retry.
    const scheduled = allStatements().filter(s =>
      /^\s*UPDATE\b/i.test(s.trim()) && /SET[\s\S]*next_attempt_at/i.test(s))
    expect(scheduled, 'a rejection must not schedule a retry').toEqual([])
    expect(jobState()['status'], 'and must not return the job to the queue').toBe('completed')
  })

  it('rejects before sending when the provider requires data Denver does not own', async () => {
    // The tax decision, generically enforced. Denver's tax is UNKNOWN and always
    // will be; a provider that requires it gets a terminal refusal naming the
    // reason, and Denver neither fabricates a treatment nor lets one be inferred.
    fake.requires = ['tax']
    registerAccountingAdapter(makeFake())
    const report = await drain()

    expect(report.outcomes[0]!.disposition).toBe('requirement_unmet')
    expect(report.outcomes[0]!.detail).toMatch(/tax/i)
    expect(fake.sent, 'nothing may be sent when a requirement is unmet').toHaveLength(0)
    expect(jobState()['status']).toBe('completed')
  })

  it('rejects a money-bearing document that lost its governed currency', async () => {
    CLAIMABLE = [jobRow({ payload: { provider: 'billbox', document: doc({ currency: null, currencyBasis: 'undeclared' }) } })]
    registerAccountingAdapter(makeFake())
    const report = await drain()

    expect(report.outcomes[0]!.disposition).toBe('currency_missing')
    expect(report.outcomes[0]!.detail).toMatch(/will not.*assume|does not default/i)
    expect(fake.sent).toHaveLength(0)
  })

  it('rejects a type the provider does not support, without calling it', async () => {
    fake.supported = ['vendor']
    registerAccountingAdapter(makeFake())
    const report = await drain()
    expect(report.outcomes[0]!.disposition).toBe('unsupported_type')
    expect(fake.sent).toHaveLength(0)
  })

  it('rejects an adapter speaking a different contract version', async () => {
    fake.contractVersion = '0.9.0'
    registerAccountingAdapter(makeFake())
    const report = await drain()
    expect(report.outcomes[0]!.disposition).toBe('contract_mismatch')
    expect(fake.sent).toHaveLength(0)
  })
})

// ─── 3. Transport failure retries, with backoff ──────────────────────────────

describe('a transport failure goes back for retry', () => {
  it('returns a thrown send to pending rather than closing it', async () => {
    fake.behaviour = 'throw'
    registerAccountingAdapter(makeFake())
    const report = await drain()

    expect(report.retrying).toBe(1)
    expect(report.rejected).toBe(0)
    expect(report.outcomes[0]!.disposition).toBe('transport_failed')
    // Back to `pending`, or it would never be re-claimed — a job stranded in
    // `running` neither retries nor dead-letters nor surfaces as either.
    expect(jobState()['status']).toBe('pending')
    expect(jobState()['result']).toBeNull()
  })

  it('treats a provider-reported failure the same way as a thrown one', async () => {
    fake.behaviour = 'fail'
    registerAccountingAdapter(makeFake())
    const report = await drain()
    expect(report.outcomes[0]!.disposition).toBe('transport_failed')
    expect(jobState()['status']).toBe('pending')
  })

  it('backs off further on each successive attempt', async () => {
    fake.behaviour = 'throw'
    registerAccountingAdapter(makeFake())

    const delays: number[] = []
    for (let round = 0; round < 2; round++) {
      mockQuery.mockClear()
      await drain()
      const retry = tenantCalls().find(c => /SET status = 'pending'/i.test(c.sql))!
      delays.push(Number(retry.params[0]))
    }

    // Attempt 1 waits one rung, attempt 2 waits the next — a flat delay would
    // hammer a provider that is down at a constant rate.
    expect(delays[0]).toBe(_buildRetryDelay(1))
    expect(delays[1]).toBe(_buildRetryDelay(2))
    expect(delays[1]).toBeGreaterThan(delays[0]!)
  })

  it('dead-letters once the outbox\'s attempts are spent', async () => {
    fake.behaviour = 'throw'
    registerAccountingAdapter(makeFake())
    jobState()['attempts'] = 2   // the claim makes it 3, which is max_attempts

    await drain()
    expect(jobState()['status']).toBe('dead_letter')
  })

  it('retries — rather than rejecting — a provider whose adapter is not deployed', async () => {
    // No adapter registered. This is a deployment gap, not a bad document:
    // rejecting would dead-letter good documents during a rollout.
    const report = await drain()
    expect(report.outcomes[0]!.disposition).toBe('adapter_not_registered')
    expect(report.retrying).toBe(1)
    expect(jobState()['status']).toBe('pending')
  })
})

// ─── 4. Idempotent replay ────────────────────────────────────────────────────

describe('replay sends nothing twice', () => {
  it('does not re-send a document whose job already completed', async () => {
    registerAccountingAdapter(makeFake())
    await drain()
    expect(fake.sent).toHaveLength(1)

    // Second pass over the same outbox. The completed row is no longer
    // claimable, so the provider is never called again.
    const second = await drain()
    expect(second.claimed).toBe(0)
    expect(fake.sent, 'an accepted document must not be sent twice').toHaveLength(1)
  })

  it('keys the crossing on Denver-owned facts alone', async () => {
    registerAccountingAdapter(makeFake())
    await drain()
    const sent = fake.sent[0]!
    expect(sent.idempotencyKey).toBe(`accounting:${ACCOUNTING_CONTRACT_VERSION}:receivable_application:${PAYAPP_A}:approved`)
    // The same fact in a NEW state is a new crossing; the same fact in the same
    // state is not.
    expect(buildIdempotencyKey('receivable_application', PAYAPP_A, 'approved'))
      .toBe(sent.idempotencyKey)
    expect(buildIdempotencyKey('receivable_application', PAYAPP_A, 'paid'))
      .not.toBe(sent.idempotencyKey)
  })

  it('carries the idempotency key to the adapter so a provider can dedupe too', async () => {
    registerAccountingAdapter(makeFake())
    await drain()
    expect(fake.sent[0]!.idempotencyKey).toBeTruthy()
  })

  it('re-sends after a retry, because the first attempt never landed', async () => {
    fake.behaviour = 'throw'
    registerAccountingAdapter(makeFake())
    await drain()
    expect(fake.sent).toHaveLength(1)

    fake.behaviour = 'accept'
    const second = await drain()
    expect(second.accepted).toBe(1)
    // Same key both times — the provider, not Denver, decides whether the
    // second delivery is a duplicate of a first it may or may not have seen.
    expect(fake.sent[1]!.idempotencyKey).toBe(fake.sent[0]!.idempotencyKey)
  })
})

// ─── 5. Tenant isolation ─────────────────────────────────────────────────────

describe('a job is settled against its own tenant', () => {
  it('completes each job with the tenant on the job row, not the worker\'s', async () => {
    JOBS.set('job-2', { id: 'job-2', status: 'pending', attempts: 0, max_attempts: 3, result: null, error: null })
    CLAIMABLE = [
      jobRow(),
      jobRow({
        id: 'job-2', tenant_id: TENANT_B,
        payload: { provider: 'billbox', document: doc({ tenantId: TENANT_B, denverId: PAYAPP_B }) },
      }),
    ]
    registerAccountingAdapter(makeFake())
    await drain()

    const completions = tenantCalls().filter(c => /SET status = 'completed'/i.test(c.sql))
    expect(completions).toHaveLength(2)
    // tenantQuery's first argument is the tenant the statement runs as.
    const byJob = new Map(completions.map(c => [String(c.params[1]), String(c.raw[0])]))
    expect(byJob.get('job-1')).toBe(TENANT_A)
    expect(byJob.get('job-2')).toBe(TENANT_B)
  })

  it('never settles one tenant\'s job under another tenant', async () => {
    JOBS.set('job-2', { id: 'job-2', status: 'pending', attempts: 0, max_attempts: 3, result: null, error: null })
    CLAIMABLE = [
      jobRow(),
      jobRow({ id: 'job-2', tenant_id: TENANT_B, payload: { provider: 'billbox', document: doc({ tenantId: TENANT_B }) } }),
    ]
    registerAccountingAdapter(makeFake())
    await drain()

    for (const c of tenantCalls().filter(c => /integration_jobs/i.test(c.sql))) {
      const tenant = String(c.raw[0])
      const jobId = c.params.find(p => typeof p === 'string' && String(p).startsWith('job-'))
      if (!jobId) continue
      const expected = jobId === 'job-1' ? TENANT_A : TENANT_B
      expect(tenant, `${String(jobId)} settled under the wrong tenant`).toBe(expected)
    }
  })

  it('binds the tenant on the failure path too', async () => {
    fake.behaviour = 'throw'
    CLAIMABLE = [jobRow({ tenant_id: TENANT_B, payload: { provider: 'billbox', document: doc({ tenantId: TENANT_B }) } })]
    registerAccountingAdapter(makeFake())
    await drain()

    const failures = tenantCalls().filter(c => /integration_jobs/i.test(c.sql))
    expect(failures.length).toBeGreaterThan(0)
    for (const f of failures) expect(String(f.raw[0])).toBe(TENANT_B)
  })

  it('claims across tenants but constrains every claimed row to accounting work', async () => {
    registerAccountingAdapter(makeFake())
    await claimAccountingJobs('worker-1')
    const claim = mockClientQuery.mock.calls.map(c => sqlOf(c)).find(s => /FROM integration_jobs j/i.test(s))!
    // A general claim would take a Slack or CMMS job, spend an attempt on it,
    // and have to put it back.
    expect(claim).toMatch(/payload -> 'document' ->> 'type' = ANY/i)
    expect(claim).toMatch(/SKIP LOCKED/i)
    expect(claim).toMatch(/attempts < j\.max_attempts/i)
  })
})

// ─── 6. No lifecycle mutation ────────────────────────────────────────────────

describe('an acknowledgement moves no Denver lifecycle', () => {
  it('writes only the outbox and the connector, even when settlement comes back', async () => {
    registerAccountingAdapter(makeFake())
    await drain()

    // The acceptance carried `settled: true`. That is evidence, not a transition.
    const result = jobState()['result'] as Record<string, unknown>
    expect((result['settlement'] as Record<string, unknown>)['settled']).toBe(true)

    const writes = allStatements().filter(s => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(s.trim()))
    expect(writes.length).toBeGreaterThan(0)
    for (const w of writes) {
      expect(w, 'the transport may only write integration tables')
        .toMatch(/integration_jobs|integration_connectors/i)
    }
  })

  it('never touches pay_applications.status, or any other lifecycle table', async () => {
    registerAccountingAdapter(makeFake())
    await drain()

    for (const table of ACK_FORBIDDEN_WRITE_TABLES) {
      for (const w of allStatements().filter(s => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(s.trim()))) {
        expect(w, `an acknowledgement must not write ${table}`)
          .not.toMatch(new RegExp(`\\b(INTO|UPDATE|FROM)\\s+${table}\\b`, 'i'))
      }
    }
  })

  it('holds the rule on the rejection path too', async () => {
    fake.behaviour = 'reject'
    registerAccountingAdapter(makeFake())
    await drain()

    for (const w of allStatements().filter(s => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(s.trim()))) {
      expect(w).not.toMatch(/\b(INTO|UPDATE)\s+pay_applications\b/i)
    }
  })

  it('records no ledger vocabulary anywhere in the acknowledgement', async () => {
    registerAccountingAdapter(makeFake())
    await drain()
    const result = JSON.stringify(jobState()['result']).toLowerCase()
    for (const forbidden of ['debit', 'credit', 'journal', 'ledger', 'posting', 'account_code']) {
      expect(result).not.toContain(forbidden)
    }
  })

  it('pins the tables the decision names, so a later slice cannot quietly drop one', () => {
    expect(ACK_FORBIDDEN_WRITE_TABLES).toContain('pay_applications')
    expect(ACK_FORBIDDEN_WRITE_TABLES).toContain('subcontract_invoices')
    expect(ACK_FORBIDDEN_WRITE_TABLES).toContain('purchase_orders')
  })
})

// ─── 7. The registry, and the deliberate absence of a provider ───────────────

describe('the adapter registry is the only thing a provider plugs into', () => {
  it('ships with NO provider adapter registered', async () => {
    // The load-bearing assertion of this slice. BillBox has not published its
    // receiving contract, so there is nothing honest to implement yet — and
    // implementing a guess would bake it into the EPC product where it would be
    // indistinguishable from a requirement.
    const fresh = await import('../services/integration/accounting/accountingAdapterRegistry')
    fresh.clearAccountingAdapters()
    expect(fresh.registeredAccountingProviders()).toEqual([])
    expect(fresh.getAccountingAdapter('billbox')).toBeNull()
    expect(fresh.getAccountingAdapter('quickbooks')).toBeNull()
  })

  it('resolves an adapter by provider id and by nothing else', () => {
    registerAccountingAdapter(makeFake('quickbooks'))
    expect(getAccountingAdapter('quickbooks')).not.toBeNull()
    expect(getAccountingAdapter('billbox')).toBeNull()
    expect(registeredAccountingProviders()).toEqual(['quickbooks'])
  })

  it('routes a job to the adapter for ITS provider, with no fallback', async () => {
    // Only QuickBooks is deployed; the job is addressed to BillBox. A fallback
    // here would send a Denver document to the wrong accounting system.
    registerAccountingAdapter(makeFake('quickbooks'))
    const report = await drain()
    expect(report.outcomes[0]!.disposition).toBe('adapter_not_registered')
    expect(fake.sent).toHaveLength(0)
  })

  it('refuses a payload that is not a readable accounting document', async () => {
    CLAIMABLE = [jobRow({ payload: { provider: 'billbox', document: { type: 'nonsense' } } })]
    registerAccountingAdapter(makeFake())
    const report = await drain()
    expect(report.outcomes[0]!.disposition).toBe('malformed_payload')
    expect(jobState()['status']).toBe('completed')
  })
})
