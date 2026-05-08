# Enterprise Integration Hub

**Denver Engineering — Ava Phase 4 (v4.40.0)**

## Overview

The Integration Hub provides a connector framework for bidirectional data exchange with external enterprise systems including Slack, Teams, ERP platforms, CMMS systems, BACnet controllers, SAP, and Oracle. All integrations are asynchronous, fault-tolerant, and observable through health scores and job queues.

## Connector Framework

### Architecture

```
registerConnector()  →  integration_connectors table
enqueueIntegrationJob()  →  integration_jobs table
claimIntegrationJob()  →  FOR UPDATE SKIP LOCKED (worker claim)
completeIntegrationJob()  →  updates status + resets health
failIntegrationJob()  →  increments failures + updates health score
```

### Connector Health Score

```
score = 100
score -= min(consecutiveFailures × 15, 60)   // up to -60 for failures
if (ageMinutes > 1440) score -= 20             // > 24h stale
if (ageMinutes > 360) score -= 10              // > 6h stale
score = max(0, score)
```

### Retry Backoff

Failed jobs retry with exponential backoff (capped):

| Attempt | Delay |
|---------|-------|
| 0 | 30s |
| 1 | 60s |
| 2 | 5 min |
| 3 | 15 min |
| 4+ | 1 hour |

### Dead-Letter Queue

Jobs exceeding `max_attempts` are moved to `status = 'dead_letter'`. They are not automatically retried. Dead-letter recovery requires manual operator intervention via the integration hub UI or direct API call.

## Schema

### `integration_connectors`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Connector identifier |
| tenant_id | UUID | Tenant scope (RLS) |
| name | TEXT | Human-readable name |
| connector_type | TEXT | slack / teams / sap / oracle / cmms / bacnet / erp / generic_webhook |
| config | JSONB | Connector-specific config (non-secret) |
| credential_ref | TEXT | Reference to secret manager key (never stored inline) |
| status | TEXT | active / inactive / error |
| health_score | INT | 0–100 computed health |
| consecutive_failures | INT | Failure streak count |
| last_sync_at | TIMESTAMPTZ | Last successful sync |
| last_error | TEXT | Most recent error message |

### `integration_jobs`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Job identifier |
| tenant_id | UUID | Tenant scope (RLS) |
| connector_id | UUID FK | Parent connector |
| job_type | TEXT | sync / push / pull / webhook_delivery |
| status | TEXT | pending / running / completed / failed / dead_letter |
| payload | JSONB | Job-specific data |
| result | JSONB | Output on completion |
| attempts | INT | Current attempt count |
| max_attempts | INT | Default: 5 |
| next_attempt_at | TIMESTAMPTZ | Scheduled retry time |
| idempotency_key | TEXT | UNIQUE(tenant_id, idempotency_key) NULLS NOT DISTINCT |

## Worker Pattern

The integration worker uses `FOR UPDATE SKIP LOCKED` to claim jobs without contention:

```sql
SELECT j.*, c.connector_type, c.config, c.credential_ref
FROM integration_jobs j
JOIN integration_connectors c ON c.id = j.connector_id
WHERE j.status = 'pending' AND j.next_attempt_at <= now()
  AND j.attempts < j.max_attempts
ORDER BY j.created_at ASC
LIMIT 1
FOR UPDATE OF j SKIP LOCKED
```

Multiple workers can run in parallel without coordination overhead.

## Idempotency

Jobs support an `idempotency_key` to prevent duplicate processing. Inserting a job with a key that already exists for the tenant silently returns `null` (DO NOTHING). This protects against webhook retries and retry-on-failure patterns.

## Supported Connector Types

| Type | Direction | Use Case |
|------|-----------|----------|
| `slack` | outbound | Escalation notifications, approvals |
| `teams` | outbound | Work order alerts, daily briefings |
| `sap` | bidirectional | Work order sync, asset registry |
| `oracle` | bidirectional | Finance integration, PO tracking |
| `cmms` | bidirectional | Maintenance management sync |
| `bacnet` | inbound | Building automation event ingestion |
| `erp` | bidirectional | General enterprise resource planning |
| `generic_webhook` | outbound | Custom downstream systems |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/integrations/hub/connect` | Register a new connector |
| GET | `/api/v1/integrations/hub` | List tenant connectors |
| GET | `/api/v1/integrations/hub/health` | All connector health scores |
| GET | `/api/v1/integrations/hub/:id/health` | Single connector health |
| POST | `/api/v1/integrations/hub/sync` | Enqueue a sync job |
| POST | `/api/v1/integrations/hub/jobs/:id/complete` | Mark job completed |
| POST | `/api/v1/integrations/hub/jobs/:id/fail` | Mark job failed + schedule retry |
