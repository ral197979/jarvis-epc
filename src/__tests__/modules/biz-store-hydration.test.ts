/**
 * AUDIT-P0-10 regression — biz store backend hydration.
 * Before this fix, nothing ever fetched the `projects` collection (or any
 * other useBizStore collection) from the backend — every fresh session
 * showed a silent, error-free empty state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useBizStore, hydrateProjectsFromBackend, selectProjects } from '../../modules/biz/store'
import { JARVIS_ACTIONS } from '../../modules/biz/reducer'

beforeEach(() => {
  useBizStore.getState().reset()
})

describe('hydrateProjectsFromBackend', () => {
  it('populates the projects collection from a successful fetch', async () => {
    const rows = [{ id: 'p1', name: 'Project One' }, { id: 'p2', name: 'Project Two' }]
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: rows, meta: { total: 2 } }),
    })

    const result = await hydrateProjectsFromBackend(fetchMock as unknown as typeof fetch)

    expect(result).toEqual({ ok: true, count: 2 })
    expect(selectProjects(useBizStore.getState())).toEqual(rows)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects', { credentials: 'include' })
  })

  it('does not wipe other collections already in the store', async () => {
    useBizStore.getState().dispatch({
      type: JARVIS_ACTIONS.ADD_LEAD,
      data: { id: 'L-1', status: 'open' },
    })

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ data: [{ id: 'p1' }] }),
    })
    await hydrateProjectsFromBackend(fetchMock as unknown as typeof fetch)

    expect(useBizStore.getState().biz.leads.length).toBe(1)
    expect(selectProjects(useBizStore.getState()).length).toBe(1)
  })

  it('leaves the store untouched and reports failure on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) })

    const result = await hydrateProjectsFromBackend(fetchMock as unknown as typeof fetch)

    expect(result).toEqual({ ok: false, count: 0 })
    expect(selectProjects(useBizStore.getState())).toEqual([])
  })

  it('leaves the store untouched and reports failure on a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))

    const result = await hydrateProjectsFromBackend(fetchMock as unknown as typeof fetch)

    expect(result).toEqual({ ok: false, count: 0 })
    expect(selectProjects(useBizStore.getState())).toEqual([])
  })

  it('tolerates a malformed response body (missing data field)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })

    const result = await hydrateProjectsFromBackend(fetchMock as unknown as typeof fetch)

    expect(result).toEqual({ ok: true, count: 0 })
    expect(selectProjects(useBizStore.getState())).toEqual([])
  })
})
