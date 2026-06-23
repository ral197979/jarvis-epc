import { describe, it, expect, vi, afterEach } from 'vitest'
import { mapTwinAsset, fetchTwinAssetsLive, type RawTwin } from '../live/twinLive'

const rawTwin: RawTwin = {
  id: 'uuid-tw1',
  entityType: 'equipment',
  entityId: 'HVAC-CH-001',
  name: 'Centrifugal Chiller A',
  status: 'operational',
  readinessScore: 0.88,
  metadata: { system: 'Chilled Water', open_punch: 2 },
}

describe('mapTwinAsset (twin → UI)', () => {
  it('maps entityId/name/status and reads system + punch from metadata', () => {
    const a = mapTwinAsset(rawTwin)
    expect(a.id).toBe('HVAC-CH-001')
    expect(a.tag).toBe('HVAC-CH-001')
    expect(a.name).toBe('Centrifugal Chiller A')
    expect(a.system).toBe('Chilled Water')
    expect(a.status).toBe('Operational')
    expect(a.openPunch).toBe(2)
    expect(a.telemetry).toEqual([]) // live telemetry not wired
  })
  it('normalizes a 0–1 readiness score to a 0–100 percent', () => {
    expect(mapTwinAsset({ ...rawTwin, readinessScore: 0.45 }).completionPct).toBe(45)
  })
  it('passes through a 0–100 readiness score unchanged', () => {
    expect(mapTwinAsset({ ...rawTwin, readinessScore: 64 }).completionPct).toBe(64)
  })
  it('falls back to entityType for system when metadata is absent', () => {
    const a = mapTwinAsset({ ...rawTwin, metadata: null })
    expect(a.system).toBe('Equipment')
    expect(a.openPunch).toBe(0)
  })
})

describe('fetchTwinAssetsLive (stubbed fetch)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('hits /twins and unwraps { twins }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ twins: [rawTwin], count: 1 }) }) as Response))
    const out = await fetchTwinAssetsLive()
    expect(fetch).toHaveBeenCalledWith('/api/v1/twins?limit=200', expect.objectContaining({ credentials: 'include' }))
    expect(out).toEqual([mapTwinAsset(rawTwin)])
  })
})
