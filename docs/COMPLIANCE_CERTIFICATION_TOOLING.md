# Compliance Certification Tooling

## Overview

The Certification Evidence Service generates immutable, auditable compliance reports for enterprise governance frameworks. Each report is SHA-256 checksummed at generation time and exported to an append-only `compliance_exports` table. Reports can be verified for integrity at any future point.

## Supported Certification Types

| Type | Description |
|---|---|
| `soc2_readiness` | SOC 2 controls evidence: audit log summary, access controls, system operations |
| `iso27001` | ISO 27001 Annex A controls coverage |
| `ai_governance` | AI usage summary, approval gates, cost tracking |
| `audit_chain` | Audit log integrity proof (record count, chain hash) |
| `tenant_isolation` | RLS enforcement, API key scoping, admin segregation proof |
| `data_retention` | Retention policies: append-only logs, 90-day export TTL |
| `security_questionnaire` | Standard security questionnaire responses |

## Generating Evidence

```typescript
const report = await generateCertificationEvidence(tenantId, 'soc2_readiness')
// Returns:
{
  certificationType: 'soc2_readiness',
  tenantId: 'T1',
  generatedAt: Date,
  evidenceSections: { control_evidence: {...}, audit_log_summary: {...} },
  checksum: '<64-char SHA-256 hex>',
}
```

The function:
1. Collects evidence via `_collectEvidence()` (type-specific queries, all via `tenantQuery`)
2. Computes checksum as `SHA-256(JSON.stringify(sections) + generatedAt.toISOString())`
3. Inserts the export record into `compliance_exports` with `status='completed'`
4. Returns the evidence result

## Integrity Verification

```typescript
verifyExportIntegrity(report): boolean
// Recomputes SHA-256 and compares to stored checksum
// Returns false if report was tampered after generation
```

This enables auditors to confirm that a report has not been modified since generation.

## Evidence Collection per Type

- **`tenant_isolation`** — pure computation, no DB queries (isolation controls are code-verified)
- **`soc2_readiness`** — queries `audit_log` with `.catch()` fallback for missing tables
- **`ai_governance`** — queries `ai_usage_records` with `.catch()` fallback
- **`audit_chain`** — queries `audit_log` for count/timestamps; computes proof hash
- **`data_retention`**, **`iso27001`**, **`security_questionnaire`** — static policy assertions

## Export Listing

```typescript
const exports = await listCertificationExports(tenantId, 'soc2_readiness')
// Returns all compliance_exports WHERE export_type LIKE 'cert_%'
// Filtered by certificationType when provided
```

Exports are stored with a 90-day TTL (`expires_at = now() + interval '90 days'`).

## Immutability Design

- `compliance_exports` is append-only; no UPDATE or DELETE operations exist
- Checksums bind the report content to its generation timestamp
- Exports are signed with the platform-level integrity key in air-gap mode

## Related Services

- `federatedIntelligenceEngine` — federated audit records contribute to compliance evidence
- `airGapModeService` — compliance exports are critical for air-gapped certifications
- `edgeNodeService` — edge audit buffers feed the `audit_chain` evidence type
