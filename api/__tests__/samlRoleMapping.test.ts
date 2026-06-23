/**
 * SAML Role Mapping + Metadata — Unit Tests
 * ──────────────────────────────────────────
 * Pure unit tests: no DB, no network, no subprocess.
 * Tests roleMapping.ts and samlMetadata.ts in isolation.
 *
 * Coverage:
 *   isValidRole        — type guard for PlatformRole
 *   deriveRole         — priority: direct claim → mapping → heuristics → default
 *   extractAttributes  — Azure AD URNs, Okta short names, groups array
 *   validateRequired   — missing/invalid email throws
 *   generateSpMetadata — XML structure, cert elements, SLO
 *   parseIdpMetadata   — Azure AD, Okta, missing fields
 */

import { describe, it, expect, vi } from 'vitest'

// certificateRotation.ts (transitively imported by samlMetadata.ts) touches DB
// and slog at module load. Mock both before importing.
vi.mock('../db/pool', () => ({
  query:             vi.fn(),
  tenantQuery:       vi.fn(),
  tenantTransaction: vi.fn(),
}))

vi.mock('../../src/modules/observability/index', () => {
  const slog: any = vi.fn()
  slog.info  = vi.fn()
  slog.warn  = vi.fn()
  slog.error = vi.fn()
  return { slog }
})

import {
  deriveRole, extractAttributes, validateRequiredClaims, isValidRole,
} from '../auth/saml/roleMapping'
import { generateSpMetadata, parseIdpMetadata } from '../auth/saml/samlMetadata'
import type { SpCertificate } from '../auth/saml/certificateRotation'

// ─── Shared test cert ─────────────────────────────────────────────────────────

const MOCK_CERT: SpCertificate = {
  certPem: [
    '-----BEGIN CERTIFICATE-----',
    'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1234567890abcdef',
    'AQAB',
    '-----END CERTIFICATE-----',
  ].join('\n'),
  keyPem:      '-----BEGIN PRIVATE KEY-----\nMockKey\n-----END PRIVATE KEY-----',
  fingerprint: 'abc123def456',
  expiresAt:   new Date('2030-01-01'),
  label:       'primary',
}

const SP_OPTS = {
  entityId: 'https://api.example.com/saml/acme',
  acsUrl:   'https://api.example.com/api/v1/auth/saml/acme/callback',
  certs:    [MOCK_CERT],
}

// ─── Azure AD metadata fixture ────────────────────────────────────────────────

const AZURE_AD_METADATA = `<?xml version="1.0" encoding="utf-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="https://sts.windows.net/tenant-abc-123/">
  <IDPSSODescriptor>
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#">
        <X509Data>
          <X509Certificate>MIIBazureADCertificateBodyHere</X509Certificate>
        </X509Data>
      </KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="https://login.microsoftonline.com/tenant-abc-123/saml2" />
    <SingleLogoutService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="https://login.microsoftonline.com/tenant-abc-123/saml2/logout" />
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
  </IDPSSODescriptor>
</EntityDescriptor>`

// ─── Okta metadata fixture ────────────────────────────────────────────────────

