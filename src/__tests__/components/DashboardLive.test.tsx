/**
 * Dashboard — the live-data contract.
 *
 * Every KPI here was computed from `biz`, which reaches the component as a prop
 * and is never fed by a domain API. Each was matched against the APIs that
 * ALREADY exist; three can be derived truthfully and are fetched, and the rest
 * cannot and say so.
 *
 *   DERIVABLE       Procurement  /api/v1/purchase-orders   procurement.view
 *                   Documents    /api/v1/files/documents   docs.view
 *                   Activity     /api/v1/audit             audit.view
 *
 *   NOT DERIVABLE   Pipeline, Active Contracts — tables with no routes
 *                   Revenue, AR — no invoices table at all
 *                   TRIR — see below
 *
 * TRIR is the one worth stating plainly. It was `(recordable × 200,000) /
 * (200,000 × toolbox talks)`: `safety_incidents` has no `recordable` column so
 * the numerator counted nothing, and `toolbox_talks` has no table so the
 * denominator was invented. TRIR is a regulated OSHA metric, and a fabricated
 * one on an executive dashboard is a compliance claim about a workplace.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import Dashboard from '../../components/Dashboard'

const PO_ROWS = [
  { id: 'po1', po_number: 'PO-1', status: 'ordered',   total_amount: '450000.00' },
  { id: 'po2', po_number: 'PO-2', status: 'received',  total_amount: '180000.00' },
  { id: 'po3', po_number: 'PO-3', status: 'cancelled', total_amount: '999999.00' },
]
const DOC_ROWS = [
  { id: 'd1', title: 'P&ID',      status: 'active' },
  { id: 'd2', title: 'Spec',      status: 'active' },
  { id: 'd3', title: 'Half-sent', status: 'uploading' },
  { id: 'd4', title: 'Withdrawn', status: 'deleted' },
]
const AUDIT_ROWS = [
  { id: 'a1', action: 'update', resource: 'purchase_orders', user_name: 'Jane Smith', created_at: '2026-08-24T09:00:00.000Z' },
  { id: 'a2', action: 'create', resource: 'documents',       user_email: 'bob@x.test', created_at: '2026-08-24T08:00:00.000Z' },
]

const EMPTY_BIZ = {
  leads: [], contracts: [], invoices: [], purchase_orders: [], documents: [],
  incidents: [], jhas: [], toolbox_talks: [], evm_projects: [], activity_log: [],
} as never

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) })
const denied = () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) })

let fetchMock: ReturnType<typeof vi.fn>
const kpi = (name: string) => screen.getByRole('group', { name })

/** The API's refusal envelope: a null rate with a machine-readable reason. */
const TRIR_UNAVAILABLE = {
  trir: null, reason: 'unclassified_incidents',
  detail: 'Some incidents in this period have no recordability determination.',
  recordableIncidents: null, unclassifiedIncidents: 3, totalIncidents: 5,
  exposureHours: null, uncoveredDays: 0,
}

/** The contracts summary envelope. No writer exists yet, hence `writable:false`. */
const CONTRACTS_EMPTY = { active: 0, activeValue: 0, total: 0, byStatus: {}, writable: false }

/** Leads summary. `stage` is ungoverned, hence `stageGoverned:false`. */
const LEADS_EMPTY = {
  pipelineWeighted: 0, valued: 0, unvalued: 0, total: 0,
  byStage: {}, stageGoverned: false, writable: false,
}

function allOk(trir: unknown = TRIR_UNAVAILABLE, contracts: unknown = CONTRACTS_EMPTY,
               leads: unknown = LEADS_EMPTY): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/purchase-orders'))   return ok(PO_ROWS)
    if (url.startsWith('/api/v1/files/documents'))   return ok(DOC_ROWS)
    if (url.startsWith('/api/v1/audit'))             return ok(AUDIT_ROWS)
    if (url.startsWith('/api/v1/safety/trir'))       return ok(trir)
    if (url.startsWith('/api/v1/contracts/summary')) return ok(contracts)
    if (url.startsWith('/api/v1/leads/summary'))     return ok(leads)
    throw new Error(`unexpected fetch: ${url}`)
  })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  allOk()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// ─── 1. What the existing APIs can answer ────────────────────────────────────

