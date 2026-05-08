# Migration and Import Guide — Phase 11

**Denver Engineering · GA Operations**
**Version:** 11.0.0

---

## Overview

This guide covers the full data migration and import lifecycle: schema mapping, validation, dry runs, production imports, and replay-safe audit trail management.

---

## Import Pipeline Architecture

```
Source Data
    ↓
Schema Mapping (schemaMappingEngine)
    ↓
Row Validation (migrationValidationService)
    ↓
Dry Run (importPipeline, dryRun: true)
    ↓
Migration Safety Check (migrationSafetyValidator)
    ↓
Production Import (importPipeline, dryRun: false)
    ↓
Replay Safety Ledger (replaySafeImportService)
    ↓
Validation Summary (stored per job)
```

---

## Batch Limits

| Constraint | Value |
|---|---|
| Max rows per batch | 5,000 (`IMPORT_MAX_BATCH_SIZE`) |
| Max job row count | 500,000 |
| Min valid job row count | 1 |
| Batch count formula | `ceil(rowCount / 5000)` |

Example: 12,500 rows → 3 batches (5000 + 5000 + 2500)

---

## Schema Mapping

### Defining Mapping Rules

```typescript
import { validateMappingRules, applyMappingToRow } from '../services/phase11/schemaMappingEngine'

const rules: SchemaMappingRule[] = [
  {
    sourceField: 'FIRST_NAME',
    targetField: 'firstName',
    transformation: 'to_lowercase',
    required: true,
  },
  {
    sourceField: 'ACCOUNT_BALANCE',
    targetField: 'balance',
    transformation: 'to_number',
    required: true,
  },
  {
    sourceField: 'SIGNUP_DATE',
    targetField: 'createdAt',
    transformation: 'to_date',
    required: false,
    defaultValue: new Date().toISOString(),
  },
]
```

### Supported Transformations

| Transformation | Behavior |
|---|---|
| `to_uppercase` | `.toUpperCase()` |
| `to_lowercase` | `.toLowerCase()` |
| `to_number` | `parseFloat()` |
| `to_boolean` | `'true'`/`'1'`/`'yes'` → `true`, else `false` |
| `trim` | `.trim()` |
| `to_date` | `new Date(value)` |
| `none` / omitted | No transformation, pass through |

### Handling Missing Fields

- Missing + `required: true` + no `defaultValue` → mapping error (row rejected)
- Missing + `required: true` + `defaultValue` set → use default value
- Missing + `required: false` → field omitted from output

---

## Row Validation

`migrationValidationService.validateRow` runs three checks per row:

```typescript
// 1. Required fields: missing, null, or empty string → error
// 2. Numeric fields: NaN after parseFloat → error
// 3. Date fields: Invalid Date after new Date() → error
```

Validation summary:
```typescript
interface ValidationSummary {
  jobId: string
  totalRows: number
  validRows: number
  invalidRows: number
  errorBreakdown: Record<string, number>  // field → errorCount
}
```

`isValidationPassed`: `invalidRows === 0`
`computeValidationPassRate`: `validRows / totalRows`

---

## Migration Safety Checks

Run `migrationSafetyValidator` before every production import:

| Check | What It Verifies |
|---|---|
| `checkNoLongRunningTransactions` | No DB transactions running > 30 seconds |
| `checkReplayIntegrityBeforeMigration` | No open replay divergence incidents |
| `checkDiskSpaceAvailable` | Sufficient disk space for import payload |
| `checkNoOrphanedForeignKeys` | No referential integrity violations in existing data |

`isMigrationSafe` requires: `safeToApply === true` AND `blockers.length === 0`

If any check fails, abort the import and resolve the blocker before proceeding.

---

## Dry Run

Always run with `dryRun: true` first:

```typescript
import { createImportJob, processImportBatch } from '../services/phase11/importPipeline'

// Step 1: Create job in dry_run mode
const job = await createImportJob({
  tenantId: 'tenant-123',
  sourceSystem: 'Salesforce',
  rowCount: 25000,
  dryRun: true,
})

// Step 2: Process all batches
for (let i = 0; i < job.batchCount; i++) {
  await processImportBatch(job.id, i, rows[i])
}

// Step 3: Check results
// isImportSuccessful: status='complete' AND failedRows=0
// canRollback: false (dry_run=true blocks rollback)
```

A dry run processes all validation and mapping logic but writes no data to production tables.

---

## Production Import

After dry run succeeds:

```typescript
// Step 1: Create production job
const job = await createImportJob({
  tenantId: 'tenant-123',
  sourceSystem: 'Salesforce',
  rowCount: 25000,
  dryRun: false,
})

// Step 2: Process batches — each batch creates a ledger entry
for (let i = 0; i < job.batchCount; i++) {
  await processImportBatch(job.id, i, rows[i])
  // Batch hash stored: SHA-256 of canonical JSON (sorted keys)
}

// Step 3: Verify replay safety
const isSafe = await isImportReplaySafe(job.id)
// true when: entries exist AND all batch indices 0..N are contiguous
```

---

## Replay Safety Ledger

Each production batch creates an append-only ledger entry:

```typescript
computeBatchHash(rows: Record<string, unknown>[]): string
// SHA-256 of canonical JSON (keys sorted recursively)
// Returns 64-character hex string

generateImportAuditHash(jobId, totalRows, batchCount, timestamp): string
// SHA-256 of "jobId:totalRows:batchCount:timestamp"
// Returns first 24 characters
```

`isImportReplaySafe` validates:
1. At least one ledger entry exists
2. All batch indices from 0 to max are present (no gaps)

---

## Rollback

Rollback is available only for non-dry-run jobs in `complete` or `failed` status:

```typescript
canRollback(job): boolean
// Returns true when: (status='complete' OR 'failed') AND dryRun=false
```

Rollback procedure:
1. Verify `canRollback(job) === true`
2. Run rollback via `POST /api/phase11/imports/:id/rollback`
3. All rows from the import are soft-deleted (audit record preserved)
4. Replay ledger entries remain (immutable — never deleted)
5. Verify data integrity after rollback

---

## Import Progress Monitoring

```typescript
computeImportProgress(job): number
// (importedRows + failedRows) / rowCount
// Range: 0.0 to 1.0
```

Poll `GET /api/phase11/imports/:id` every 5 seconds during active import.

Expected timeline for 500,000 rows (100 batches):
- Validation: ~2 minutes
- Import: ~8 minutes
- Replay hash computation: ~1 minute
- Total: ~11 minutes

---

## Common Import Errors

| Error | Cause | Resolution |
|---|---|---|
| `rowCount must be between 1 and 500000` | Job too large | Split into multiple jobs |
| `Mapping error: required field missing` | Source missing required field | Add default value to mapping rule |
| `Migration blocked: long-running transactions` | DB has active long queries | Wait for queries to complete |
| `Batch gap detected` | Batches processed out of order | Re-run from the missing batch index |
| `Validation pass rate below threshold` | Too many invalid rows | Fix source data and re-run dry run |
