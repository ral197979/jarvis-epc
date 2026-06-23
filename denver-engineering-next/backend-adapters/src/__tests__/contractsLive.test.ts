import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  mapContract,
  mapChangeOrder,
  fetchContractsLive,
  fetchChangeOrdersLive,
  type RawSubcontract,
  type RawChangeOrder,
} from '../live/contractsLive'

const rawSc: RawSubcontract = {
  id: 'uuid-sc1',
  projectId: 'PRJ-1',
  scNumber: 14,
  title: 'Civil Works Subcontract',
  vendorName: 'BuildRight Civil',
  status: 'active',
  contractValue: 92_000_000,
  executedAt: '2024-01-18T00:00:00Z',
}

describe('mapContract (subcontract → UI)', () => {
  it('maps number/title/vendor/value/status/executed', () => {
    const c = mapContract(rawSc)
    expect(c.id).toBe('SC-14')
    expect(c.title).toBe('Civil Works Subcontract')
    expect(c.counterparty).toBe('BuildRight Civil')
    expect(c.type).toBe('Subcontract')
    expect(c.value).toBe('$92M')
    expect(c.status).toBe('Active')
    expect(c.executed).toBe('2024-01-18')
  })
  it('falls back gracefully on nulls + string numerics', () => {
    const c = mapContract({ ...rawSc, vendorName: null, status: null, executedAt: null, contractValue: '48000000' } as RawSubcontract)
    expect(c.counterparty).toBe('—')
    expect(c.status).toBe('—')
    expect(c.executed).toBe('—')
    expect(c.value).toBe('$48M')
  })
})

const rawCo: RawChangeOrder = {
  id: 'uuid-co1',
  projectId: 'PRJ-1',
  coNumber: 101,
  title: 'Added flare stack scope',
  type: 'scope_time_cost',
  status: 'approved',
  costImpact: 4_200_000,
}

describe('mapChangeOrder (CO → UI)', () => {
  it('maps number/title/status and signs the cost impact', () => {
    const co = mapChangeOrder(rawCo)
    expect(co.id).toBe('CO-101')
    expect(co.description).toBe('Added flare stack scope')
    expect(co.status).toBe('Approved')
    expect(co.value).toBe('+$4.2M')
  })
  it('renders credits as negative', () => {
    expect(mapChangeOrder({ ...rawCo, costImpact: -600_000 }).value).toBe('-$600K')
  })
})

describe('live fetchers (stubbed fetch — verifies URL + unwrapping)', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stub = (payload: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload }) as Response))

  it('fetchContractsLive hits the project-scoped subcontracts route', async () => {
    stub({ subcontracts: [rawSc] })
    const out = await fetchContractsLive('PRJ-1')
    expect(fetch).toHaveBeenCalledWith('/api/v1/projects/PRJ-1/subcontracts', expect.objectContaining({ credentials: 'include' }))
    expect(out).toEqual([mapContract(rawSc)])
  })

  it('fetchChangeOrdersLive hits the change-orders route and unwraps { items }', async () => {
    stub({ items: [rawCo], total: 1 })
    const out = await fetchChangeOrdersLive('PRJ-1')
    expect(fetch).toHaveBeenCalledWith('/api/v1/projects/PRJ-1/change-orders', expect.objectContaining({ credentials: 'include' }))
    expect(out).toEqual([mapChangeOrder(rawCo)])
  })

  it('returns [] for a missing projectId without calling the API', async () => {
    stub({})
    expect(await fetchContractsLive('')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})
