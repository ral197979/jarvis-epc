# Audit Chain Verification System

**Denver Engineering — Ava Phase 4 (v4.40.0)**

## Overview

The Audit Chain Verification System provides cryptographic integrity proofs for the `realtime_event_log` table. It detects gaps (missing sequence numbers), tampered records (hash mismatches against daily snapshots), and maintains a 30-day rolling history of integrity status. Results are displayed in the `AuditIntegrityDashboard` frontend component.

## Chain Hash Algorithm

The chain hash is a rolling SHA-256 over the ordered event log:

```
hash_0 = ''
hash_i = SHA256(hash_{i-1} + ':' + event_id + ':' + sequence_number)
final  = hash_n   (or SHA256('empty') for no events)
```

This construction ensures:
- Each hash commits to the full prefix history
- Any insertion, deletion, or modification changes the final hash
- The algorithm is deterministic given the same event sequence

The same algorithm is used in the Replay Engine (`computeReplayChecksum`).

## Gap Detection

`detectGaps(events)` checks sequence number continuity:

```
For each consecutive pair (prev, curr):
  if curr.sequence_number - prev.sequence_number > 1:
    gap = { expectedSeq: prev+1, foundSeq: curr, gapSize: curr-prev-1 }
```

Gaps indicate deleted or missing events. Each gap is reported with its starting expected sequence and the actual next found sequence.

## Integrity Status Values

| Status | Meaning |
|--------|---------|
| `valid` | Chain hash matches snapshot; no gaps |
| `tampered` | Chain hash differs from stored snapshot |
| `gap_detected` | Sequence continuity broken (events missing) |
| `empty` | No events in the verified period |

## Schema

### `audit_integrity_snapshots`

One row per tenant per day. The `UNIQUE(tenant_id, snapshot_date)` constraint ensures UPSERT idempotency.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Snapshot identifier |
| tenant_id | UUID | Tenant scope |
| snapshot_date | DATE | Date of snapshot |
| event_count | INT | Total events in period |
| chain_hash | TEXT | Rolling SHA-256 of event sequence |
| integrity_status | TEXT | valid / tampered / gap_detected / empty |
| gaps_detected | INT | Number of sequence gaps |
| first_seq | BIGINT | Lowest sequence number |
| last_seq | BIGINT | Highest sequence number |

## Snapshot Flow

`snapshotIntegrity(tenantId)` computes today's chain hash and upserts the result:

1. Load all events for today (`WHERE published_at::date = CURRENT_DATE`)
2. `computeChainHash(events)` → rolling SHA-256
3. `detectGaps(events)` → gap details
4. Compare `chain_hash` against any prior snapshot for today
5. Set `integrity_status`: `valid`, `tampered`, `gap_detected`, or `empty`
6. UPSERT into `audit_integrity_snapshots` on `(tenant_id, snapshot_date)`

## Tamper Detection

On subsequent runs for the same day, if a snapshot already exists and the computed `chain_hash` differs from the stored value, the status is set to `tampered`. This indicates events were modified, deleted, or inserted since the last snapshot.

## 30-Day History

`getIntegritySnapshots(tenantId, days=30)` returns one row per day for the past N days, enabling the timeline visualization in the dashboard.

## Export

`GET /api/v1/audit/export` streams the full `realtime_event_log` as a JSON export with chain hash and gap metadata. This is suitable for offline verification or regulatory submission.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/audit/verify/verify` | Run chain verification, return integrity report |
| GET | `/api/v1/audit/verify/integrity` | Get 30-day snapshot history |
| POST | `/api/v1/audit/verify/snapshot` | Force a new integrity snapshot |
| GET | `/api/v1/audit/verify/export` | Export full audit chain as JSON |

## Frontend: AuditIntegrityDashboard

Displays:
- Current integrity status with color-coded banner (green=valid, red=tampered, orange=gap, grey=empty)
- Chain hash preview (first 20 chars of hex)
- 30-day color-dot history timeline
- Export link for offline verification
- "Verify Now" button to trigger a fresh snapshot