describe('the three derivable KPIs read real endpoints', () => {
  it('counts live purchase orders and totals them', async () => {
    render(<Dashboard biz={EMPTY_BIZ} />)
    // Three rows, one cancelled: two are live.
    await waitFor(() => expect(kpi('Procurement').textContent).toContain('2 POs'))
    // The total is over ALL rows, as the original computation was.
    expect(kpi('Procurement').textContent).toMatch(/1\.6M|1,629,999|1\.6/)
  })

  it('counts documents, excluding deleted ones', async () => {
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Documents').textContent).toContain('3'))
    expect(kpi('Documents').textContent).toContain('2 active')
  })

  it('reports document status the schema HAS, not an approval it does not', async () => {
    // `file_status` is uploading|active|deleted — there is no approval concept,
    // so "N approved" was never derivable from this API.
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Documents').textContent).toContain('2 active'))
    expect(kpi('Documents').textContent).not.toContain('approved')
  })

  it('fills recent activity from the audit log', async () => {
    render(<Dashboard biz={EMPTY_BIZ} />)
    expect(await screen.findByText(/update purchase_orders/i)).toBeDefined()
    expect(screen.getByText(/create documents/i)).toBeDefined()
  })

  it('requests exactly the three endpoints that can answer', async () => {
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Procurement').textContent).toContain('2 POs'))
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.startsWith('/api/v1/purchase-orders'))).toBe(true)
    expect(urls.some(u => u.startsWith('/api/v1/files/documents'))).toBe(true)
    expect(urls.some(u => u.startsWith('/api/v1/audit'))).toBe(true)
    expect(urls.some(u => u.startsWith('/api/v1/contracts/summary'))).toBe(true)
    expect(urls.some(u => u.startsWith('/api/v1/leads/summary'))).toBe(true)
    // Nothing is invented to feed a widget: accounting still has no API.
    expect(urls.some(u => /invoice|expense|journal/i.test(u))).toBe(false)
  })

  it('degrades one feed without blanking the others', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/audit')) return denied()
      if (url.startsWith('/api/v1/purchase-orders')) return ok(PO_ROWS)
      return ok(DOC_ROWS)
    })
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Procurement').textContent).toContain('2 POs'))
    expect(kpi('Documents').textContent).toContain('2 active')
  })

  it('marks a refused feed unavailable rather than zero', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/files/documents') ? denied() : ok(PO_ROWS))
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Documents').textContent).toContain('unavailable'))
    expect(kpi('Documents').textContent).toContain('—')
  })
})

// ─── 2. What no API can answer says so ───────────────────────────────────────

