/**
 * SafetyView — one tab bar over two very different things.
 *
 * Migration 077 creates exactly two safety tables, `safety_observations` and
 * `safety_incidents`, and `api/routes/safety.ts` serves incidents at
 * `GET /projects/:projectId/safety/incidents` behind `safety.view` +
 * requireProjectScope. There is no `jhas`, `permits` or `toolbox_talks` table in
 * any migration and no route for any of them.
 *
 * So this screen had a real backend it never called, beside three tabs with no
 * backend at all — and rendered all four identically empty. An empty JHA
 * register on a site that has never been able to file one reads as "nobody did
 * a hazard analysis", which is a worse claim than "this is not built yet".
 *
 * These tests hold both halves: incidents read live and project-scoped, and the
 * other three tabs say what they are.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { SafetyView } from '../../components/SafetyView'
import { useBizStore } from '../../modules/biz/store'
import { actions } from '../../modules/biz/dispatch'
import type { PolicyConfig } from '../../modules/biz/dispatch'

const ownerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner',
}

const PROJECT_A = '30000000-0000-4000-8000-00000000000a'
const PROJECT_B = '30000000-0000-4000-8000-00000000000b'

/** Rows as migration 077 stores them and the route returns them. */
const INCIDENT_ROWS = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'near_miss', severity: 'high', status: 'reported',
    location: 'Pump house', discipline: 'mechanical',
    description: 'Scaffold plank slipped during lift',
    incident_date: '2026-02-11', root_cause: null, corrective_action: null,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    type: 'first_aid', severity: 'low', status: 'closed',
    location: 'Yard', discipline: 'civil',
    description: 'Minor laceration handling rebar',
    incident_date: '2026-01-30', root_cause: 'Missing gloves', corrective_action: 'Toolbox brief issued',
  },
]

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) })
const code = (n: number) => ({ ok: false, status: n, json: async () => ({ error: 'x' }) })

let fetchMock: ReturnType<typeof vi.fn>

/**
 * The store exposes no addProject creator — `projects` is hydrated wholesale
 * rather than dispatched into — so the fixture goes through `restore`, which is
 * the store's own public way to seat a snapshot.
 */
function seedProjects(): void {
  const st = useBizStore.getState()
  const snap = st.snapshot()
  st.restore({
    ...snap,
    projects: [
      { id: PROJECT_A, code: 'ACME-01', name: 'Acme Refinery' },
      { id: PROJECT_B, code: 'BETA-01', name: 'Beta Plant' },
    ],
  } as ReturnType<typeof st.snapshot>)
}

beforeEach(() => {
  useBizStore.getState().reset()
  fetchMock = vi.fn(async (url: string) =>
    url.includes('/safety/incidents') ? ok(INCIDENT_ROWS) : ok([]))
  vi.stubGlobal('fetch', fetchMock)
  seedProjects()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const openIncidents = (): void => {
  fireEvent.click(screen.getByRole('tab', { name: /Incidents/i }))
}

// ─── 1. Incidents reach the backend ──────────────────────────────────────────

describe('the incidents tab reads the API it was mounted beside', () => {
  it('loads incidents for the selected project', async () => {
    render(<SafetyView policy={ownerPolicy} />)
    openIncidents()
    expect(await screen.findByText(/Scaffold plank slipped/i)).toBeDefined()
    expect(screen.getByText(/Minor laceration/i)).toBeDefined()
  })

  it('calls the project-scoped route, because that is the only one there is', async () => {
    render(<SafetyView policy={ownerPolicy} />)
    openIncidents()
    await screen.findByText(/Scaffold plank slipped/i)
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/projects/${PROJECT_A}/safety/incidents`)
  })

  it('refetches when the project changes', async () => {
    render(<SafetyView policy={ownerPolicy} />)
    openIncidents()
    await screen.findByText(/Scaffold plank slipped/i)
    fireEvent.change(screen.getByLabelText(/Filter incidents by project/i), { target: { value: PROJECT_B } })
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/api/v1/projects/${PROJECT_B}/safety/incidents`))
  })

  it('maps the migration-077 columns onto the table', async () => {
    render(<SafetyView policy={ownerPolicy} />)
    openIncidents()
    await screen.findByText(/Scaffold plank slipped/i)
    // incident_date → Date, type/severity/status straight through. A row that
    // rendered with every column blank would not be a repair.
    expect(screen.getAllByText('2026-02-11').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/near_miss/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/high/i).length).toBeGreaterThan(0)
  })

  it('does not invent a recordable flag the schema has no column for', async () => {
    // migration 077 has no `recordable` / `lti` column. Defaulting them to false
    // would assert an incident is not recordable when nobody recorded it.
    render(<SafetyView policy={ownerPolicy} />)
    openIncidents()
    const table = await screen.findByRole('table', { name: /Incidents/i })
    await waitFor(() => expect(table.textContent).toContain('Scaffold plank slipped'))
    expect(table.textContent).toContain('—')
    expect(table.textContent).not.toContain('R​')   // no forced recordable marker
  })

  it('shows a loading state first', () => {
    render(<SafetyView policy={ownerPolicy} />)
    openIncidents()
    expect(screen.getByText(/Loading incidents/i)).toBeDefined()
  })
})

