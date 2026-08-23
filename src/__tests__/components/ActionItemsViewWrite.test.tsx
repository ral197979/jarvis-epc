/**
 * ActionItemsView — status transitions.
 *
 * Reading the register was the previous slice; this is the half that makes it a
 * workflow rather than a report. `PATCH /api/v1/actions/:id` was implemented,
 * mounted and authorized (personal.write + requireActionAccess, which is
 * personal OWNERSHIP and strictly narrower than project membership per ADR-014
 * D29) and had no caller anywhere in the app.
 *
 * Three properties these tests hold:
 *
 *   1. the transition sends the migration-029 status value, not the component's
 *      display vocabulary — `Complete` must PATCH `completed`, never `resolved`;
 *   2. the UI answers from the ROW THE SERVER RETURNED, so `completed_at` and
 *      any server-applied rule land in the view rather than an optimistic guess;
 *   3. a refusal is shown as a refusal. `requireActionAccess` 404s an action
 *      that is not yours, and that must not look like a successful update.
 *
 * Reassignment is deliberately absent: it needs personal.admin, which ADR-014
 * D11 fixes to {owner}, so a control for it would 403 for nearly every user.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import { ActionItemsView } from '../../components/ActionItemsView'
import { useBizStore } from '../../modules/biz/store'
import { actions } from '../../modules/biz/dispatch'
import type { PolicyConfig } from '../../modules/biz/dispatch'

const ownerPolicy: PolicyConfig = {
  writesEnabled: true, chatEnabled: true, exportsEnabled: true, activeRole: 'owner',
}
const viewerPolicy: PolicyConfig = {
  writesEnabled: false, chatEnabled: true, exportsEnabled: true, activeRole: 'viewer',
}

const ACTION_ID = '11111111-1111-4111-8111-111111111111'

const OPEN_ROW = {
  id: ACTION_ID,
  title: 'Respond to HAZOP action', description: 'P&ID markup needs a response.',
  status: 'open', priority: 'high',
  action_type: 'RFI', source_module: 'rfis', source_id: '99999999-9999-4999-8999-999999999999',
  project_code: 'ACME-01', assigned_user_email: 'jane@denver.example',
  due_at: '2026-01-15T00:00:00.000Z', created_at: '2025-12-01T00:00:00.000Z',
}

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) })
const code = (n: number) => ({ ok: false, status: n, json: async () => ({ error: 'x' }) })

let fetchMock: ReturnType<typeof vi.fn>
let patches: { url: string; body: Record<string, unknown> }[]

function listReturns(rows: unknown[]): void {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      patches.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> })
      const next = { ...OPEN_ROW, ...(JSON.parse(String(init.body)) as object) }
      return ok(next)
    }
    if (url.startsWith('/api/v1/actions?')) return ok(rows)
    return ok([])
  })
}

beforeEach(() => {
  useBizStore.getState().reset()
  patches = []
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  listReturns([OPEN_ROW])
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function openDetail(policy: PolicyConfig = ownerPolicy): Promise<void> {
  render(<ActionItemsView policy={policy} />)
  fireEvent.click(await screen.findByText('Respond to HAZOP action'))
  await screen.findByText(/All Actions/i)
}

// ─── 1. The transitions exist and are offered by current status ──────────────

describe('the detail panel offers the transitions the API accepts', () => {
  it('offers Start, Complete and Cancel on an open action', async () => {
    await openDetail()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Complete' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined()
    // Reopen belongs to a closed action, not this one.
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull()
  })

  it('offers Reopen, and only Reopen, on a completed action', async () => {
    listReturns([{ ...OPEN_ROW, status: 'completed' }])
    await openDetail()
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull()
  })

  it('offers Reopen on a cancelled action too', async () => {
    listReturns([{ ...OPEN_ROW, status: 'cancelled' }])
    await openDetail()
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeDefined()
  })
})

// ─── 2. It sends the value the database constraint accepts ───────────────────

describe('the request speaks the schema vocabulary, not the display one', () => {
  it('PATCHes completed — not the resolved label the UI shows', async () => {
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]!.url).toBe(`/api/v1/actions/${ACTION_ID}`)
    // migration 029: CHECK (status IN ('open','in_progress','completed','cancelled'))
    expect(patches[0]!.body).toEqual({ status: 'completed' })
  })

  it('PATCHes in_progress for Start, with the underscore the CHECK requires', async () => {
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]!.body).toEqual({ status: 'in_progress' })
  })

  it('PATCHes cancelled for Cancel', async () => {
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]!.body).toEqual({ status: 'cancelled' })
  })

  it('sends only the status field, never a reassignment', async () => {
    // assigned_to_user_id / assigned_to_role sit behind personal.admin. This
    // panel must not smuggle them into an ordinary personal write.
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(Object.keys(patches[0]!.body)).toEqual(['status'])
  })
})

// ─── 3. The answer comes from the server's row ───────────────────────────────

describe('the view answers from the record, not from the request', () => {
  it('reflects the server row after a successful transition', async () => {
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    // `completed` maps back to the component's `resolved`, so Reopen replaces
    // the forward transitions.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reopen' })).toBeDefined())
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull()
  })

  it('takes the server value even when it differs from what was asked', async () => {
    // The handler stamps completed_at and may apply its own rules; a view that
    // echoed the optimistic value would drift from the record. Here the server
    // answers `cancelled` to a `completed` request, and the view must follow it.
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return ok({ ...OPEN_ROW, status: 'cancelled' })
      if (url.startsWith('/api/v1/actions?')) return ok([OPEN_ROW])
      return ok([])
    })
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reopen' })).toBeDefined())
    fireEvent.click(screen.getByText(/All Actions/i))
    // The list row carries the server's answer, and a cancellation is not a
    // completion — the Resolved KPI must not have moved.
    await waitFor(() => expect(screen.getByRole('group', { name: 'Resolved' }).textContent).toContain('0'))
  })

  it('writes the change back into the list it came from', async () => {
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    fireEvent.click(screen.getByText(/All Actions/i))
    const resolvedTable = await screen.findByRole('table', { name: /Resolved Items/i })
    expect(resolvedTable.textContent).toContain('Respond to HAZOP action')
  })

  it('does not refetch the whole list after a write', async () => {
    await openDetail()
    const before = fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/v1/actions?')).length
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    const after = fetchMock.mock.calls.filter(c => String(c[0]).startsWith('/api/v1/actions?')).length
    expect(after).toBe(before)
  })
})

// ─── 4. Refusals are shown as refusals ───────────────────────────────────────

describe('a refused transition is not reported as a success', () => {
  it('explains a 404 from requireActionAccess without changing the status', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return code(404)
      if (url.startsWith('/api/v1/actions?')) return ok([OPEN_ROW])
      return ok([])
    })
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/not yours to change/i)).toBeDefined()
    // Still open — the forward transitions are still the ones offered.
    expect(screen.getByRole('button', { name: 'Complete' })).toBeDefined()
  })

  it('explains a 403 in terms of the action attempted', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return code(403)
      if (url.startsWith('/api/v1/actions?')) return ok([OPEN_ROW])
      return ok([])
    })
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('alert')).toBeDefined()
    expect(screen.getByText(/not allowed to cancel/i)).toBeDefined()
  })

  it('reports a 500 as a failure', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return code(500)
      if (url.startsWith('/api/v1/actions?')) return ok([OPEN_ROW])
      return ok([])
    })
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    expect(await screen.findByText(/Update failed \(500\)/i)).toBeDefined()
  })

  it('reports a thrown request', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') throw new Error('network down')
      if (url.startsWith('/api/v1/actions?')) return ok([OPEN_ROW])
      return ok([])
    })
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    expect(await screen.findByText(/network down/i)).toBeDefined()
  })
})

// ─── 5. No control is offered where it cannot work ───────────────────────────

describe('controls are offered only where they can succeed', () => {
  it('offers nothing to a viewer', async () => {
    await openDetail(viewerPolicy)
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('offers nothing on a store-dispatched row, whose id is not an actions.id', async () => {
    // `AI-001` is not a UUID in `actions`; a PATCH would 404. A button that
    // cannot work is worse than no button.
    useBizStore.getState().dispatch(actions.addAction({
      id: 'AI-001', subject: 'Store-dispatched item', project: 'Acme Refinery',
      priority: 'high', assigned: 'Jane Smith', due: '2026-01-15', status: 'open',
      category: 'engineering',
    }))
    render(<ActionItemsView policy={ownerPolicy} />)
    fireEvent.click(await screen.findByText('Store-dispatched item'))
    await screen.findByText(/All Actions/i)
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('disables every transition while one is in flight', async () => {
    let release: (v: unknown) => void = () => {}
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') { await new Promise(r => { release = r }); return ok({ ...OPEN_ROW, status: 'completed' }) }
      if (url.startsWith('/api/v1/actions?')) return ok([OPEN_ROW])
      return ok([])
    })
    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Complete…/ })).toBeDefined())
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true)
    release(null)
  })
})