describe('a KPI with no backend shows no number', () => {
  it('withholds the weighted pipeline while any lead is unvalued', async () => {
    // A NULL value or probability is an UNKNOWN contribution, not a zero one.
    allOk(TRIR_UNAVAILABLE, CONTRACTS_EMPTY, {
      pipelineWeighted: null, reason: 'incomplete_valuation',
      detail: 'Some leads have no value or no probability recorded.',
      valued: 2, unvalued: 3, total: 5, byStage: { prospecting: 5 },
      stageGoverned: false, writable: true,
    })
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Pipeline (Weighted)').textContent).toContain('—'))
    expect(kpi('Pipeline (Weighted)').textContent).toContain('3 of 5 unvalued')
    expect(kpi('Pipeline (Weighted)').textContent).not.toContain('$0')
  })

  it('shows the weighted pipeline when every lead is valued', async () => {
    allOk(TRIR_UNAVAILABLE, CONTRACTS_EMPTY, {
      pipelineWeighted: 250_000, valued: 4, unvalued: 0, total: 4,
      byStage: { prospecting: 4 }, stageGoverned: false, writable: true,
    })
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Pipeline (Weighted)').textContent).toContain('250K'))
    expect(kpi('Pipeline (Weighted)').textContent).toContain('4 leads')
  })

  it('says leads cannot be recorded yet rather than reporting an empty pipeline', async () => {
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Pipeline (Weighted)').textContent).toContain('no leads recorded yet'))
  })

  it('ignores a snapshot full of leads when the API is unavailable', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/leads/summary') ? denied() : ok(PO_ROWS))
    render(<Dashboard biz={{ ...EMPTY_BIZ as object, leads: [
      { id: 'L1', estimated_value: 400000, probability: 100, status: 'won' },
    ] } as never} />)
    await waitFor(() => expect(kpi('Pipeline (Weighted)').textContent).toContain('—'))
    expect(kpi('Pipeline (Weighted)').textContent).not.toContain('400K')
  })

  it('ignores a snapshot full of "active" contracts when the API is unavailable', async () => {
    // The fallback this forbids: `biz.contracts` is a store array with a
    // free-text status, not the persisted contract_status enum, and nothing
    // keeps the two in step. A snapshot row must never be counted as a
    // governed contract — under ?demo=1 that would be the Lusaka sample.
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/contracts/summary') ? denied() : ok(PO_ROWS))
    render(<Dashboard biz={{ ...EMPTY_BIZ as object, contracts: [
      { id: 'c1', project: 'Lusaka WTP', status: 'active', value: 425000 },
      { id: 'c2', project: 'Maputo PM',  status: 'active', value: 120000 },
    ] } as never} />)
    await waitFor(() => expect(kpi('Active Contracts').textContent).toContain('—'))
    expect(kpi('Active Contracts').textContent).not.toContain('2')
  })

  it('shows the API count even when a snapshot disagrees with it', async () => {
    allOk(TRIR_UNAVAILABLE, { active: 1, activeValue: 50_000, total: 1,
                              byStatus: { active: 1 }, writable: true })
    render(<Dashboard biz={{ ...EMPTY_BIZ as object, contracts: [
      { id: 'c1', status: 'active' }, { id: 'c2', status: 'active' }, { id: 'c3', status: 'active' },
    ] } as never} />)
    await waitFor(() => expect(kpi('Active Contracts').textContent).toContain('1'))
    expect(kpi('Active Contracts').textContent).not.toContain('3')
  })

  it('counts active contracts from the contracts API, never from projects', async () => {
    // /api/v1/projects exists, but contracts carry vendor_id and are vendor
    // commitments while projects are the delivery entity. Swapping them would
    // relabel a domain — the same mistake the Hub's Projects tile made.
    allOk(TRIR_UNAVAILABLE, { active: 3, activeValue: 1_200_000, total: 5,
                              byStatus: { active: 3, draft: 1, closed: 1 }, writable: true })
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Active Contracts').textContent).toContain('3'))
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.startsWith('/api/v1/contracts/summary'))).toBe(true)
    expect(urls.some(u => u.startsWith('/api/v1/projects'))).toBe(false)
    expect(urls.some(u => /subcontract/i.test(u))).toBe(false)
  })

  it('blanks both accounting KPIs', async () => {
    render(<Dashboard biz={EMPTY_BIZ} />)
    for (const label of ['Revenue Collected', 'AR Outstanding']) {
      await waitFor(() => expect(kpi(label).textContent).toContain('—'))
      expect(kpi(label).textContent).toContain('no accounting backend')
      expect(kpi(label).textContent).not.toContain('$0')
    }
  })

  it('raises no AR warning on a figure it does not have', async () => {
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('AR Outstanding').textContent).toContain('—'))
    // A red alert on an unknown receivable is a false alarm.
    expect(kpi('AR Outstanding').textContent).not.toMatch(/\$\d/)
  })
})

// ─── 3. TRIR specifically ────────────────────────────────────────────────────