const OKTA_METADATA = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="http://www.okta.com/exk9876543abcdef">
  <md:IDPSSODescriptor>
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>MIIBoktaCertificateBodyHere</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="https://company.okta.com/app/denver/exk9876/sso/saml" />
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`

// ══════════════════════════════════════════════════════════════════════════════
// isValidRole
// ══════════════════════════════════════════════════════════════════════════════

describe('isValidRole', () => {
  it('accepts all five valid platform roles', () => {
    expect(isValidRole('owner')).toBe(true)
    expect(isValidRole('admin')).toBe(true)
    expect(isValidRole('project_manager')).toBe(true)
    expect(isValidRole('engineer')).toBe(true)
    expect(isValidRole('viewer')).toBe(true)
  })

  it('rejects unknown role strings', () => {
    expect(isValidRole('superuser')).toBe(false)
    expect(isValidRole('manager')).toBe(false)
    expect(isValidRole('')).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(isValidRole(undefined)).toBe(false)
    expect(isValidRole(null)).toBe(false)
    expect(isValidRole(42)).toBe(false)
    expect(isValidRole({})).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// deriveRole
// ══════════════════════════════════════════════════════════════════════════════

describe('deriveRole — direct role claim (priority 1)', () => {
  it('uses direct role claim when it is a valid platform role', () => {
    expect(deriveRole({ email: 'a@b.com', role: 'admin' }, {})).toBe('admin')
    expect(deriveRole({ email: 'a@b.com', role: 'project_manager' }, {})).toBe('project_manager')
    expect(deriveRole({ email: 'a@b.com', role: 'owner' }, {})).toBe('owner')
  })

  it('ignores invalid direct role claim and falls through to default', () => {
    const result = deriveRole({ email: 'a@b.com', role: 'superuser', groups: [] }, {})
    expect(result).toBe('viewer')
  })

  it('ignores direct claim over group mapping (direct wins)', () => {
    // direct role = 'engineer', explicit mapping would give 'admin'
    const mapping = { 'Admins': 'admin' }
    const result  = deriveRole({ email: 'a@b.com', role: 'engineer', groups: ['Admins'] }, mapping)
    expect(result).toBe('engineer')
  })
})

describe('deriveRole — explicit role_mapping (priority 2)', () => {
  it('maps exact group name to platform role', () => {
    const mapping = { 'Denver-PM-Group': 'project_manager' }
    expect(deriveRole({ email: 'a@b.com', groups: ['Denver-PM-Group'] }, mapping)).toBe('project_manager')
  })

  it('uses first matching group when multiple groups match', () => {
    const mapping = { 'GroupA': 'engineer', 'GroupB': 'admin' }
    expect(deriveRole({ email: 'a@b.com', groups: ['GroupA', 'GroupB'] }, mapping)).toBe('engineer')
  })

  it('maps to viewer explicitly', () => {
    const mapping = { 'ReadOnly': 'viewer' }
    expect(deriveRole({ email: 'a@b.com', groups: ['ReadOnly'] }, mapping)).toBe('viewer')
  })

  it('skips mappings pointing to invalid role values', () => {
    const mapping = { 'BadGroup': 'not-a-real-role' }
    const result  = deriveRole({ email: 'a@b.com', groups: ['BadGroup'] }, mapping)
    expect(result).toBe('viewer') // falls through to default
  })
})

describe('deriveRole — partial match role_mapping (priority 3)', () => {
  it('matches group name containing key (case-insensitive)', () => {
    const mapping = { 'manager': 'project_manager' }
    expect(deriveRole({ email: 'a@b.com', groups: ['Senior-Manager-Team'] }, mapping)).toBe('project_manager')
  })

  it('is case-insensitive on both sides', () => {
    const mapping = { 'ADMIN': 'admin' }
    expect(deriveRole({ email: 'a@b.com', groups: ['Denver-admin-group'] }, mapping)).toBe('admin')
  })
})

describe('deriveRole — built-in heuristics (priority 4)', () => {
  // Group names must hit word boundaries in the regexes.
  // "sysadmin" hits sys.?admin, "sys-admin" also hits (. matches -).
  // "ProjectManagers" fails \bproject.?manager\b because trailing 's' breaks boundary;
  // "project-manager" (whole word) passes. Same for "developer" vs "developers".
  it.each([
    ['sys-admin',        'admin'          ],  // \bsys.?admin\b — '-' matched by .?
    ['sysadmin',         'admin'          ],  // \bsys.?admin\b — .? = nothing
    ['project-manager',  'project_manager'],  // \bproject.?manager?\b
    ['Denver-PM',        'project_manager'],  // \bpm\b — word boundary before/after PM
    ['technical-lead',   'engineer'       ],  // \btechnical\b — '-' creates boundary
    ['developer',        'engineer'       ],  // \bdeveloper\b — exact word
    ['ReadOnly-Users',   'viewer'         ],  // \bread.?only\b — .? = nothing between words
    ['observer',         'viewer'         ],  // \bobserver\b — exact word
  ])('group "%s" → role "%s"', (group, expected) => {
    expect(deriveRole({ email: 'a@b.com', groups: [group] }, {})).toBe(expected)
  })

  it('detects owner from billing group name', () => {
    // 'billing-owners': \bbilling\b matches because '-' creates word boundary after 'g'
    expect(deriveRole({ email: 'a@b.com', groups: ['billing-owners'] }, {})).toBe('owner')
    expect(deriveRole({ email: 'a@b.com', groups: ['account-owner'] }, {})).toBe('owner')
  })

  it('prefers highest-privilege when multiple groups match different roles', () => {
    // admin (index 1) beats engineer (index 4) and project_manager (index 2)
    const result = deriveRole({ email: 'a@b.com', groups: ['project-manager', 'admin-group'] }, {})
    expect(result).toBe('admin')
  })
})

describe('deriveRole — default role (priority 5)', () => {
  it('returns "viewer" when no match and no default provided', () => {
    expect(deriveRole({ email: 'a@b.com', groups: [] }, {})).toBe('viewer')
  })

  it('uses custom defaultRole', () => {
    expect(deriveRole({ email: 'a@b.com', groups: [] }, {}, 'engineer')).toBe('engineer')
  })

  it('falls back to "viewer" when defaultRole is invalid', () => {
    expect(deriveRole({ email: 'a@b.com', groups: [] }, {}, 'bogus' as any)).toBe('viewer')
  })

  it('works with no groups field at all', () => {
    expect(deriveRole({ email: 'a@b.com' }, {})).toBe('viewer')
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// extractAttributes
// ══════════════════════════════════════════════════════════════════════════════

describe('extractAttributes — email', () => {
  it('extracts from short "email" attribute name', () => {
    const attrs = extractAttributes({ email: 'user@example.com' }, {})
    expect(attrs.email).toBe('user@example.com')
  })

  it('extracts from Azure AD emailaddress URN', () => {
    const urn   = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'
    const attrs = extractAttributes({ [urn]: 'corp@contoso.com' }, {})
    expect(attrs.email).toBe('corp@contoso.com')
  })

  it('extracts from Azure AD UPN claim', () => {
    const urn   = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn'
    const attrs = extractAttributes({ [urn]: 'user@contoso.com' }, {})
    expect(attrs.email).toBe('user@contoso.com')
  })

  it('extracts from custom mapping (overrides defaults)', () => {
    const attrs = extractAttributes(
      { custom_email_field: 'user@example.com' },
      { email: ['custom_email_field'] },
    )
    expect(attrs.email).toBe('user@example.com')
  })

  it('returns undefined when no email attribute found', () => {
    const attrs = extractAttributes({ unknown_attr: 'value' }, {})
    expect(attrs.email).toBeUndefined()
  })
})

describe('extractAttributes — displayName', () => {
  it('extracts from "displayName" attribute', () => {
    const attrs = extractAttributes({ displayName: 'Jane Doe' }, {})
    expect(attrs.displayName).toBe('Jane Doe')
  })

  it('extracts from Azure AD name URN', () => {
    const urn   = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
    const attrs = extractAttributes({ [urn]: 'John Smith' }, {})
    expect(attrs.displayName).toBe('John Smith')
  })
})

describe('extractAttributes — groups', () => {
  it('extracts groups array as-is', () => {
    const attrs = extractAttributes({ groups: ['GroupA', 'GroupB'] }, {})
    expect(attrs.groups).toEqual(['GroupA', 'GroupB'])
  })

  it('wraps single string group value in array', () => {
    const attrs = extractAttributes({ groups: 'OnlyGroup' }, {})
    expect(attrs.groups).toEqual(['OnlyGroup'])
  })

  it('extracts from Azure AD groups URN', () => {
    const urn   = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'
    const attrs = extractAttributes({ [urn]: ['G1', 'G2'] }, {})
    expect(attrs.groups).toEqual(['G1', 'G2'])
  })

  it('extracts from "memberOf" (Okta default)', () => {
    const attrs = extractAttributes({ memberOf: ['CN=Admins,OU=Groups'] }, {})
    expect(attrs.groups).toEqual(['CN=Admins,OU=Groups'])
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// validateRequiredClaims
// ══════════════════════════════════════════════════════════════════════════════

describe('validateRequiredClaims', () => {
  it('passes for a valid email', () => {
    expect(() => validateRequiredClaims({ email: 'user@example.com' })).not.toThrow()
    expect(() => validateRequiredClaims({ email: 'user+tag@sub.example.co.uk' })).not.toThrow()
  })

  it('throws when email is missing', () => {
    expect(() => validateRequiredClaims({})).toThrow(/missing email claim/i)
    expect(() => validateRequiredClaims({ displayName: 'Jane' })).toThrow(/missing email claim/i)
  })

  it('throws when email has invalid format', () => {
    expect(() => validateRequiredClaims({ email: 'not-an-email' })).toThrow(/invalid email format/i)
    expect(() => validateRequiredClaims({ email: '@nodomain' })).toThrow()
    expect(() => validateRequiredClaims({ email: 'user@' })).toThrow()
    expect(() => validateRequiredClaims({ email: 'user@domain' })).toThrow()
  })

  it('includes the bad email value in the error message', () => {
    try {
      validateRequiredClaims({ email: 'bad-value' })
    } catch (err) {
      expect(String(err)).toContain('bad-value')
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// generateSpMetadata
// ══════════════════════════════════════════════════════════════════════════════

describe('generateSpMetadata', () => {
  it('produces well-formed XML declaration', () => {
    const xml = generateSpMetadata(SP_OPTS)
    expect(xml).toMatch(/^<\?xml version="1\.0"/)
  })

  it('embeds entityID in EntityDescriptor', () => {
    const xml = generateSpMetadata(SP_OPTS)
    expect(xml).toContain('entityID="https://api.example.com/saml/acme"')
  })

  it('includes AssertionConsumerService with ACS URL', () => {
    const xml = generateSpMetadata(SP_OPTS)
    expect(xml).toContain('AssertionConsumerService')
    expect(xml).toContain('https://api.example.com/api/v1/auth/saml/acme/callback')
  })

  it('includes both signing and encryption KeyDescriptors', () => {
    const xml = generateSpMetadata(SP_OPTS)
    expect(xml).toContain('use="signing"')
    expect(xml).toContain('use="encryption"')
  })

  it('strips PEM headers from cert (X509Certificate contains only base64)', () => {
    const xml = generateSpMetadata(SP_OPTS)
    expect(xml).toContain('X509Certificate')
    expect(xml).not.toContain('-----BEGIN CERTIFICATE-----')
  })

  it('includes NameIDFormat for email', () => {
    const xml = generateSpMetadata(SP_OPTS)
    expect(xml).toContain('NameIDFormat')
    expect(xml).toContain('emailAddress')
  })

  it('omits SingleLogoutService when sloUrl not provided', () => {
    const xml = generateSpMetadata(SP_OPTS)
    expect(xml).not.toContain('SingleLogoutService')
  })

  it('includes SingleLogoutService when sloUrl is provided', () => {
    const xml = generateSpMetadata({ ...SP_OPTS, sloUrl: 'https://api.example.com/saml/slo' })
    expect(xml).toContain('SingleLogoutService')
    expect(xml).toContain('https://api.example.com/saml/slo')
  })

  it('includes validUntil attribute when provided', () => {
    const validUntil = new Date('2030-06-01T00:00:00Z')
    const xml = generateSpMetadata({ ...SP_OPTS, validUntil })
    expect(xml).toContain('validUntil')
    expect(xml).toContain('2030-06-01')
  })

  it('includes ContactPerson when technicalContact is provided', () => {
    const xml = generateSpMetadata({
      ...SP_OPTS,
      technicalContact: { name: 'Ops Team', email: 'ops@example.com' },
    })
    expect(xml).toContain('ContactPerson')
    expect(xml).toContain('ops@example.com')
  })

  it('includes both certs during key rotation (two certs passed)', () => {
    const secondCert: SpCertificate = { ...MOCK_CERT, label: 'secondary', fingerprint: 'zzz' }
    const xml = generateSpMetadata({ ...SP_OPTS, certs: [MOCK_CERT, secondCert] })
    // Should have four KeyDescriptor blocks (signing + encryption for each cert)
    const count = (xml.match(/KeyDescriptor/g) ?? []).length
    expect(count).toBe(8) // 4 opening + 4 closing tags
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// parseIdpMetadata
// ══════════════════════════════════════════════════════════════════════════════

describe('parseIdpMetadata — Azure AD', () => {
  it('extracts entityId', () => {
    const result = parseIdpMetadata(AZURE_AD_METADATA)
    expect(result.entityId).toBe('https://sts.windows.net/tenant-abc-123/')
  })

  it('prefers HTTP-Redirect SSO binding', () => {
    const result = parseIdpMetadata(AZURE_AD_METADATA)
    expect(result.ssoUrl).toBe('https://login.microsoftonline.com/tenant-abc-123/saml2')
  })

  it('extracts SLO URL', () => {
    const result = parseIdpMetadata(AZURE_AD_METADATA)
    expect(result.sloUrl).toBe('https://login.microsoftonline.com/tenant-abc-123/saml2/logout')
  })

  it('extracts X509Certificate (stripped of whitespace)', () => {
    const result = parseIdpMetadata(AZURE_AD_METADATA)
    expect(result.certificate).toBe('MIIBazureADCertificateBodyHere')
    expect(result.certificates).toHaveLength(1)
  })

  it('extracts NameIDFormat', () => {
    const result = parseIdpMetadata(AZURE_AD_METADATA)
    expect(result.nameIdFormat).toContain('emailAddress')
  })

  it('auto-detects provider as azure_ad from entityID', () => {
    const result = parseIdpMetadata(AZURE_AD_METADATA)
    expect(result.provider).toBe('azure_ad')
  })
})

describe('parseIdpMetadata — Okta', () => {
  it('parses Okta metadata with md: namespace prefix', () => {
    const result = parseIdpMetadata(OKTA_METADATA)
    expect(result.entityId).toBe('http://www.okta.com/exk9876543abcdef')
  })

  it('extracts SSO URL from HTTP-POST binding when redirect not present', () => {
    const result = parseIdpMetadata(OKTA_METADATA)
    expect(result.ssoUrl).toBe('https://company.okta.com/app/denver/exk9876/sso/saml')
  })

  it('sloUrl is undefined when not in metadata', () => {
    const result = parseIdpMetadata(OKTA_METADATA)
    expect(result.sloUrl).toBeUndefined()
  })

  it('extracts certificate with ds: namespace prefix', () => {
    const result = parseIdpMetadata(OKTA_METADATA)
    expect(result.certificate).toBe('MIIBoktaCertificateBodyHere')
  })

  it('auto-detects provider as okta', () => {
    const result = parseIdpMetadata(OKTA_METADATA)
    expect(result.provider).toBe('okta')
  })
})

describe('parseIdpMetadata — error handling', () => {
  it('throws when entityID attribute is missing', () => {
    const xml = `<EntityDescriptor><IDPSSODescriptor/></EntityDescriptor>`
    expect(() => parseIdpMetadata(xml)).toThrow(/entityID/)
  })

  it('throws when SingleSignOnService is absent', () => {
    const xml = `<EntityDescriptor entityID="https://example.com">
      <IDPSSODescriptor>
        <X509Certificate>somecert</X509Certificate>
      </IDPSSODescriptor>
    </EntityDescriptor>`
    expect(() => parseIdpMetadata(xml)).toThrow(/SingleSignOnService/)
  })

  it('throws when X509Certificate is absent', () => {
    const xml = `<EntityDescriptor entityID="https://example.com">
      <IDPSSODescriptor>
        <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
          Location="https://sso.example.com/saml" />
      </IDPSSODescriptor>
    </EntityDescriptor>`
    expect(() => parseIdpMetadata(xml)).toThrow(/X509Certificate/)
  })
})
