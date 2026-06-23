import { describe, it, expect } from 'vitest'
import { mapProject, aggregateKpis, type RawProject } from '../live/projectsLive'

const base: RawProject = {
  id: 'uuid-1',
  code: 'PRJ-001',
  name: 'Test Plant',
  client_name: 'Acme',
  location: 'Houston',
  country: 'USA',
  status: 'construction',
  current_phase: 'long_lead_procurement',
  currency: 'USD',
  budget: 420_000_000,
  actual_cost: 100_000_000,
  forecast_cost: null,
  progress_pct: 63.7,
  planned_finish: '2099-01-01',
  actual_finish: null,
  metadata: null,
}

describe('mapProject (live → UI shape)', () => {
  it('maps core fields and humanizes the phase', () => {
    const p = mapProject(base)
    expect(p.id).toBe('uuid-1')
    expect(p.client).toBe('Acme')
    expect(p.region).toBe('USA')
    expect(p.phase).toBe('Long Lead Procurement')
    expect(p.progressPct).toBe(64) // rounded
  })

  it('formats contract value compactly', () => {
    expect(mapProject(base).contractValue).toBe('$420M')
  })

  it('derives a healthy project when under budget and on schedule', () => {
    const p = mapProject(base)
    expect(p.budgetStatus).toBe('Healthy')
    expect(p.scheduleStatus).toBe('On Track')
    expect(p.health).toBe('healthy')
  })

  it('derives critical health on cost overrun', () => {
    const p = mapProject({ ...base, actual_cost: 500_000_000 })
    expect(p.budgetStatus).toBe('Overrun')
    expect(p.health).toBe('critical')
  })

  it('derives at-risk when schedule slips past planned finish', () => {
    const p = mapProject({ ...base, planned_finish: '2000-01-01' })
    expect(p.scheduleStatus).toBe('Delayed')
    expect(p.health).toBe('at-risk')
  })

  it('reads optional safety/quality/geo from metadata', () => {
    const p = mapProject({ ...base, metadata: { safety_status: '1 LTI', quality_pct: 92, lat: 29.7, lng: -95.3 } })
    expect(p.safetyStatus).toBe('1 LTI')
    expect(p.qualityPct).toBe(92)
    expect(p.lat).toBeCloseTo(29.7)
  })

  it('handles string-typed numerics from the pg driver', () => {
    const p = mapProject({ ...base, budget: '420000000', progress_pct: '50' } as unknown as RawProject)
    expect(p.contractValue).toBe('$420M')
    expect(p.progressPct).toBe(50)
  })
})

describe('aggregateKpis (portfolio rollup over live projects)', () => {
  it('sums budget/actual and counts health', () => {
    const rows: RawProject[] = [
      { ...base, budget: 400_000_000, actual_cost: 100_000_000, planned_finish: '2099-01-01' }, // healthy
      { ...base, budget: 600_000_000, actual_cost: 700_000_000 }, // overrun → critical
      { ...base, budget: 200_000_000, actual_cost: 0, planned_finish: '2000-01-01' }, // delayed → at-risk
    ]
    const k = aggregateKpis(rows)
    expect(k.totalContractValue).toBe('$1.2B')
    expect(k.actualCost).toBe('$800M')
    expect(k.onTrack).toBe(1)
    expect(k.atRisk).toBe(2)
  })
})
