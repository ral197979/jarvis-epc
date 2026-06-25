/**
 * Tests: api/services/integration/commissioningGateway.ts
 *
 * Proves the flag gate: with COMMISSIONING_EXTERNAL off (default) the gateway is
 * a no-op that never touches the network; with it on, it calls the configured
 * endpoint with the right auth/idempotency headers and seeds the mirror.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockSeedMirror = vi.fn()
vi.mock('../services/integration/cxStatusMirror', () => ({
  seedMirror: (...a: unknown[]) => mockSeedMirror(...a),
}))

import { createHandoff } from '../services/integration/commissioningGateway'

const INPUT = {
  tenant_id: 't1', project_id: 'p1', turnover_package_id: 'tp1',
  name: 'Area 200', idempotency_key: 'idem-1',
}

describe('commissioningGateway.createHandoff', () => {
  beforeEach(() => {
    mockSeedMirror.mockReset()
    delete process.env['COMMISSIONING_EXTERNAL']
    delete process.env['COMMISSIONING_BASE_URL']
    delete process.env['COMMISSIONING_SVC_TOKEN']
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('is a no-op when the flag is off (no network call)', async () => {
    const r = await createHandoff(INPUT)
    expect(r).toEqual({ enabled: false })
    expect(fetch).not.toHaveBeenCalled()
    expect(mockSeedMirror).not.toHaveBeenCalled()
  })

  it('calls the endpoint and seeds the mirror when enabled', async () => {
    process.env['COMMISSIONING_EXTERNAL'] = 'true'
    process.env['COMMISSIONING_BASE_URL'] = 'https://cx.example.com'
    process.env['COMMISSIONING_SVC_TOKEN'] = 'tok-123'
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ handoff_id: 'hx9', workspace_url: 'https://cx.example.com/ws/hx9', status: 'received' }),
    })

    const r = await createHandoff(INPUT)
    expect(r).toEqual({ enabled: true, handoff_id: 'hx9', workspace_url: 'https://cx.example.com/ws/hx9', status: 'received' })

    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://cx.example.com/api/cx/v1/handoffs')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Authorization']).toBe('Bearer tok-123')
    expect(opts.headers['Idempotency-Key']).toBe('idem-1')

    expect(mockSeedMirror).toHaveBeenCalledWith('t1', 'hx9', expect.objectContaining({
      projectId: 'p1', turnoverPackageId: 'tp1', workspaceUrl: 'https://cx.example.com/ws/hx9',
    }))
  })

  it('throws when enabled but base URL is missing', async () => {
    process.env['COMMISSIONING_EXTERNAL'] = 'true'
    await expect(createHandoff(INPUT)).rejects.toThrow(/COMMISSIONING_BASE_URL/)
    expect(fetch).not.toHaveBeenCalled()
  })
})
