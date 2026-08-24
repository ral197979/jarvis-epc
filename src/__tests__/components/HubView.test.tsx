/**
 * HubView — eight cross-domain tiles over three different kinds of truth.
 *
 * The hub read ten store collections and rendered every tile as a confident
 * number. Those ten do not share a backend story:
 *
 *   TENANT-WIDE AND REAL   projects, documents, purchase orders, actions
 *   PROJECT-SCOPED         incidents, punch items, EVM metrics — every route
 *                          needs a project in the path, so a cross-project
 *                          total does not exist to fetch
 *   NO BACKEND             contracts and leads (tables, no route), invoices
 *                          (no table), rfqs (no table at all)
 *
 * So a tile can be wrong in two directions and both matter. Printing `0 open`
 * for a domain it could not read is a false all-clear; printing a red alert on
 * a number it does not have is a false alarm. These tests hold both.
 *
 * The Projects tile also carried a plain mislabel: it was computed from
 * `contracts` — the table with no route — while GET /api/v1/projects existed
 * the whole time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { HubView } from '../../components/HubView'
import { useBizStore } from '../../modules/biz/store'
import { actions as bizActions } from '../../modules/biz/dispatch'

const PROJECTS = [
  { id: 'pr1', name: 'Acme Refinery', code: 'ACME-01', status: 'active',    budget: '5200000.00', progress_pct: '42' },
  { id: 'pr2', name: 'Beta Plant',    code: 'BETA-01', status: 'active',    budget: '3100000.00', progress_pct: '11' },
  { id: 'pr3', name: 'Old Job',       code: 'OLD-01',  status: 'completed', budget: '900000.00',  progress_pct: '100' },
]
const DOCS = [
  { id: 'd1', title: 'P&ID rev C', status: 'active' },
  { id: 'd2', title: 'Spec',       status: 'active' },
  { id: 'd3', title: 'Half-sent',  status: 'uploading' },
  // A deleted row, so the filter that drops it is actually exercised — a
  // fixture without one lets the filter be removed with every test still green.
  { id: 'd4', title: 'Withdrawn',  status: 'deleted' },
]
const POS = [
  { id: 'po1', po_number: 'PO-1', status: 'ordered',   total_amount: '450000.00' },
  { id: 'po2', po_number: 'PO-2', status: 'cancelled', total_amount: '10000.00' },
]
const ACTIONS = [
  { id: 'a1', title: 'Respond to HAZOP', status: 'open' },
  { id: 'a2', title: 'Vendor eval',      status: 'in_progress' },
  { id: 'a3', title: 'Done thing',       status: 'completed' },
]

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) })
const denied = () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) })

let fetchMock: ReturnType<typeof vi.fn>

function allOk(): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/projects'))        return ok(PROJECTS)
    if (url.startsWith('/api/v1/files/documents')) return ok(DOCS)
    if (url.startsWith('/api/v1/purchase-orders')) return ok(POS)
    if (url.startsWith('/api/v1/actions'))         return ok(ACTIONS)
    throw new Error(`unexpected fetch: ${url}`)
  })
}

/** A tile is a card; find it by the label text and read its whole card. */
function tile(label: string): string {
  const el = screen.getByText(label).closest('div')!.parentElement!
  return el.textContent ?? ''
}

beforeEach(() => {
  useBizStore.getState().reset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  allOk()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// ─── 1. The four tenant-wide domains actually read ───────────────────────────

describe('the tenant-wide tiles read their real endpoints', () => {
  it('counts active projects from the projects API, not from contracts', async () => {
    // The mislabel: this tile was computed from `contracts`, a table with no
    // route, while /api/v1/projects existed. Two of three fixture projects are
    // `active` (project_status enum, 002_epc_core).
    render(<HubView />)
    await waitFor(() => expect(tile('Projects')).toContain('2 active'))
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.startsWith('/api/v1/projects'))).toBe(true)
  })

  it('totals the portfolio from project budgets', async () => {
    render(<HubView />)
    // 5.2M + 3.1M + 0.9M = 9.2M
    await waitFor(() => expect(tile('Projects')).toContain('9.2M'))
  })

  it('counts documents, excluding deleted ones', async () => {
    // Four rows, one deleted: a deleted document is not a document.
    render(<HubView />)
    await waitFor(() => expect(tile('Documents')).toContain('3 docs'))
    expect(tile('Documents')).toContain('2 active')
    expect(tile('Documents')).not.toContain('4 docs')
  })

  it('counts live purchase orders, excluding cancelled', async () => {
    render(<HubView />)
    await waitFor(() => expect(tile('Procurement')).toContain('1 POs'))
  })

  it('counts open actions as open + in_progress, the schema vocabulary', async () => {
    render(<HubView />)
    await waitFor(() => expect(tile('Actions')).toContain('2 open'))
  })
})

