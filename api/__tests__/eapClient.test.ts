/**
 * Tests: api/services/eap/eapClient.ts
 *
 * Flag gate (no network when off), endpoint/auth/idempotency wiring when on,
 * doc-type fallback, missing-base-url error, and the doc-type catalogue helper.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generateDocument, exportDocument, isEapDocType, EAP_DOC_TYPES } from '../services/eap/eapClient'

const ENVS = ['EAP_ENABLED', 'CRANIA_BASE_URL', 'CRANIA_SVC_TOKEN', 'EAP_TIMEOUT_MS']

describe('eapClient', () => {
  beforeEach(() => { for (const k of ENVS) delete process.env[k]; vi.stubGlobal('fetch', vi.fn()) })
  afterEach(() => vi.unstubAllGlobals())

  const input = { doc_type: 'fat', project_id: 'p1', payload: { tag: 'P-101' }, idempotency_key: 'idem-1' }

  it('is a no-op when EAP_ENABLED is off (no network)', async () => {
    const r = await generateDocument(input)
    expect(r).toEqual({ enabled: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('generates via the EAP doc-factory when enabled', async () => {
    process.env['EAP_ENABLED'] = 'true'
    process.env['CRANIA_BASE_URL'] = 'https://crania.example.com'
    process.env['CRANIA_SVC_TOKEN'] = 'tok-9'
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ url: 'https://crania/docs/d1.pdf', sha256: 'ab12' }),
    })

    const r = await generateDocument(input)
    expect(r).toEqual({ enabled: true, document: { url: 'https://crania/docs/d1.pdf', sha256: 'ab12', doc_type: 'fat' } })

    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://crania.example.com/api/doc-factory/generate')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Authorization']).toBe('Bearer tok-9')
    expect(opts.headers['Idempotency-Key']).toBe('idem-1')
  })

  it('prefers the EAP-reported doc_type over the request', async () => {
    process.env['EAP_ENABLED'] = 'true'
    process.env['CRANIA_BASE_URL'] = 'https://crania.example.com'
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ url: 'u', sha256: 's', doc_type: 'fat_report' }),
    })
    const r = await generateDocument(input)
    expect(r).toMatchObject({ enabled: true, document: { doc_type: 'fat_report' } })
  })

  it('throws when enabled but CRANIA_BASE_URL is missing', async () => {
    process.env['EAP_ENABLED'] = 'true'
    await expect(generateDocument(input)).rejects.toThrow(/CRANIA_BASE_URL/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('exportDocument is gated and wired to the export endpoint', async () => {
    expect(await exportDocument('d1', 'pdf')).toEqual({ enabled: false })
    process.env['EAP_ENABLED'] = 'true'
    process.env['CRANIA_BASE_URL'] = 'https://crania.example.com'
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ url: 'u', sha256: 's' }) })
    const r = await exportDocument('d1', 'pdf')
    expect(r).toEqual({ enabled: true, document: { url: 'u', sha256: 's', doc_type: 'pdf' } })
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('https://crania.example.com/api/doc-factory/export')
  })

  it('exposes the doc-type catalogue', () => {
    expect(isEapDocType('turnover_package')).toBe(true)
    expect(isEapDocType('invoice')).toBe(false)
    expect(EAP_DOC_TYPES).toContain('sequence_of_operations')
  })
})