describe('TRIR comes from the API, or not at all', () => {
  it('renders the reason the API gave for refusing', async () => {
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Safety (TRIR)').textContent).toContain('—'))
    expect(kpi('Safety (TRIR)').textContent).toContain('recordability determination')
  })

  it('never prints a computed rate like 0.0 when the basis is incomplete', async () => {
    // The old code always produced a number, because the invented denominator
    // was clamped to at least 1. `0.0` on a safety metric reads as "no
    // recordable incidents", which an incomplete classification cannot establish.
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Safety (TRIR)').textContent).toContain('—'))
    expect(kpi('Safety (TRIR)').textContent).not.toMatch(/\d+\.\d/)
  })

  it('shows the rate when the API returns one', async () => {
    allOk({ trir: 2.5, recordableIncidents: 5, unclassifiedIncidents: 0,
            totalIncidents: 5, exposureHours: 400000, uncoveredDays: 0 })
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Safety (TRIR)').textContent).toContain('2.5'))
    expect(kpi('Safety (TRIR)').textContent).toContain('5 recordable')
  })

  it('shows an earned zero, which is a real determination', async () => {
    // Every incident was examined and none was recordable. This is the one
    // case where 0.0 is truthful, and it must not be suppressed.
    allOk({ trir: 0, recordableIncidents: 0, unclassifiedIncidents: 0,
            totalIncidents: 4, exposureHours: 200000, uncoveredDays: 0 })
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Safety (TRIR)').textContent).toContain('0.0'))
  })

  it('asks for a calendar-year-to-date period', async () => {
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Safety (TRIR)').textContent).toContain('—'))
    const url = fetchMock.mock.calls.map(c => String(c[0])).find(u => u.includes('/safety/trir'))!
    expect(url).toMatch(/period_start=\d{4}-01-01/)
    expect(url).toMatch(/period_end=\d{4}-\d{2}-\d{2}/)
  })

  it('blanks the card when the endpoint itself is refused', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/safety/trir') ? denied() : ok(PO_ROWS))
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Safety (TRIR)').textContent).toContain('unavailable'))
    expect(kpi('Safety (TRIR)').textContent).not.toMatch(/\d+\.\d/)
  })

  it('ignores a biz snapshot for this card, which cannot carry a determination', async () => {
    // A caller-supplied snapshot has incidents but no recordability and no
    // measured hours. The card must still come from the API.
    allOk()
    render(<Dashboard biz={{ ...EMPTY_BIZ as object, incidents: [{ id: 'i1', recordable: true }] } as never} />)
    await waitFor(() => expect(kpi('Safety (TRIR)').textContent).toContain('—'))
    expect(kpi('Safety (TRIR)').textContent).not.toMatch(/\d+\.\d/)
  })
})

// ─── 4. A caller who supplies data is still authoritative ────────────────────

describe('supplied data is never overridden by a fetch', () => {
  it('uses the snapshot for snapshot-derived cards and asks for none of them', async () => {
    // Procurement is still snapshot-first. Pipeline is NOT — it moved to the
    // API in Phase 3N, so a snapshot lead no longer feeds it.
    render(<Dashboard biz={{ ...EMPTY_BIZ as object,
      purchase_orders: [{ id: 'PO-1', amount: 75000, status: 'ordered' }] } as never} />)
    await waitFor(() => expect(kpi('Procurement').textContent).toContain('1 POs'))
    expect(kpi('Procurement').textContent).toContain('75K')
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    // The snapshot-derived feeds are not requested…
    expect(urls.some(u => /purchase-orders|files\/documents|audit/.test(u))).toBe(false)
    // …but TRIR and contracts are API-only and always are: a snapshot carries
    // no recordability determination and no persisted contract_status, so
    // suppressing them would blank two governed metrics on someone else's data.
    expect(urls.some(u => u.startsWith('/api/v1/safety/trir'))).toBe(true)
    expect(urls.some(u => u.startsWith('/api/v1/contracts/summary'))).toBe(true)
    expect(urls.some(u => u.startsWith('/api/v1/leads/summary'))).toBe(true)
  })
})