// ─── 2. A domain it cannot read must not print a number ──────────────────────

describe('a tile that cannot know its number says so', () => {
  it('dashes the CRM tile — crm_leads has a table but no route', async () => {
    render(<HubView />)
    await waitFor(() => expect(tile('Projects')).toContain('2 active'))
    expect(tile('CRM')).toContain('—')
    expect(tile('CRM')).toContain('not connected')
  })

  it('dashes the Finance tile — invoices have no table at all', async () => {
    render(<HubView />)
    await waitFor(() => expect(tile('Projects')).toContain('2 active'))
    expect(tile('Finance')).toContain('—')
    expect(tile('Finance')).not.toContain('$0')
  })

  it('says the project-scoped tiles need a project', async () => {
    // Safety incidents and EVM metrics are real, but every route takes a
    // project in the path — there is no cross-project total to fetch.
    render(<HubView />)
    await waitFor(() => expect(tile('Projects')).toContain('2 active'))
    expect(tile('Safety')).toContain('pick a project')
    expect(tile('EVM')).toContain('pick a project')
  })

  it('dashes only the refused domain, leaving the rest readable', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/purchase-orders')) return denied()
      if (url.startsWith('/api/v1/projects'))        return ok(PROJECTS)
      if (url.startsWith('/api/v1/files/documents')) return ok(DOCS)
      if (url.startsWith('/api/v1/actions'))         return ok(ACTIONS)
      throw new Error(`unexpected: ${url}`)
    })
    render(<HubView />)
    await waitFor(() => expect(tile('Projects')).toContain('2 active'))
    expect(tile('Procurement')).toContain('unavailable')
    // One refusal must not blank the neighbours.
    expect(tile('Documents')).toContain('3 docs')
    expect(tile('Actions')).toContain('2 open')
  })

  it('survives a thrown request without blanking the hub', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/actions')) throw new Error('network down')
      if (url.startsWith('/api/v1/projects')) return ok(PROJECTS)
      return ok([])
    })
    render(<HubView />)
    await waitFor(() => expect(tile('Projects')).toContain('2 active'))
    expect(tile('Actions')).toContain('unavailable')
  })
})

// ─── 3. No alert on a number it does not have ────────────────────────────────

describe('an unknown domain never raises an alert', () => {
  it('raises no safety alert when incidents were never read', async () => {
    const { container } = render(<HubView />)
    await waitFor(() => expect(tile('Projects')).toContain('2 active'))
    // The red left border marks an alerting tile. A project-scoped domain we
    // did not read must not cry wolf.
    const safetyCard = screen.getByText('Safety').closest('div')!.parentElement as HTMLElement
    expect(safetyCard.style.borderLeft).not.toContain('var(--jarvis-red)')
    expect(container).toBeDefined()
  })

  it('raises no finance alert on a domain with no backend', async () => {
    render(<HubView />)
    await waitFor(() => expect(tile('Projects')).toContain('2 active'))
    const card = screen.getByText('Finance').closest('div')!.parentElement as HTMLElement
    expect(card.style.borderLeft).not.toContain('var(--jarvis-red)')
  })
})

// ─── 4. The activity panels stop claiming "all clear" ────────────────────────

describe('the activity panels do not assert what they could not read', () => {
  it('lists open actions from the API', async () => {
    render(<HubView />)
    expect(await screen.findByText('Respond to HAZOP')).toBeDefined()
    expect(screen.getByText('Vendor eval')).toBeDefined()
  })

  it('says "All clear" only when the actions were genuinely read and empty', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/actions') ? ok([]) : ok(PROJECTS))
    render(<HubView />)
    expect(await screen.findByText(/All clear/i)).toBeDefined()
  })

  it('does not say "All clear" when the actions could not be read', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/actions') ? denied() : ok(PROJECTS))
    render(<HubView />)
    await waitFor(() => expect(tile('Actions')).toContain('unavailable'))
    expect(screen.queryByText(/All clear/i)).toBeNull()
  })

  it('lists active projects rather than claiming no active contracts', async () => {
    render(<HubView />)
    expect(await screen.findByText('Active Projects')).toBeDefined()
    expect(screen.getByText('Acme Refinery')).toBeDefined()
    expect(screen.queryByText(/No active contracts/i)).toBeNull()
  })
})

// ─── 5. A populated store still wins ─────────────────────────────────────────

describe('a store that holds rows is never overridden by a fetch', () => {
  it('renders store rows and makes no request', async () => {
    useBizStore.getState().dispatch(bizActions.addAction({
      id: 'AI-1', subject: 'Store item', status: 'open',
    }))
    render(<HubView />)
    expect(await screen.findByText('Store item')).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
