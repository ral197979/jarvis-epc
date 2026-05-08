// Denver Engineering — Air-Gap Mode Service (v9.0.0)
// Offline-safe: license verification, local-only AI routing, cloud isolation.
// No required external network calls in air-gap mode.

import { createHash, createHmac } from 'crypto'
import { tenantQuery } from '../../db/pool'
import { AirGapLicense } from './ecosystemTypes'

// ─── License management ───────────────────────────────────────────────────────

const LICENSE_SIGNING_KEY = process.env['AIR_GAP_LICENSE_KEY'] ?? 'ava-airgap-dev-key'

export interface IssueLicenseInput {
  tenantId: string
  tier: string
  seatLimit: number
  featureSet: string[]
  validDays: number
}

export interface LicenseFilePayload {
  licenseKeyHash: string
  tier: string
  seatLimit: number
  featureSet: string[]
  validFrom: string
  validUntil: string
  tenantId: string
  signature: string
}

export function issueLicense(input: IssueLicenseInput): LicenseFilePayload {
  const validFrom = new Date()
  const validUntil = new Date(Date.now() + input.validDays * 24 * 60 * 60 * 1000)
  const raw = `${input.tenantId}:${input.tier}:${input.seatLimit}:${validFrom.toISOString()}`
  const licenseKeyHash = createHash('sha256').update(raw).digest('hex')
  const signature = createHmac('sha256', LICENSE_SIGNING_KEY)
    .update(licenseKeyHash + validUntil.toISOString())
    .digest('hex')

  return {
    licenseKeyHash,
    tier: input.tier,
    seatLimit: input.seatLimit,
    featureSet: input.featureSet,
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    tenantId: input.tenantId,
    signature,
  }
}

export async function activateLicense(
  tenantId: string,
  licensePayload: LicenseFilePayload,
): Promise<AirGapLicense> {
  // Verify signature before storing
  if (!verifyLicenseSignature(licensePayload)) {
    throw new Error('Invalid license signature — license file may be tampered')
  }

  const res = await tenantQuery(
    tenantId,
    `INSERT INTO air_gap_licenses
      (tenant_id, license_key_hash, tier, seat_limit, feature_set,
       valid_from, valid_until, issued_by, signature)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'ava',$8)
     ON CONFLICT (license_key_hash) DO UPDATE SET is_active = TRUE
     RETURNING *`,
    [
      tenantId, licensePayload.licenseKeyHash, licensePayload.tier,
      licensePayload.seatLimit, licensePayload.featureSet,
      licensePayload.validFrom, licensePayload.validUntil, licensePayload.signature,
    ],
  )
  return _mapLicense(res.rows[0])
}

export async function getActiveLicense(tenantId: string): Promise<AirGapLicense | null> {
  const res = await tenantQuery(
    tenantId,
    `SELECT * FROM air_gap_licenses
     WHERE tenant_id = $1 AND is_active = TRUE AND valid_until > now()
     ORDER BY valid_until DESC LIMIT 1`,
    [tenantId],
  )
  return res.rows.length > 0 ? _mapLicense(res.rows[0]) : null
}

export async function revokeLicense(tenantId: string, licenseId: string): Promise<void> {
  await tenantQuery(
    tenantId,
    `UPDATE air_gap_licenses SET is_active = FALSE WHERE id = $1 AND tenant_id = $2`,
    [licenseId, tenantId],
  )
}

// ─── License verification ─────────────────────────────────────────────────────

export function verifyLicenseSignature(payload: LicenseFilePayload): boolean {
  const expected = createHmac('sha256', LICENSE_SIGNING_KEY)
    .update(payload.licenseKeyHash + payload.validUntil)
    .digest('hex')
  return expected === payload.signature
}

export function isLicenseExpired(license: AirGapLicense): boolean {
  return license.validUntil < new Date()
}

export function isFeatureIncluded(license: AirGapLicense, featureKey: string): boolean {
  return license.featureSet.includes(featureKey) || license.featureSet.includes('*')
}

// ─── Air-gap mode status ──────────────────────────────────────────────────────

export interface AirGapStatus {
  enabled: boolean
  cloudIntegrationsDisabled: boolean
  localAiProvider: string | null
  offlineUpdatesOnly: boolean
  licenseValid: boolean
}

export function getAirGapStatus(license: AirGapLicense | null): AirGapStatus {
  return {
    enabled: license != null && !isLicenseExpired(license),
    cloudIntegrationsDisabled: true,  // always in air-gap mode
    localAiProvider: process.env['LOCAL_AI_PROVIDER'] ?? null,
    offlineUpdatesOnly: true,
    licenseValid: license != null && !isLicenseExpired(license),
  }
}

// ─── Local AI provider routing ────────────────────────────────────────────────

export type AiProviderMode = 'cloud' | 'local' | 'none'

export function resolveAiProvider(
  airGapEnabled: boolean,
  localProvider: string | null,
): AiProviderMode {
  if (!airGapEnabled) return 'cloud'
  if (localProvider != null) return 'local'
  return 'none'
}

// ─── Package import/export ────────────────────────────────────────────────────

export interface PackageManifest {
  packageId: string
  packageType: 'playbook' | 'plugin' | 'model' | 'update'
  version: string
  checksum: string
  contents: Record<string, unknown>
  signedAt: string
  signature: string
}

export function createPackage(
  packageType: PackageManifest['packageType'],
  version: string,
  contents: Record<string, unknown>,
): PackageManifest {
  const contentStr = JSON.stringify(contents)
  const checksum = createHash('sha256').update(contentStr).digest('hex')
  const packageId = createHash('sha256').update(`${packageType}:${version}:${checksum}`).digest('hex').slice(0, 16)
  const signedAt = new Date().toISOString()
  const signature = createHmac('sha256', LICENSE_SIGNING_KEY)
    .update(packageId + checksum + signedAt)
    .digest('hex')

  return { packageId, packageType, version, checksum, contents, signedAt, signature }
}

export function verifyPackage(pkg: PackageManifest): boolean {
  const expectedChecksum = createHash('sha256')
    .update(JSON.stringify(pkg.contents))
    .digest('hex')
  if (expectedChecksum !== pkg.checksum) return false

  const expectedSig = createHmac('sha256', LICENSE_SIGNING_KEY)
    .update(pkg.packageId + pkg.checksum + pkg.signedAt)
    .digest('hex')
  return expectedSig === pkg.signature
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

function _mapLicense(row: Record<string, unknown>): AirGapLicense {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    licenseKeyHash: row['license_key_hash'] as string,
    tier: row['tier'] as string,
    seatLimit: Number(row['seat_limit']),
    featureSet: (row['feature_set'] as string[]) ?? [],
    validFrom: new Date(row['valid_from'] as string),
    validUntil: new Date(row['valid_until'] as string),
    issuedBy: row['issued_by'] as string,
    signature: row['signature'] as string,
    isActive: Boolean(row['is_active']),
    createdAt: new Date(row['created_at'] as string),
  }
}

export const __testHooks = {
  issueLicense, verifyLicenseSignature, isLicenseExpired, isFeatureIncluded,
  resolveAiProvider, createPackage, verifyPackage, _mapLicense,
}
