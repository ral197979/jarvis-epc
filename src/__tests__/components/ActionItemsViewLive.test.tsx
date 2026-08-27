/**
 * ActionItemsView — the Action Center reaches its backend.
 *
 * The registry graded this PARTIAL for a specific, checkable reason: the routed
 * component made ZERO backend calls. Its only source was
 * `useBizStore(selectActionItems)`, a collection `store.ts` documents as never
 * hydrated — so the screen rendered "No action items" on every session while
 * `api/routes/actions.ts` sat mounted, SLA logic and all, beside it.
 *
 * The API has TWO registers and they are not interchangeable:
 *
 *   GET /actions      personal.admin — every action in the tenant (Owner only)
 *   GET /actions/my   personal.view  — the caller's own assigned actions
 *
 * ADR-014 D11 fixes `personal.admin` to {owner}, so for everyone else the
 * tenant register is a 403 and the personal one is the honest answer. These
 * tests pin that the component tries the wide one, falls back rather than
 * failing, and TELLS the user which register they are looking at — a personal
 * list that reads as tenant-wide is the more dangerous of the two mistakes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import React from 'react'
import { ActionItemsView } from '../../components/ActionItemsView'
import { useBizStore } from '../../modules/biz/store'
import { actions } from '../../modules/biz/dispatch'
import type { PolicyConfig } from '../../modules/biz/dispatch'

const ownerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner',
}

/** Rows in the shape `GET /api/v1/actions` really returns (migration 029 columns). */
const TENANT_ROWS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Respond to HAZOP action', description: 'P&ID markup needs a response.',
    status: 'open', priority: 'critical',
    action_type: 'RFI', source_module: 'rfis', source_id: '99999999-9999-4999-8999-999999999999',
    project_code: 'ACME-01', project_name: 'Acme Refinery',
    assigned_user_email: 'jane@denver.example',
    due_at: '2026-01-15T00:00:00.000Z', created_at: '2025-12-01T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Vendor evaluation report', description: null,
    status: 'in_progress', priority: 'medium',
    action_type: 'SUBMITTAL', source_module: 'submittals', source_id: '88888888-8888-4888-8888-888888888888',
    project_code: 'BETA-01', project_name: 'Beta Plant',
    assigned_user_email: 'dave@denver.example',
    due_at: '2026-02-01T00:00:00.000Z', created_at: '2025-12-10T00:00:00.000Z',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Electrical load list', status: 'completed', priority: 'low',
    action_type: 'PUNCH_ITEM', source_module: 'punch_items', source_id: '77777777-7777-4777-8777-777777777777',
    project_code: 'ACME-01', assigned_user_email: 'alice@denver.example',
    due_at: null, created_at: '2025-12-15T00:00:00.000Z',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Superseded scope change', status: 'cancelled', priority: 'high',
    action_type: 'WORK_ORDER', source_module: 'work_orders', source_id: '66666666-6666-4666-8666-666666666666',
    project_code: 'BETA-01', assigned_user_email: 'bob@denver.example',
    due_at: null, created_at: '2025-12-20T00:00:00.000Z',
  },
]

/** `/actions/my` joins no users and filters on exactly one status per call. */
const MY_ROWS: Record<string, unknown[]> = {
  open: [{
    id: '55555555-5555-4555-8555-555555555555',
    title: 'My open action', status: 'open', priority: 'high',
    action_type: 'INSPECTION', source_module: 'inspections', source_id: '55555555-0000-4000-8000-000000000000',
    project_code: 'ACME-01', due_at: '2026-03-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z',
  }],
  in_progress: [],
  completed: [{
    id: '66666666-6666-4666-8666-000000000001',
    title: 'My finished action', status: 'completed', priority: 'low',
    action_type: 'DAILY_LOG', source_module: 'daily_logs', source_id: '66666666-0000-4000-8000-000000000000',
    project_code: 'ACME-01', due_at: null, created_at: '2026-01-02T00:00:00.000Z',
  }],
  cancelled: [],
}

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) })
const denied = () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) })

