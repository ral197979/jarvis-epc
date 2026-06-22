/**
 * Denver Engineering — SP Metadata Generator
 * ─────────────────────────────────────────────
 * Generates SAML 2.0 Service Provider metadata XML for:
 *   - Import into Azure AD / Microsoft Entra ID
 *   - Import into Okta
 *   - Import into Google Workspace
 *   - Import into OneLogin
 *
 * Also parses IdP metadata XML for tenant SSO configuration.
 */

import { stripCertHeaders, SpCertificate } from './certificateRotation'

// ─── Constants ────────────────────────────────────────────────────────────────

const SAML2_NS   = 'urn:oasis:names:tc:SAML:2.0:metadata'
const MD_NS      = 'http://www.w3.org/2000/09/xmldsig#'
const POST_BINDING    = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST'
const REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect'

// ─── SP Metadata generation ───────────────────────────────────────────────────

export interface SpMetadataOptions {
  entityId:         string   // e.g. https://api.yourdomain.com/saml/metadata
  acsUrl:           string   // e.g. https://api.yourdomain.com/api/v1/auth/saml/{slug}/callback
  sloUrl?:          string   // optional Single Logout URL
  certs:            SpCertificate[]   // active SP certs (include both during rotation)
  orgName?:         string
  orgDisplayName?:  string
  technicalContact?: { name: string; email: string }
  validUntil?:      Date
}

/**
 * Generates SP metadata XML.
 * Upload this to your IdP to configure the SAML application.
 *
 * @returns XML string (UTF-8 encoded)
 */
