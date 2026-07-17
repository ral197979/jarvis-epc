/**
 * infra/fly-staging-readiness — release-identity regression.
 * /api/v1/health must surface the deployed Git SHA when APP_RELEASE_SHA is
 * set at deploy time, and must not crash or fabricate a value when it isn't
 * (e.g. local dev, or any test suite that never sets it).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { getReleaseIdentity } from '../services/releaseIdentity'

describe('getReleaseIdentity', () => {
  const ORIGINAL = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  it('returns null releaseSha when APP_RELEASE_SHA is unset (local dev default)', () => {
    delete process.env['APP_RELEASE_SHA']
    expect(getReleaseIdentity().releaseSha).toBeNull()
  })

  it('surfaces the exact configured commit SHA', () => {
    process.env['APP_RELEASE_SHA'] = 'eda53c921685316afe758ff7ba474e858bc9d343'
    expect(getReleaseIdentity().releaseSha).toBe('eda53c921685316afe758ff7ba474e858bc9d343')
  })

  it('never fabricates a SHA — an empty string is not coerced into a placeholder', () => {
    process.env['APP_RELEASE_SHA'] = ''
    // '' is falsy but explicitly set — ?? preserves it rather than substituting null,
    // so a deploy that accidentally passes an empty value is visible, not hidden.
    expect(getReleaseIdentity().releaseSha).toBe('')
  })

  it('reports env from APP_ENV when set, falling back to NODE_ENV, then null', () => {
    process.env['APP_ENV'] = 'staging'
    process.env['NODE_ENV'] = 'production'
    expect(getReleaseIdentity().env).toBe('staging')

    delete process.env['APP_ENV']
    expect(getReleaseIdentity().env).toBe('production')

    delete process.env['NODE_ENV']
    expect(getReleaseIdentity().env).toBeNull()
  })
})