let fetchMock: ReturnType<typeof vi.fn>
const props = { policy: ownerPolicy }

/** Owner: the tenant register answers. */
function asTenantAdmin(): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/actions?')) return ok(TENANT_ROWS)
    throw new Error(`unexpected fetch: ${url}`)
  })
}
/** Everyone else: the tenant register 403s and the personal one answers. */
function asOrdinaryUser(): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/actions?')) return denied()
    const st = new URL(url, 'http://x').searchParams.get('status') ?? 'open'
    return ok(MY_ROWS[st] ?? [])
  })
}

beforeEach(() => {
  useBizStore.getState().reset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  asTenantAdmin()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// ─── 1. It reaches the backend at all ────────────────────────────────────────

describe('the routed register reads the API', () => {
  it('renders actions from the backend instead of an empty store', async () => {
    render(<ActionItemsView {...props} />)
    expect(await screen.findByText('Respond to HAZOP action')).toBeDefined()
    expect(screen.getByText('Vendor evaluation report')).toBeDefined()
  })

  it('shows a loading state before the data arrives', () => {
    render(<ActionItemsView {...props} />)
    expect(screen.getByText(/Loading action items/i)).toBeDefined()
  })

  it('maps the API columns onto the fields the table shows', async () => {
    render(<ActionItemsView {...props} />)
    await screen.findByText('Respond to HAZOP action')
    // title→subject, project_code→project, action_type→category,
    // assigned_user_email→assignee, due_at→a date. A row that rendered with
    // every column "—" would not be a repair.
    expect(screen.getAllByText('ACME-01').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/jane@denver\.example/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('2026-01-15').length).toBeGreaterThan(0)
  })
})

// ─── 2. The two vocabularies are reconciled ──────────────────────────────────

describe('the migration-029 status values are translated, not shown raw', () => {
  it('counts an in_progress action as open work, not as an unknown status', async () => {
    render(<ActionItemsView {...props} />)
    await screen.findByText('Respond to HAZOP action')
    // `in_progress` maps to the component's `in-progress`, which is not closed,
    // so it stays in the open table with the `open` row.
    expect(screen.getByText('Vendor evaluation report')).toBeDefined()
    const kpi = screen.getByRole('group', { name: 'Open' })
    expect(kpi.textContent).toContain('1')   // only `open` counts as Open
  })

  it('treats completed as resolved', async () => {
    render(<ActionItemsView {...props} />)
    await screen.findByText('Respond to HAZOP action')
    const kpi = screen.getByRole('group', { name: 'Resolved' })
    expect(kpi.textContent).toContain('1')
  })

  it('does not count a cancelled action as resolved work', async () => {
    // It left the open list, but nobody completed it. Folding `cancelled` into
    // `resolved` would report finished work that never happened.
    render(<ActionItemsView {...props} />)
    await screen.findByText('Respond to HAZOP action')
    const resolved = screen.getByRole('group', { name: 'Resolved' })
    expect(resolved.textContent).not.toContain('2')

    // …and it has still LEFT the open list. Asserting on the Open KPI would
    // prove nothing here — that counter only ever counts `status === 'open'`,
    // so a cancelled row sitting in the open table would not move it. The
    // tables are the thing that has to be checked.
    const openTable     = screen.getByRole('table', { name: /Open Items/i })
    const resolvedTable = screen.getByRole('table', { name: /Resolved Items/i })
    expect(openTable.textContent).not.toContain('Superseded scope change')
    expect(resolvedTable.textContent).toContain('Superseded scope change')
  })

  it('shows a critical action as high-priority', async () => {
    render(<ActionItemsView {...props} />)
    await screen.findByText('Respond to HAZOP action')
    expect(screen.getAllByText(/critical/i).length).toBeGreaterThan(0)
  })
})

// ─── 3. Scope: what you may see, and being told which ────────────────────────

describe('the register says which scope it is showing', () => {
  it('falls back to the personal register when the tenant one is refused', async () => {
    asOrdinaryUser()
    render(<ActionItemsView {...props} />)
    expect(await screen.findByText('My open action')).toBeDefined()
    expect(screen.getByText('My finished action')).toBeDefined()
    // The 403 is the ordinary case for every role but Owner — not an error.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('tells the user the list is only their own', async () => {
    asOrdinaryUser()
    render(<ActionItemsView {...props} />)
    await screen.findByText('My open action')
    expect(screen.getByRole('note')).toBeDefined()
    expect(screen.getByText(/assigned to you/i)).toBeDefined()
    expect(screen.getByText(/personal\.admin/)).toBeDefined()
  })

  it('adds no such note when the tenant register answered', async () => {
    render(<ActionItemsView {...props} />)
    await screen.findByText('Respond to HAZOP action')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('asks for every status the table groups, since /my filters on one', async () => {
    asOrdinaryUser()
    render(<ActionItemsView {...props} />)
    await screen.findByText('My open action')
    const statuses = fetchMock.mock.calls
      .map(c => String(c[0]))
      .filter(u => u.includes('/actions/my'))
      .map(u => new URL(u, 'http://x').searchParams.get('status'))
    expect(new Set(statuses)).toEqual(new Set(['open', 'in_progress', 'completed', 'cancelled']))
  })

  it('labels personal rows as the caller, since /my joins no users', async () => {
    asOrdinaryUser()
    render(<ActionItemsView {...props} />)
    await screen.findByText('My open action')
    expect(screen.getAllByText('You').length).toBeGreaterThan(0)
  })

  it('says the personal list is empty in its own words', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/actions?') ? denied() : ok([]))
    render(<ActionItemsView {...props} />)
    expect(await screen.findByText(/No action items assigned to you/i)).toBeDefined()
  })
})

// ─── 4. Failure is reported as failure ───────────────────────────────────────

describe('a broken request is not reported as an empty register', () => {
  it('renders an error state on a 500', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    render(<ActionItemsView {...props} />)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/Could not load action items/i)).toBeDefined()
    expect(screen.queryByText(/^No action items$/)).toBeNull()
  })

  it('renders an error state when the request throws', async () => {
    fetchMock.mockImplementation(async () => { throw new Error('network down') })
    render(<ActionItemsView {...props} />)
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/network down/i)).toBeDefined()
  })
})

