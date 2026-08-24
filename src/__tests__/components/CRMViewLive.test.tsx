/**
 * CRMView — the proposals KPI reads its real backend, and the two domains
 * without one say so.
 *
 * The registry graded `crm` PARTIAL because the view read three never-hydrated
 * store collections. The three are not the same defect:
 *
 *   proposals — GET /api/v1/proposals exists (crm.view, migration 062, full
 *               submit/won/lost lifecycle) and this view never called it;
 *   leads     — crm_leads exists as a TABLE (002_epc_core.sql:408, RLS and all)
 *               but no route anywhere reads it: nothing to fetch;
 *   customers — no table, no route (the Directory's conclusion).
 *
 * So the honest repair wires exactly one of the three and states the other two,
 * and these tests hold that line in both directions: the proposals number must
 * come from the API, and the leads/customers numbers must NOT pretend to.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { CRMView } from '../../components/CRMView'
import { useBizStore } from '../../modules/biz/store'
import { actions } from '../../modules/biz/dispatch'

/** Rows exactly as the endpoint returns them — `{ proposals }`, snake_case. */
const PROPOSAL_ROWS = [
  { id: 'p1', proposal_number: 1, title: 'WWTP expansion bid', client_name: 'City of Denver',
    status: 'draft',     estimated_value: '2500000.00', item_count: 3, items_total: '2400000.00' },
  { id: 'p2', proposal_number: 2, title: 'Pump station rehab', client_name: 'Aurora Water',
    status: 'submitted', estimated_value: '800000.00',  item_count: 1, items_total: '750000.00' },
  { id: 'p3', proposal_number: 3, title: 'Lift station',       client_name: 'Boulder',
    status: 'won',       estimated_value: '400000.00',  item_count: 2, items_total: '400000.00' },
  { id: 'p4', proposal_number: 4, title: 'Declined job',       client_name: 'Golden',
    status: 'no_bid',    estimated_value: '0',          item_count: 0, items_total: '0' },
]

let fetchMock: ReturnType<typeof vi.fn>
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

beforeEach(() => {
  useBizStore.getState().reset()
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/proposals')) return ok({ proposals: PROPOSAL_ROWS })
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const kpi = (name: string) => screen.getByRole('group', { name })

describe('the proposals KPI reads the real endpoint', () => {
  it('counts the API rows, unwrapping the { proposals } envelope', async () => {
    render(<CRMView />)
    await waitFor(() => expect(kpi('Proposals').textContent).toContain('4'))
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.some(u => u.startsWith('/api/v1/proposals'))).toBe(true)
  })

  it('counts open as not-yet-decided, in the schema vocabulary', async () => {
    // migration 062: draft|submitted|won|lost|no_bid. The store shape used a
    // literal 'open' status that the API never emits; draft and submitted are
    // the two undecided states, so 2 of the 4 fixture rows are open.
    render(<CRMView />)
    await waitFor(() => expect(kpi('Proposals').textContent).toContain('2 open'))
  })

  it('shows a dash and the required capability on 403, not a zero', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({}) }))
    render(<CRMView />)
    await waitFor(() => expect(kpi('Proposals').textContent).toContain('—'))
    expect(kpi('Proposals').textContent).toContain('crm.view')
  })

  it('shows a dash on failure, not a zero', async () => {
    fetchMock.mockImplementation(async () => { throw new Error('down') })
    render(<CRMView />)
    await waitFor(() => expect(kpi('Proposals').textContent).toContain('load failed'))
    expect(kpi('Proposals').textContent).not.toMatch(/\b0\b/)
  })

  it('never fetches when the store already holds proposals', async () => {
    useBizStore.getState().dispatch(actions.addProposal({ id: 'sp1', status: 'open' }))
    render(<CRMView />)
    await waitFor(() => expect(kpi('Proposals').textContent).toContain('1'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the two domains without a backend say so', () => {
  it('shows an em dash for customers, which have no table and no route', async () => {
    render(<CRMView />)
    await waitFor(() => expect(kpi('Proposals').textContent).toContain('4'))
    expect(kpi('Customers').textContent).toContain('—')
    expect(kpi('Customers').textContent).not.toMatch(/\b0\b/)
  })

  it('says the pipeline cannot be known, instead of showing six confident zeros', async () => {
    render(<CRMView />)
    expect(screen.getByRole('note')).toBeDefined()
    expect(screen.getByText(/crm_leads table has no API yet/i)).toBeDefined()
  })

  it('drops the note the moment leads actually exist', async () => {
    useBizStore.getState().dispatch(actions.addLead({ id: 'l1', status: 'prospect', value: 100000 }))
    render(<CRMView />)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('requests nothing for leads or customers — there is no endpoint to ask', async () => {
    render(<CRMView />)
    await waitFor(() => expect(kpi('Proposals').textContent).toContain('4'))
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls.every(u => u.startsWith('/api/v1/proposals'))).toBe(true)
  })
})
