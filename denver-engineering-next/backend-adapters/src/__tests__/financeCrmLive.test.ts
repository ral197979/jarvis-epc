import { describe, it, expect } from 'vitest'
import { mapEvmSummary, mapScurvePoint, type RawEvmMetrics, type RawScurvePoint } from '../live/financeLive'
import { mapLead, mapFunnel, type RawProposal, type RawPipelineSummary } from '../live/crmLive'

describe('mapEvmSummary (live → UI)', () => {
  const m: RawEvmMetrics = {
    bac: 12_000_000, bcws: 4_280_000, bcwp: 3_920_000, acwp: 4_150_000,
    cpi: 0.94, spi: 0.92, eac: 12_450_000, etc: 8_530_000, vac: -1_420_000,
  }
  it('formats PV/EV/AC/EAC and passes indices through', () => {
    const s = mapEvmSummary(m)
    expect(s.pv).toBe('$4.3M')
    expect(s.ev).toBe('$3.9M')
    expect(s.ac).toBe('$4.2M')
    expect(s.cpi).toBe(0.94)
    expect(s.spi).toBe(0.92)
    expect(s.eac).toBe('$12.5M')
  })
  it('handles null indices', () => {
    const s = mapEvmSummary({ ...m, cpi: null, spi: null })
    expect(s.cpi).toBe(0)
    expect(s.spi).toBe(0)
  })
})

describe('mapScurvePoint (live → UI, $ → $M)', () => {
  it('labels the month and converts to millions', () => {
    const p: RawScurvePoint = { snapshotDate: '2024-06-30', bcws: 4_280_000, bcwp: 3_920_000, acwp: 4_150_000 }
    const t = mapScurvePoint(p)
    expect(t.month).toBe('Jun')
    expect(t.pv).toBe(4.28)
    expect(t.ev).toBe(3.92)
    expect(t.ac).toBe(4.15)
  })
})

describe('mapLead (proposal → CRM lead)', () => {
  const p: RawProposal = {
    id: 'uuid-p1', proposalNumber: 'PRP-501', title: 'Red Sea Desalination',
    clientName: 'ACWA Power', status: 'submitted', estimatedValue: 540_000_000, probabilityPct: 38,
  }
  it('maps fields and translates status → pipeline stage', () => {
    const l = mapLead(p)
    expect(l.id).toBe('PRP-501')
    expect(l.name).toBe('Red Sea Desalination')
    expect(l.estValue).toBe('$540M')
    expect(l.probability).toBe(38)
    expect(l.stage).toBe('Tendering')
  })
  it('maps won → Awarded', () => {
    expect(mapLead({ ...p, status: 'won' }).stage).toBe('Awarded')
  })
})

describe('mapFunnel (pipeline summary → funnel stages)', () => {
  it('collapses statuses into stages with formatted value', () => {
    const summary: RawPipelineSummary = {
      byStatus: {
        draft: { count: 28, value: 540_000_000 },
        submitted: { count: 12, value: 420_000_000 },
        won: { count: 3, value: 95_000_000 },
      },
      weightedPipeline: 300_000_000,
    }
    const funnel = mapFunnel(summary)
    expect(funnel).toHaveLength(3)
    expect(funnel[0]).toEqual({ stage: 'Qualification', count: 28, value: '$540M' })
    expect(funnel[2]).toEqual({ stage: 'Awarded', count: 3, value: '$95M' })
  })
  it('defaults missing statuses to zero', () => {
    const funnel = mapFunnel({ byStatus: {}, weightedPipeline: 0 })
    expect(funnel[1]).toEqual({ stage: 'Tendering', count: 0, value: '$0' })
  })
})