// ─── 2. The states behind the data ───────────────────────────────────────────

describe('incident states are distinguishable', () => {
  it('distinguishes "not allowed" from "no incidents"', async () => {
    fetchMock.mockImplementation(async () => code(403))
    render(<SafetyView policy={ownerPolicy} />)
    openIncidents()
    expect(await screen.findByText(/do not have access to this project/i)).toBeDefined()
    expect(screen.getByText(/safety\.view/i)).toBeDefined()
  })

  it('reports a failed request as an error', async () => {
    fetchMock.mockImplementation(async () => code(500))
    render(<SafetyView policy={ownerPolicy} />)
    openIncidents()
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/Could not load incidents/i)).toBeDefined()
  })

  it('reports a thrown request', async () => {
    fetchMock.mockImplementation(async () => { throw new Error('network down') })
    render(<SafetyView policy={ownerPolicy} />)
    openIncidents()
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/network down/i)).toBeDefined()
  })

  it('says so when there is no project to scope the query to', async () => {
    useBizStore.getState().reset()      // no projects at all
    render(<SafetyView policy={ownerPolicy} />)
    openIncidents()
    expect(await screen.findByText(/No project selected/i)).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ─── 3. The three tabs with no backend say so ────────────────────────────────

describe('a tab with no table does not pretend to be an empty register', () => {
  it('says JHAs are not stored yet', () => {
    render(<SafetyView policy={ownerPolicy} />)
    fireEvent.click(screen.getByRole('tab', { name: /JHA/i }))
    expect(screen.getByText(/Job Hazard Analyses are not stored yet/i)).toBeDefined()
    expect(screen.getByText(/no table and no API route/i)).toBeDefined()
  })

  it('says work permits are not stored yet', () => {
    render(<SafetyView policy={ownerPolicy} />)
    fireEvent.click(screen.getByRole('tab', { name: /Permits/i }))
    expect(screen.getByText(/Work permits are not stored yet/i)).toBeDefined()
  })

  it('says toolbox talks are not stored yet', () => {
    render(<SafetyView policy={ownerPolicy} />)
    fireEvent.click(screen.getByRole('tab', { name: /Toolbox/i }))
    expect(screen.getByText(/Toolbox talks are not stored yet/i)).toBeDefined()
  })

  it('still renders rows a caller supplies for those tabs', () => {
    // The notice is about an ABSENT domain, not a veto on data. An embedder that
    // has JHAs from somewhere still gets its table.
    render(<SafetyView policy={ownerPolicy} jhas={[{ id: 'JHA-1', title: 'Confined space entry', status: 'draft' }]} />)
    fireEvent.click(screen.getByRole('tab', { name: /JHA/i }))
    expect(screen.getByText('Confined space entry')).toBeDefined()
    expect(screen.queryByText(/not stored yet/i)).toBeNull()
  })
})

// ─── 4. Props and store still take precedence ────────────────────────────────

describe('an explicit source is never overridden by a fetch', () => {
  it('makes no request when incidents are supplied as props', async () => {
    render(<SafetyView policy={ownerPolicy} incidents={[{ id: 'INC-1', title: 'Prop incident', status: 'open' }]} />)
    openIncidents()
    expect(await screen.findByText('Prop incident')).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('makes no request when the store holds incidents', async () => {
    useBizStore.getState().dispatch(actions.addIncident({
      id: 'INC-2', title: 'Store incident', status: 'open', date: '2026-02-01',
    }))
    render(<SafetyView policy={ownerPolicy} />)
    openIncidents()
    expect(await screen.findByText('Store incident')).toBeDefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('offers no project selector when it is not the one fetching', async () => {
    render(<SafetyView policy={ownerPolicy} incidents={[{ id: 'INC-1', title: 'Prop incident', status: 'open' }]} />)
    openIncidents()
    await screen.findByText('Prop incident')
    expect(screen.queryByLabelText(/Filter incidents by project/i)).toBeNull()
  })
})
