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

function allOk(): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/purchase-orders')) return ok(PO_ROWS)
    if (url.startsWith('/api/v1/files/documents')) return ok(DOC_ROWS)
    if (url.startsWith('/api/v1/audit'))           return ok(AUDIT_ROWS)
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
    // Nothing is invented to feed a widget.
    expect(urls.some(u => /lead|invoice|contract/i.test(u))).toBe(false)
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
  it('blanks the weighted pipeline and names the gap', async () => {
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Pipeline (Weighted)').textContent).toContain('—'))
    expect(kpi('Pipeline (Weighted)').textContent).toContain('no leads backend')
    expect(kpi('Pipeline (Weighted)').textContent).not.toContain('$0')
  })

  it('blanks active contracts without substituting projects for them', async () => {
    // /api/v1/projects exists, but contracts carry vendor_id and are vendor
    // commitments while projects are the delivery entity. Swapping them would
    // relabel a domain — the same mistake the Hub's Projects tile made.
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Active Contracts').textContent).toContain('—'))
    expect(kpi('Active Contracts').textContent).toContain('no contracts backend')
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.startsWith('/api/v1/projects'))).toBe(false)
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

describe('TRIR is not fabricated', () => {
  it('shows no rate, and says what it would need', async () => {
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Safety (TRIR)').textContent).toContain('—'))
    expect(kpi('Safety (TRIR)').textContent).toContain('recordable')
    expect(kpi('Safety (TRIR)').textContent).toContain('exposure hours')
  })

  it('never prints a computed rate like 0.0', async () => {
    // The old code always produced a number, because the invented denominator
    // was clamped to at least 1. `0.0` on a safety metric reads as "no
    // recordable incidents", which nothing in this system can establish.
    render(<Dashboard biz={EMPTY_BIZ} />)
    await waitFor(() => expect(kpi('Safety (TRIR)').textContent).toContain('—'))
    expect(kpi('Safety (TRIR)').textContent).not.toMatch(/\d+\.\d/)
  })
})

// ─── 4. A caller who supplies data is still authoritative ────────────────────

describe('supplied data is never overridden by a fetch', () => {
  it('uses the snapshot and makes no request', async () => {
    render(<Dashboard biz={{ ...EMPTY_BIZ as object, leads: [{ id: 'L1', estimated_value: 100000, probability: 50, status: 'qualified' }] } as never} />)
    await waitFor(() => expect(kpi('Pipeline (Weighted)').textContent).toContain('50K'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
