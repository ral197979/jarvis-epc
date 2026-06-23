import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  mapAdminUser,
  mapFeatureGate,
  fetchAdminUsersLive,
  fetchFeatureGatesLive,
  type RawTeamMember,
  type RawFeatureFlag,
} from '../live/adminLive'

const rawMember: RawTeamMember = {
  id: 'U1',
  fullName: 'Alex Sterling',
  email: 'asterling@denver.eng',
  role: 'Program Director',
  status: 'active',
  updatedAt: '2024-06-20T09:00:00Z',
}

describe('mapAdminUser (team member → UI)', () => {
  it('maps name/email/role and capitalizes status, derives lastActive from updatedAt', () => {
    const u = mapAdminUser(rawMember)
    expect(u.name).toBe('Alex Sterling')
    expect(u.email).toBe('asterling@denver.eng')
    expect(u.role).toBe('Program Director')
    expect(u.status).toBe('Active')
    expect(u.lastActive).toBe('2024-06-20')
  })
  it('falls back to first+last name and handles nulls', () => {
    const u = mapAdminUser({ id: 'U2', fullName: null, firstName: 'Sam', lastName: 'Pena', email: null, role: null, status: null, updatedAt: null })
    expect(u.name).toBe('Sam Pena')
    expect(u.email).toBe('—')
    expect(u.lastActive).toBe('—')
  })
})

describe('mapFeatureGate (flag → UI)', () => {
  it('uses config label/rollout when present', () => {
    const g = mapFeatureGate({ featureKey: 'ai_copilot', enabled: true, config: { label: 'AI Copilot', rollout: '100%' } })
    expect(g).toEqual({ key: 'ai_copilot', label: 'AI Copilot', enabled: true, rollout: '100%' })
  })
  it('humanizes the key and defaults rollout from enabled when config is absent', () => {
    expect(mapFeatureGate({ featureKey: 'scada_bms', enabled: false, config: null })).toEqual({
      key: 'scada_bms', label: 'Scada Bms', enabled: false, rollout: 'Off',
    })
    expect(mapFeatureGate({ featureKey: 'ist', enabled: true }).rollout).toBe('100%')
  })
})

describe('live fetchers (stubbed fetch)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const stub = (payload: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload }) as Response))

  it('fetchAdminUsersLive hits /team/members and unwraps { members }', async () => {
    stub({ members: [rawMember] })
    const out = await fetchAdminUsersLive()
    expect(fetch).toHaveBeenCalledWith('/api/v1/team/members', expect.objectContaining({ credentials: 'include' }))
    expect(out).toEqual([mapAdminUser(rawMember)])
  })

  it('fetchFeatureGatesLive hits /enterprise/features (unwrapped array)', async () => {
    const flag: RawFeatureFlag = { featureKey: 'digital_twin', enabled: true, config: { rollout: '25% (beta)' } }
    stub([flag])
    const out = await fetchFeatureGatesLive()
    expect(fetch).toHaveBeenCalledWith('/api/v1/enterprise/features', expect.objectContaining({ credentials: 'include' }))
    expect(out).toEqual([mapFeatureGate(flag)])
  })
})
