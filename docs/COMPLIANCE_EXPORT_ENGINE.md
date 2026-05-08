# Compliance Export Engine

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Overview

The Compliance Export Engine enables tenants with the `compliance_export` feature flag to request, generate, and download structured data exports. All exports are checksummed, TTL-bound, and tracked in an auditable record.

## Export Lifecycle

```
requested → pending → running → completed → (expired after 7 days)
                             └→ failed
```

1. **Request** — `requestExport()` inserts a `pending` record; feature gate checked first
2. **Run** — `markExportRunning()` transitions to `running`; background job begins data extraction
3. **Complete** — `completeExport()` stores path, record count, file size, and SHA-256 checksum
4. **Expire** — `expireStaleExports()` transitions `completed` exports past their `expires_at` to `expired`

## Feature Gate Enforcement

`requestExport()` calls `requireFeature(tenantId, 'compliance_export')` before any DB write. Tenants without the feature receive `FeatureGateError`. Route handlers translate this to HTTP 403.

## Checksum Verification

Every completed export stores a `sha256` checksum of the raw export data:

```typescript
checksum = SHA256(rawDataBuffer).hex()
```

Clients can re-verify integrity by computing SHA-256 of the downloaded file and comparing to the stored checksum. The checksum is deterministic: the same input always produces the same 64-character hex string.

## Export Formats

| Format | Use Case |
|--------|----------|
| `csv` | Spreadsheet-compatible tabular data |
| `json` | Machine-readable structured data |
| `pdf` | Human-readable reports |
| `parquet` | Analytics/data warehouse ingestion |

## Export Types

| Type | Data |
|------|------|
| `audit` | Audit log entries |
| `usage` | Billing usage records |
| `twin_state` | Digital twin state snapshots |
| `full_tenant` | Complete tenant data package |

## TTL and Expiry

Export files expire 7 days after creation (`EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000`). The `expireStaleExports()` function transitions expired `completed` exports to `expired` status. Storage cleanup is handled by the storage layer, not this service.

## RLS

`compliance_exports` is protected by Row-Level Security:

```sql
CREATE POLICY tenant_isolation ON compliance_exports
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

Tenants can only see their own export records.