export function generateSpMetadata(opts: SpMetadataOptions): string {
  const {
    entityId, acsUrl, sloUrl, certs,
    orgName = 'Denver Engineering',
    orgDisplayName = 'Denver Engineering Platform',
    technicalContact,
    validUntil,
  } = opts

  const validUntilAttr = validUntil
    ? ` validUntil="${validUntil.toISOString()}"`
    : ''

  const certElements = certs.map(cert => `
      <KeyDescriptor use="signing">
        <ds:KeyInfo xmlns:ds="${MD_NS}">
          <ds:X509Data>
            <ds:X509Certificate>${stripCertHeaders(cert.certPem)}</ds:X509Certificate>
          </ds:X509Data>
        </ds:KeyInfo>
      </KeyDescriptor>
      <KeyDescriptor use="encryption">
        <ds:KeyInfo xmlns:ds="${MD_NS}">
          <ds:X509Data>
            <ds:X509Certificate>${stripCertHeaders(cert.certPem)}</ds:X509Certificate>
          </ds:X509Data>
        </ds:KeyInfo>
      </KeyDescriptor>`).join('')

  const sloElement = sloUrl ? `
      <SingleLogoutService
        Binding="${REDIRECT_BINDING}"
        Location="${sloUrl}" />` : ''

  const orgElement = `
    <Organization>
      <OrganizationName xml:lang="en">${_escape(orgName)}</OrganizationName>
      <OrganizationDisplayName xml:lang="en">${_escape(orgDisplayName)}</OrganizationDisplayName>
      <OrganizationURL xml:lang="en">${_escape(entityId.replace(/\/[^/]*$/, ''))}</OrganizationURL>
    </Organization>`

  const contactElement = technicalContact ? `
    <ContactPerson contactType="technical">
      <GivenName>${_escape(technicalContact.name)}</GivenName>
      <EmailAddress>${_escape(technicalContact.email)}</EmailAddress>
    </ContactPerson>` : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor
  xmlns="${SAML2_NS}"
  entityID="${_escape(entityId)}"${validUntilAttr}>
  <SPSSODescriptor
    AuthnRequestsSigned="false"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">${certElements}${sloElement}
      <AssertionConsumerService
        Binding="${POST_BINDING}"
        Location="${_escape(acsUrl)}"
        index="1"
        isDefault="true" />
      <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
      <NameIDFormat>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</NameIDFormat>
  </SPSSODescriptor>${orgElement}${contactElement}
</EntityDescriptor>`
}

// ─── IdP Metadata parsing ─────────────────────────────────────────────────────

export interface ParsedIdpMetadata {
  entityId:       string
  ssoUrl:         string
  ssoBinding:     string
  sloUrl?:        string
  certificate:    string   // PEM body (no headers)
  certificates:   string[] // all certs (for rotation support)
  nameIdFormat?:  string
  provider?:      'azure_ad' | 'okta' | 'google' | 'onelogin' | 'custom'
}

/**
 * Parses IdP metadata XML to extract SSO URLs and signing certificates.
 * Supports metadata from: Azure AD, Okta, Google Workspace, OneLogin.
 *
 * @param xmlString - Raw metadata XML from IdP
 */
export function parseIdpMetadata(xmlString: string): ParsedIdpMetadata {
  // Simple regex-based parser — avoids xmldom/DOMParser dependency
  // Production-safe: we only extract specific, well-known elements

  const entityId = _extractAttr(xmlString, 'EntityDescriptor', 'entityID')
    || _extractAttr(xmlString, 'md:EntityDescriptor', 'entityID')
  if (!entityId) throw new Error('IdP metadata missing entityID attribute')

  // Find all SingleSignOnService elements, prefer HTTP-Redirect binding
  const ssoServices = _extractAllElements(xmlString, 'SingleSignOnService')
  const redirectSso = ssoServices.find(s => s.includes('HTTP-Redirect'))
  const postSso     = ssoServices.find(s => s.includes('HTTP-POST'))
  const ssoElement  = redirectSso ?? postSso ?? ssoServices[0]
  if (!ssoElement) throw new Error('IdP metadata missing SingleSignOnService')

  const ssoUrl     = _extractAttrFromEl(ssoElement, 'Location')
  const ssoBinding = _extractAttrFromEl(ssoElement, 'Binding') ?? REDIRECT_BINDING
  if (!ssoUrl) throw new Error('IdP metadata SingleSignOnService missing Location')

  // SLO (optional)
  const sloServices = _extractAllElements(xmlString, 'SingleLogoutService')
  const sloUrl = sloServices.length > 0
    ? _extractAttrFromEl(sloServices[0]!, 'Location') : undefined

  // Extract all X509Certificate values
  const certMatches = xmlString.match(/<(?:[A-Za-z]+:)?X509Certificate[^>]*>([\s\S]*?)<\/(?:[A-Za-z]+:)?X509Certificate>/g) ?? []
  const certificates = certMatches.map(m => {
    const inner = m.replace(/<[^>]+>/g, '').replace(/\s+/g, '')
    return inner
  }).filter(Boolean)

  if (certificates.length === 0) throw new Error('IdP metadata missing X509Certificate')

  // NameID format
  const nameIdMatch = xmlString.match(/<(?:[A-Za-z]+:)?NameIDFormat[^>]*>([\s\S]*?)<\/(?:[A-Za-z]+:)?NameIDFormat>/)
  const nameIdFormat = nameIdMatch?.[1]?.trim()

  // Auto-detect provider
  const provider = _detectProvider(entityId, xmlString)

  return {
    entityId,
    ssoUrl,
    ssoBinding,
    sloUrl: sloUrl ?? undefined,
    certificate:  certificates[0]!,
    certificates,
    nameIdFormat,
    provider,
  }
}

// ─── Provider detection ───────────────────────────────────────────────────────

function _detectProvider(entityId: string, xml: string): ParsedIdpMetadata['provider'] {
  if (entityId.includes('microsoftonline.com') || xml.includes('microsoft')) return 'azure_ad'
  if (entityId.includes('okta.com')) return 'okta'
  if (entityId.includes('google.com') || xml.includes('google')) return 'google'
  if (entityId.includes('onelogin.com')) return 'onelogin'
  return 'custom'
}

// ─── Per-IdP configuration hints ─────────────────────────────────────────────

export interface IdpSetupGuide {
  provider: string
  metadataUrl: string
  steps: string[]
  attributeMapping: Record<string, string[]>
}

export const IDP_SETUP_GUIDES: Record<string, IdpSetupGuide> = {
  azure_ad: {
    provider: 'Microsoft Azure AD / Entra ID',
    metadataUrl: 'https://login.microsoftonline.com/{tenantId}/federationmetadata/2007-06/federationmetadata.xml',
    steps: [
      '1. In Azure Portal → Azure Active Directory → Enterprise Applications → New Application',
      '2. Choose "Non-gallery application", name it "Denver Engineering"',
      '3. Go to "Single sign-on" → SAML',
      '4. Upload the SP metadata XML from /api/v1/auth/saml/{tenantSlug}/metadata',
      '5. Set the claim: user.mail → email address claim',
      '6. Assign users and groups',
      '7. Download the Azure AD Federation Metadata XML and provide the URL here',
    ],
    attributeMapping: {
      email:       ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
      displayName: ['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
      groups:      ['http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'],
    },
  },
  okta: {
    provider: 'Okta',
    metadataUrl: 'https://{domain}.okta.com/app/{appId}/sso/saml/metadata',
    steps: [
      '1. In Okta Admin Console → Applications → Create App Integration',
      '2. Choose SAML 2.0',
      '3. Set Single sign on URL: {acsUrl}',
      '4. Set Audience URI (SP Entity ID): {entityId}',
      '5. Configure attribute statements: email, displayName, groups',
      '6. Download the Okta metadata XML and provide the URL here',
    ],
    attributeMapping: {
      email:       ['email'],
      displayName: ['displayName'],
      groups:      ['groups'],
    },
  },
  google: {
    provider: 'Google Workspace',
    metadataUrl: 'https://accounts.google.com/o/saml2/idp?idpid={entityId}',
    steps: [
      '1. In Google Admin Console → Apps → Web and mobile apps → Add App → Add custom SAML app',
      '2. Download the IdP metadata XML',
      '3. Set ACS URL: {acsUrl}',
      '4. Set Entity ID: {entityId}',
      '5. Configure attribute mappings: Primary email → email, First + Last name → displayName',
      '6. Assign users to the app',
    ],
    attributeMapping: {
      email:       ['email'],
      displayName: ['name'],
      groups:      [],
    },
  },
  onelogin: {
    provider: 'OneLogin',
    metadataUrl: 'https://{domain}.onelogin.com/saml/metadata/{appId}',
    steps: [
      '1. In OneLogin Admin → Applications → Add App → search for "SAML Custom Connector"',
      '2. Configure ACS (Consumer) URL: {acsUrl}',
      '3. Configure Audience: {entityId}',
      '4. Map attributes: email, display_name, memberOf',
      '5. Save and copy the Issuer URL / metadata URL',
    ],
    attributeMapping: {
      email:       ['email'],
      displayName: ['display_name', 'name'],
      groups:      ['memberOf', 'groups'],
    },
  },
}

// ─── XML utilities ────────────────────────────────────────────────────────────

function _escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function _extractAttr(xml: string, element: string, attr: string): string | null {
  const re = new RegExp(`<${element}[^>]+${attr}="([^"]*)"`, 'i')
  return xml.match(re)?.[1] ?? null
}

function _extractAttrFromEl(element: string, attr: string): string | null {
  const re = new RegExp(`${attr}="([^"]*)"`, 'i')
  return element.match(re)?.[1] ?? null
}

function _extractAllElements(xml: string, tagName: string): string[] {
  const results: string[] = []
  const re = new RegExp(`<(?:[A-Za-z]+:)?${tagName}[^>]*/?>`, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    results.push(match[0])
  }
  return results
}
