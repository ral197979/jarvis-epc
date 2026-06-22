/**
 * AUD-004 / AUD-005 regression — SSRF guard.
 * Verifies that user-controllable outbound URLs cannot target internal,
 * loopback, link-local (cloud metadata) or reserved addresses, and that
 * non-http(s) schemes are rejected. Pure unit tests (no network) via the
 * synchronous classifyUrl + isPrivateIp core.
 */
import { describe, it, expect } from 'vitest'
import { classifyUrl, isPrivateIp, assertSafeUrl, SsrfBlockedError } from '../lib/ssrfGuard'

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254',  // AWS/GCP/Azure metadata endpoint
    '0.0.0.0', '100.64.0.1', '224.0.0.1',
    '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1',
    '::ffff:169.254.169.254',
  ])('flags %s as private/reserved', (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700::1111'])(
    'allows public address %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(false)
    },
  )
})

describe('classifyUrl', () => {
  it('rejects non-http(s) schemes', () => {
    for (const u of ['file:///etc/passwd', 'gopher://x', 'ftp://h/x', 'data:text/html,x']) {
      expect(classifyUrl(u).ok, u).toBe(false)
    }
  })

  it('rejects the cloud metadata IP literal', () => {
    const c = classifyUrl('http://169.254.169.254/latest/meta-data/iam/security-credentials/')
    expect(c.ok).toBe(false)
    expect(c.reason).toMatch(/private_ip/)
  })

  it('rejects localhost and internal hostnames', () => {
    expect(classifyUrl('http://localhost:6379').ok).toBe(false)
    expect(classifyUrl('http://foo.internal/x').ok).toBe(false)
    expect(classifyUrl('http://metadata.google.internal/x').ok).toBe(false)
  })

  it('rejects private IP literals', () => {
    expect(classifyUrl('http://127.0.0.1:5432').ok).toBe(false)
    expect(classifyUrl('http://10.1.2.3/admin').ok).toBe(false)
    expect(classifyUrl('https://192.168.0.1/').ok).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(classifyUrl('not a url').ok).toBe(false)
    expect(classifyUrl('').ok).toBe(false)
  })

  it('allows a public IP literal (no DNS needed)', () => {
    const c = classifyUrl('https://8.8.8.8/')
    expect(c.ok).toBe(true)
    expect(c.isIpLiteral).toBe(true)
  })

  it('passes a public DNS name through to the resolver stage', () => {
    const c = classifyUrl('https://example.com/webhook')
    expect(c.ok).toBe(true)
    expect(c.isIpLiteral).toBe(false)
    expect(c.hostname).toBe('example.com')
  })
})

describe('assertSafeUrl', () => {
  it('throws SsrfBlockedError for the metadata endpoint', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/')).rejects.toBeInstanceOf(SsrfBlockedError)
  })

  it('throws for a private IP literal without performing DNS', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError)
  })

  it('throws for a disallowed scheme', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toBeInstanceOf(SsrfBlockedError)
  })

  it('resolves (no throw) for a public IP literal', async () => {
    await expect(assertSafeUrl('https://8.8.8.8/')).resolves.toBeUndefined()
  })
})
