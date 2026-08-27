/**
 * DirectoryView — the P0-11 repair.
 *
 * The defect was not a backend gap. `DirectoryView` took its data as PROPS, and
 * `ContentRouter`'s `sharedProps` passes only {policy, biz, onNavigate, onAudit,
 * onToast}. Every data prop defaulted to `[]`, so the routed screen rendered
 * "No vendors in directory" forever — the same output on a healthy backend as
 * on a dead one, which is why the registry graded it BROKEN_OR_DEAD rather than
 * merely empty.
 *
 * These tests pin the two halves of the repair:
 *
 *   1. rendered the way ContentRouter renders it (NO data props), the component
 *      reaches the API and shows what comes back;
 *   2. rendered WITH props, it does not touch the network at all — the
 *      accessibility suite and any embedder keep their existing behaviour.
 *
 * And the honest half: customers/contracts/invoices are deliberately NOT
 * fetched, because no migration creates a `customers` table and no route serves
 * one. That tab must say so rather than report an empty domain.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import { DirectoryView } from '../../components/DirectoryView'
import type { PolicyConfig } from '../../modules/biz/dispatch'

const ownerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner',
}

/** Rows in the shape `GET /api/v1/vendors` really returns (migration 002 columns). */
const VENDOR_ROWS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'HYD', name: 'Hydranautics', type: 'supplier', status: 'approved',
    primary_contact: 'Mike Chen', email: 'mchen@hydranautics.com', phone: '+1-760-555-0120',
    address: '401 Jones Rd', country: 'US', categories: ['RO Membranes', 'Filtration'],
    rating: '4.50', po_count: '2',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    code: 'STL', name: 'Steel Masters', type: 'supplier', status: 'pending',
    primary_contact: 'Sarah Lee', email: 'sarah@steelmasters.com', phone: '+1-213-555-0200',
    address: null, country: 'US', categories: null, rating: null, po_count: '0',
  },
]

/** Rows in the shape `GET /api/v1/purchase-orders` really returns. */
const PO_ROWS = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001', po_number: 'PO-1001', title: 'RO membranes batch 1',
    status: 'ordered', total_amount: '450000.00',
    vendor_id: '11111111-1111-4111-8111-111111111111', vendor_name: 'Hydranautics',
    project_code: 'ACME-01', project_name: 'Acme Refinery',
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000002', po_number: 'PO-1002', title: 'RO membranes batch 2',
    status: 'shipped', total_amount: '180000.00',
    vendor_id: '11111111-1111-4111-8111-111111111111', vendor_name: 'Hydranautics',
    project_code: 'BETA-01', project_name: 'Beta Plant',
  },
]

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) })
const status = (code: number) => ({ ok: false, status: code, json: async () => ({ error: 'x' }) })

let fetchMock: ReturnType<typeof vi.fn>

/** Exactly the props ContentRouter's sharedProps supplies — no data among them. */
const routedProps = { policy: ownerPolicy }

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/vendors')) return ok(VENDOR_ROWS)
    if (url.startsWith('/api/v1/purchase-orders')) return ok(PO_ROWS)
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// ─── 1. The routed case now reaches the backend ──────────────────────────────

describe('rendered the way ContentRouter renders it', () => {
  it('loads vendors from the API instead of rendering permanently empty', async () => {
    render(<DirectoryView {...routedProps} />)
    // The regression this guards: before the repair this text was the FINAL
    // state of the routed screen, not a transient one.
    expect(await screen.findByText('Hydranautics')).toBeDefined()
    expect(screen.getByText('Steel Masters')).toBeDefined()
    expect(screen.queryByText(/No vendors in directory/i)).toBeNull()
  })

  it('requests both collections, and only those', async () => {
    render(<DirectoryView {...routedProps} />)
    await screen.findByText('Hydranautics')
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.startsWith('/api/v1/vendors'))).toBe(true)
    expect(urls.some(u => u.startsWith('/api/v1/purchase-orders'))).toBe(true)
    // No customer request — there is no customer endpoint to call.
    expect(urls.some(u => /customer/i.test(u))).toBe(false)
  })

  it('shows a loading state before the data arrives', () => {
    render(<DirectoryView {...routedProps} />)
    expect(screen.getByText(/Loading vendor directory/i)).toBeDefined()
  })

  it('maps the API columns onto the fields the table displays', async () => {
    render(<DirectoryView {...routedProps} />)
    await screen.findByText('Hydranautics')
    // `categories[]` → Specialty, `address`+`country` → Location. A row that
    // rendered but showed every column as "—" would be no repair at all.
    expect(screen.getByText(/RO Membranes, Filtration/)).toBeDefined()
    expect(screen.getByText(/401 Jones Rd, US/)).toBeDefined()
  })

  it('counts approved vendors from live rows, not from a store', async () => {
    render(<DirectoryView {...routedProps} />)
    await screen.findByText('Hydranautics')
    // One of the two fixture vendors is `approved`; the other is `pending`.
    const kpi = screen.getByRole('group', { name: 'Approved Vendors' })
    expect(kpi.textContent).toContain('1')
  })
})

