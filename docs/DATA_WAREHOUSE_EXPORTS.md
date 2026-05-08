# Data Warehouse + Analytics Exports

**Denver Engineering — Ava Phase 4 (v4.40.0)**

## Overview

The Data Warehouse Export system provides asynchronous, tenant-scoped bulk data exports in CSV, JSON, and Parquet (JSON lines) formats. Exports run as background jobs claimed by workers using `FOR UPDATE SKIP LOCKED`. Completed exports are accessible via signed download URLs.

## Supported Export Types

| Type | Description |
|------|-------------|
| `actions` | All actions with SLA, assignment, and lifecycle data |
| `incidents` | Incident records with severity and resolution timelines |
| `readiness` | Readiness scores and state history per entity |
| `audit_events` | Audit log events within date range |
| `sla_metrics` | SLA compliance metrics by project and period |
| `contractor_performance` | Assignee metrics aggregated from action data |
| `ai_recommendations` | AI recommendation queue with outcomes |

## Output Formats

### CSV
- Header row from object keys
- Values containing commas or double-quotes are quoted
- Internal double-quotes are escaped as `""`
- `null`/`undefined` values render as empty string

### JSON
- One JSON object per line (newline-delimited)
- No header row
- All values serialized with `JSON.stringify()`

### Parquet
- Implemented as JSON lines (same as JSON format)
- Designed for future native Parquet encoding via a processing step
- Column metadata preserved for downstream ETL pipelines

## Schema

### `export_jobs`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Job identifier |
| tenant_id | UUID | Tenant scope (RLS) |
| name | TEXT | Export name |
| export_type | TEXT | See supported types above |
| format | TEXT | csv / json / parquet |
| filters | JSONB | Optional filter criteria |
| status | TEXT | pending / running / completed / failed |
| requested_by | UUID FK | User who created the export |
| row_count | INT | Rows exported on completion |
| file_size_bytes | BIGINT | Output file size |
| download_url | TEXT | Signed URL (set after upload) |
| expires_at | TIMESTAMPTZ | URL expiry (default +7 days) |
| error_message | TEXT | Failure reason |

## Worker Pattern

Workers claim pending export jobs using `FOR UPDATE SKIP LOCKED`:

```sql
UPDATE export_jobs
SET status = 'running', started_at = now(), worker_id = $1
WHERE id = (
  SELECT id FROM export_jobs
  WHERE status = 'pending'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *
```

After claiming, the worker calls `processExportJob()` which:
1. Executes the appropriate query from `EXPORT_QUERIES`
2. Streams rows through `_formatRow()` for the requested format
3. Prepends a header row for CSV via `_formatHeader()`
4. Writes the output to the configured storage backend
5. Updates `export_jobs` with `row_count`, `file_size_bytes`, `download_url`, `status = 'completed'`

## Format Functions

### `_formatRow(row, format)`
Formats a single DB row as a string:
- `json` → `JSON.stringify(row)`
- `csv` → comma-joined values with quoting for special chars
- `parquet` → same as `json` (JSON lines for downstream processing)

### `_formatHeader(row, format)`
Returns the header string for CSV (`Object.keys(row).join(',')`) or `null` for JSON/Parquet.

## Security

- Exports are tenant-scoped via RLS — workers cannot access cross-tenant data
- Download URLs are signed and expire after 7 days
- The `requested_by` field is logged for audit purposes
- Worker IDs are tracked per export job

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/exports` | Create export job (returns job_id immediately) |
| GET | `/api/v1/exports/:id` | Poll job status |
| GET | `/api/v1/exports/:id/download` | Get signed download URL |
