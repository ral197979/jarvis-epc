import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  mapDeficiency,
  mapEquipment,
  mapTestPack,
  fetchTestPacksLive,
  type RawDeficiency,
  type RawTag,
  type RawTestPack,
} from '../live/commissioningLive'

const rawDef: RawDeficiency = {
  id: 'uuid-d1',
  code: 'DEF-4821',
  title: 'Condenser pressure transmitter out of calibration',
  description: null,
  severity: 'critical',
  status: 'open',
  tag_id: 'uuid-tag',
  assignee_user_id: null,
  due_date: null,
  closed_at: null,
  created_at: '2024-06-14T09:30:00.000Z',
}

describe('mapDeficiency (live → UI)', () => {
  it('maps code, title and capitalizes severity/status', () => {
    const d = mapDeficiency(rawDef)
    expect(d.id).toBe('DEF-4821')
    expect(d.description).toMatch(/calibration/)
    expect(d.severity).toBe('Critical')
    expect(d.status).toBe('Open')
    expect(d.loggedAt).toBe('2024-06-14')
  })

  it('derives EPC category from severity', () => {
    expect(mapDeficiency({ ...rawDef, severity: 'critical' }).category).toBe('A')
    expect(mapDeficiency({ ...rawDef, severity: 'high' }).category).toBe('B')
    expect(mapDeficiency({ ...rawDef, severity: 'low' }).category).toBe('C')
  })

  it('falls back gracefully on missing fields', () => {
    const d = mapDeficiency({ ...rawDef, code: null, title: null, description: null, severity: null, status: null, created_at: null })
    expect(d.id).toBe('uuid-d1')
    expect(d.description).toBe('—')
    expect(d.loggedAt).toBe('—')
  })
})

const rawTag: RawTag = {
  id: 'uuid-t1',
  system_id: 'uuid-sys',
  tag_no: 'HVAC-CH-001',
  equipment_name: 'Centrifugal Chiller A',
  equipment_type: 'Chilled Water',
  manufacturer: 'Trane',
  model_no: 'CVHF-1250',
  serial_no: 'SN-9921',
  status: 'operational',
}

describe('mapEquipment (live → UI)', () => {
  it('maps tag fields and prefers equipment_type for system display', () => {
    const e = mapEquipment(rawTag)
    expect(e.tag).toBe('HVAC-CH-001')
    expect(e.name).toBe('Centrifugal Chiller A')
    expect(e.system).toBe('Chilled Water')
    expect(e.vendor).toBe('Trane')
    expect(e.status).toBe('Operational')
  })

  it('derives completion % from lifecycle status', () => {
    expect(mapEquipment({ ...rawTag, status: 'operational' }).completionPct).toBe(100)
    expect(mapEquipment({ ...rawTag, status: 'testing' }).completionPct).toBe(65)
    expect(mapEquipment({ ...rawTag, status: 'planned' }).completionPct).toBe(10)
    expect(mapEquipment({ ...rawTag, status: 'unknown' }).completionPct).toBe(0)
  })
})

const rawPack: RawTestPack = {
  id: 'uuid-tp1',
  pack_no: 'TP-CW-01',
  title: 'Chilled Water Hydrotest',
  pack_type: 'hydrotest',
  status: 'approved',
  system_name: 'Chilled Water',
  created_at: '2024-06-02T00:00:00Z',
}

describe('mapTestPack (live → UI)', () => {
  it('maps pack_no/system/type/date and derives progress + qa from status', () => {
    const p = mapTestPack(rawPack)
    expect(p.id).toBe('TP-CW-01')
    expect(p.discipline).toBe('Chilled Water')
    expect(p.testType).toBe('Hydrotest')
    expect(p.preparedBy).toBe('—')
    expect(p.date).toBe('2024-06-02')
    expect(p.qaSignature).toBe('Approved')
    expect(p.progressPct).toBe(100)
  })
  it('derives partial/zero progress from status', () => {
    expect(mapTestPack({ ...rawPack, status: 'in_progress' }).progressPct).toBe(50)
    expect(mapTestPack({ ...rawPack, status: 'draft' }).progressPct).toBe(10)
    expect(mapTestPack({ ...rawPack, status: null }).progressPct).toBe(0)
  })
})

describe('fetchTestPacksLive (stubbed fetch)', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('hits the project-scoped test-packs route and unwraps { items }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ items: [rawPack] }) }) as Response))
    const out = await fetchTestPacksLive('PRJ-1')
    expect(fetch).toHaveBeenCalledWith('/api/v1/projects/PRJ-1/test-packs', expect.objectContaining({ credentials: 'include' }))
    expect(out).toEqual([mapTestPack(rawPack)])
  })
  it('returns [] for a missing projectId without calling the API', async () => {
    vi.stubGlobal('fetch', vi.fn())
    expect(await fetchTestPacksLive('')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })
})
