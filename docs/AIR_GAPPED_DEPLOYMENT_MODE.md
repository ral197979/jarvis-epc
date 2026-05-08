# Air-Gapped Deployment Mode

## Overview

Air-gap mode enables Ava to operate in environments with no external network connectivity — isolated government networks, classified data centers, or high-security enterprise environments. A signed license file authorizes the deployment; all cloud integrations are disabled; AI inference routes to a local provider.

## License Issuance

Licenses are issued offline by Ava's platform team and delivered as JSON files:

```typescript
const payload = issueLicense({
  tenantId: 'gov-agency-001',
  tier: 'enterprise',
  seatLimit: 500,
  featureSet: ['compliance', 'ai_governance', 'edge_nodes'],
  validDays: 365,
})
// payload is a LicenseFilePayload — signed with HMAC-SHA256
```

The `LicenseFilePayload` contains:
```typescript
{
  licenseKeyHash: string,   // SHA-256 of (tenantId:tier:seatLimit:validFrom)
  tier: string,
  seatLimit: number,
  featureSet: string[],
  validFrom: string,        // ISO 8601
  validUntil: string,       // ISO 8601
  tenantId: string,
  signature: string,        // HMAC-SHA256(licenseKeyHash + validUntil)
}
```

## Signature Verification

```typescript
verifyLicenseSignature(payload): boolean
// Recomputes HMAC-SHA256(licenseKeyHash + validUntil) and compares to signature
```

Tampering `licenseKeyHash` or `validUntil` causes verification to fail. This prevents offline license extension attacks.

## License Checks

```typescript
isLicenseExpired(license): boolean
// Returns true when license.validUntil < new Date()

isFeatureIncluded(license, 'ai_governance'): boolean
// Returns true when featureSet includes the feature key or '*'
```

## Air-Gap Status

```typescript
getAirGapStatus(license: AirGapLicense | null): AirGapStatus
// Returns:
{
  enabled: boolean,                 // license present and not expired
  cloudIntegrationsDisabled: true,  // always true in air-gap mode
  localAiProvider: string | null,   // from LOCAL_AI_PROVIDER env var
  offlineUpdatesOnly: true,
  licenseValid: boolean,
}
```

## AI Provider Routing

```typescript
resolveAiProvider(airGapEnabled, localProvider): 'cloud' | 'local' | 'none'
// Not air-gapped → 'cloud'
// Air-gapped + provider set → 'local'
// Air-gapped + no provider → 'none'
```

## Package Import/Export

Software updates, model weights, and plugin bundles are distributed as signed packages:

```typescript
const pkg = createPackage('model_update', '2.1.0', { weights: '...' })
// Returns PackageManifest with checksum and signature

verifyPackage(pkg): boolean
// Recomputes SHA-256(contents) and HMAC signature
// Returns false if either doesn't match — indicating tampering
```

## Configuration

```env
AIR_GAP_LICENSE_KEY=<32-byte-hex>   # HMAC signing key (must match issuance key)
LOCAL_AI_PROVIDER=ollama             # Local inference provider URL or name
```

## Related Services

- `certificationEvidenceService` — generates compliance evidence for air-gapped deployments
- `edgeNodeService` — edge nodes commonly operate in air-gapped environments
- `workflowComposerService` — workflows must not make external calls in air-gap mode