// ─── 2. Purchase orders bind to the vendor by key ────────────────────────────

describe('vendor detail joins purchase orders on the real foreign key', () => {
  it('shows only the selected vendor POs, matched by vendor_id', async () => {
    render(<DirectoryView {...routedProps} />)
    fireEvent.click(await screen.findByText('Hydranautics'))
    expect(await screen.findByText('PO-1001')).toBeDefined()
    expect(screen.getByText('PO-1002')).toBeDefined()
  })

  it('derives the vendor project badges from its POs', async () => {
    // `vendors` has no project column, so the projects a vendor touches can
    // only come from its purchase orders. Two POs, two distinct projects.
    render(<DirectoryView {...routedProps} />)
    fireEvent.click(await screen.findByText('Hydranautics'))
    await screen.findByText('PO-1001')
    // Each code appears twice — once as a project badge, once in the PO table's
    // Project column — so this asserts presence, and the KPI asserts the count.
    expect(screen.getAllByText('ACME-01').length).toBeGreaterThan(0)
    expect(screen.getAllByText('BETA-01').length).toBeGreaterThan(0)
    const kpi = screen.getByRole('group', { name: 'Projects' })
    expect(kpi.textContent).toContain('2')
  })

  it('shows no PO panel for a vendor that has none', async () => {
    render(<DirectoryView {...routedProps} />)
    fireEvent.click(await screen.findByText('Steel Masters'))
    await screen.findByRole('button', { name: /Vendors/i })
    // Steel Masters owns no PO row; the other vendor's POs must not leak in.
    expect(screen.queryByText('PO-1001')).toBeNull()
    expect(screen.queryByText('PO-1002')).toBeNull()
  })
})

// ─── 3. The states a real screen has to have ─────────────────────────────────

describe('the states behind the data', () => {
  it('distinguishes "not allowed" from "nothing here"', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/vendors') ? status(403) : ok([]))
    render(<DirectoryView {...routedProps} />)
    expect(await screen.findByText(/do not have access to the vendor directory/i)).toBeDefined()
    expect(screen.getByText(/procurement\.view/i)).toBeDefined()
    expect(screen.queryByText(/No vendors in directory/i)).toBeNull()
  })

  it('reports a failed request as an error, not as an empty directory', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/vendors') ? status(500) : ok([]))
    render(<DirectoryView {...routedProps} />)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/Could not load the vendor directory/i)).toBeDefined()
    expect(screen.queryByText(/No vendors in directory/i)).toBeNull()
  })

  it('reports a thrown request the same way', async () => {
    fetchMock.mockImplementation(async () => { throw new Error('network down') })
    render(<DirectoryView {...routedProps} />)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/network down/i)).toBeDefined()
  })

  it('still says "no vendors" when the backend genuinely returns none', async () => {
    fetchMock.mockImplementation(async () => ok([]))
    render(<DirectoryView {...routedProps} />)
    expect(await screen.findByText(/No vendors in directory/i)).toBeDefined()
  })

  it('survives a purchase-order error whose body is not JSON', async () => {
    // A proxy or gateway failure returns an HTML page, not the API's JSON
    // envelope, so `.json()` REJECTS. Parsing an error response before checking
    // that it is one turns a supplementary failure into a dead screen.
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/vendors')
        ? ok(VENDOR_ROWS)
        : { ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token < in JSON') } })
    render(<DirectoryView {...routedProps} />)
    expect(await screen.findByText('Hydranautics')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders the directory even when purchase orders are refused', async () => {
    // POs are supplementary. A caller who may read vendors but not POs should
    // still get the directory rather than an error page.
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/vendors') ? ok(VENDOR_ROWS) : status(403))
    render(<DirectoryView {...routedProps} />)
    expect(await screen.findByText('Hydranautics')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// ─── 4. Props still win, so nothing that worked before changed ───────────────

describe('an explicit caller is never overridden by a fetch', () => {
  it('makes no request when vendor props are supplied', async () => {
    render(<DirectoryView policy={ownerPolicy} vendors={[{ id: 'V-1', name: 'Prop Vendor' }]} purchaseOrders={[]} />)
    expect(await screen.findByText('Prop Vendor')).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats an explicitly EMPTY vendor array as an assertion, not as absence', async () => {
    // The old signature defaulted `vendors` to `[]` and so could not tell
    // "nobody gave me data" from "I was given none" — the exact conflation that
    // made the routed screen silently empty. Passing `[]` must NOT fetch.
    render(<DirectoryView policy={ownerPolicy} vendors={[]} />)
    expect(await screen.findByText(/No vendors in directory/i)).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── 5. The half with no backend says so ─────────────────────────────────────

describe('the customer tab is honest about not existing', () => {
  it('names the gap instead of reporting an empty domain', async () => {
    render(<DirectoryView {...routedProps} />)
    await screen.findByText('Hydranautics')
    fireEvent.click(screen.getByRole('tab', { name: /Customers/i }))
    expect(screen.getByText(/Customer directory not available/i)).toBeDefined()
    expect(screen.getByText(/this domain has no backend/i)).toBeDefined()
  })
})
