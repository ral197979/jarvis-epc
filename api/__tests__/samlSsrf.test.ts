/**
 * AUDIT-P0-07 regression — SAML IdP metadata import must reject
 * SSRF-targeted URLs (cloud metadata / internal addresses) before ever
 * issuing a fetch, matching the guard already applied to webhook dispatch
 * (api/routes/integrations.ts) and the MCP http_fetch tool (api/routes/mcp.ts).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/pool', () => ({
  query: vi.fn().mockRejectedValue(new Error('query() must not be called when the URL is blocked')),
}))

import { importIdpMetadataFromUrl } from '../auth/saml/samlProvider'
import { SsrfBlockedError } from '../lib/ssrfGuard'

describe('importIdpMetadataFromUrl — SSRF guard', () => {
  it('rejects the cloud metadata address before fetching or touching the DB', async () => {
    await expect(
      importIdpMetadataFromUrl('tenant-1', 'http://169.254.169.254/latest/meta-data/iam/security-credentials/'),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it('rejects a private-network target', async () => {
    await expect(
      importIdpMetadataFromUrl('tenant-1', 'http://10.0.0.5/idp-metadata.xml'),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it('rejects localhost', async () => {
    await expect(
      importIdpMetadataFromUrl('tenant-1', 'http://localhost:6379/idp-metadata.xml'),
    ).rejects.toThrow(SsrfBlockedError)
  })

  it('rejects non-http(s) schemes', async () => {
    await expect(
      importIdpMetadataFromUrl('tenant-1', 'file:///etc/passwd'),
    ).rejects.toThrow(SsrfBlockedError)
  })
})