// ─── 5. A populated store is still authoritative ─────────────────────────────

describe('a store that holds rows is never overridden by a fetch', () => {
  it('renders store items and makes no request', async () => {
    useBizStore.getState().dispatch(actions.addAction({
      id: 'AI-001', subject: 'Store-dispatched item', project: 'Acme Refinery',
      priority: 'high', assigned: 'Jane Smith', due: '2026-01-15', status: 'open',
      category: 'engineering',
    }))
    render(<ActionItemsView {...props} />)
    expect(await screen.findByText('Store-dispatched item')).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── 6. No control for an operation the API does not have ────────────────────

describe('the register offers no way to create an action by hand', () => {
  it('shows no create control, because there is no create endpoint', async () => {
    // Migration 029: source_module and source_id are NOT NULL with a UNIQUE
    // (tenant_id, source_module, source_id) idempotency rule, and there is no
    // POST /api/v1/actions. A hand-typed action would have no source record to
    // point at. The `+ Add Action` button that used to sit here had no onClick
    // and could not have had one.
    render(<ActionItemsView {...props} />)
    await screen.findByText('Respond to HAZOP action')
    expect(screen.queryByRole('button', { name: /Add Action/i })).toBeNull()
  })

  it('says where actions come from instead', async () => {
    render(<ActionItemsView {...props} />)
    await screen.findByText('Respond to HAZOP action')
    expect(screen.getByText(/raised by the module that needs them/i)).toBeDefined()
  })
})

// ─── 7. An action leads back to the record that raised it ────────────────────

describe('the register drills through to the source module', () => {
  async function openFirst(nav?: (tab: string) => void): Promise<void> {
    render(<ActionItemsView policy={ownerPolicy} onNavigate={nav} />)
    fireEvent.click(await screen.findByText('Respond to HAZOP action'))
    await screen.findByText(/All Actions/i)
  }

  it('offers a control naming the module that raised the action', async () => {
    await openFirst(vi.fn())
    // The fixture row's source_module is `rfis`.
    expect(screen.getByRole('button', { name: /Open RFIs/i })).toBeDefined()
    expect(screen.getByText(/Raised from RFIs/i)).toBeDefined()
  })

  it('navigates to the tab for that module', async () => {
    const nav = vi.fn()
    await openFirst(nav)
    fireEvent.click(screen.getByRole('button', { name: /Open RFIs/i }))
    expect(nav).toHaveBeenCalledWith('rfis')
  })

  it('maps every source_module the API actually emits', async () => {
    // Derived from the emitted values, not from table names — a mapping that
    // silently missed one would leave those actions with no way back.
    const cases: [string, string, string][] = [
      ['submittals',                  'submittals',   'Submittals'],
      ['punch_items',                 'punch',        'Punch Lists'],
      ['inspections',                 'inspections',  'Inspections'],
      ['compliance_tasks',            'compliance',   'Compliance'],
      ['daily_logs',                  'dailylogs',    'Daily Logs'],
      ['bim_issues',                  'bim',          'BIM'],
      ['coordination_recommendation', 'coordination', 'Coordination'],
    ]
    for (const [sourceModule, tab, label] of cases) {
      cleanup()   // each case is its own mount; queries must not see the last one
      const nav = vi.fn()
      fetchMock.mockImplementation(async (url: string) =>
        url.startsWith('/api/v1/actions?')
          ? ok([{ ...TENANT_ROWS[0], source_module: sourceModule }])
          : ok([]))
      const view = render(<ActionItemsView policy={ownerPolicy} onNavigate={nav} />)
      const q = within(view.container)
      await waitFor(() => expect(q.getByText('Respond to HAZOP action')).toBeDefined())
      fireEvent.click(q.getByText('Respond to HAZOP action'))
      await waitFor(() => expect(q.getByRole('button', { name: new RegExp(`Open ${label}`, 'i') })).toBeDefined())
      fireEvent.click(q.getByRole('button', { name: new RegExp(`Open ${label}`, 'i') }))
      expect(nav, `${sourceModule} must open ${tab}`).toHaveBeenCalledWith(tab)
    }
    // Seven mounts, each with an async load. The default 5s budget is enough in
    // isolation and not under full-suite load, which showed up as a flake
    // rather than a failure — so the budget is stated rather than discovered.
  }, 20_000)

  it('offers nothing for a source module it does not recognise', async () => {
    // A link that goes nowhere is worse than plain text.
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/actions?')
        ? ok([{ ...TENANT_ROWS[0], source_module: 'something_new' }])
        : ok([]))
    await openFirst(vi.fn())
    expect(screen.queryByRole('button', { name: /^Open /i })).toBeNull()
  })

  it('offers nothing when the host gave it no way to navigate', async () => {
    await openFirst(undefined)
    expect(screen.queryByRole('button', { name: /Open RFIs/i })).toBeNull()
  })

  it('offers nothing on a store row, which carries no source module', async () => {
    useBizStore.getState().dispatch(actions.addAction({
      id: 'AI-001', subject: 'Store-dispatched item', status: 'open', priority: 'high',
    }))
    render(<ActionItemsView policy={ownerPolicy} onNavigate={vi.fn()} />)
    fireEvent.click(await screen.findByText('Store-dispatched item'))
    await screen.findByText(/All Actions/i)
    expect(screen.queryByRole('button', { name: /^Open /i })).toBeNull()
  })
})

// ─── 8. The detail panel opens on a live row ─────────────────────────────────

describe('a live row drills through', () => {
  it('opens the detail panel for a backend action', async () => {
    render(<ActionItemsView {...props} />)
    fireEvent.click(await screen.findByText('Respond to HAZOP action'))
    await waitFor(() => expect(screen.getByText(/P&ID markup needs a response/i)).toBeDefined())
  })
})
