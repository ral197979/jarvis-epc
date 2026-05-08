# Action Analytics Layer

**Ava Phase 2 | Denver Engineering v4.34.0**

---

## Overview

The Action Analytics Layer provides three query surfaces — overview metrics, trend history, and assignee workload — backed by nightly pre-aggregated snapshots. Live fallback queries ensure data is always available even before the first snapshot runs.

---

## Database Schema

### `action_analytics_snapshots`

Nightly denormalized metrics per tenant, `UNIQUE(tenant_id, snapshot_date)`:

| Column | Type | Description |
|--------|------|-------------|
| `snapshot_date` | DATE | The date this snapshot covers |
| `total_open` | INTEGER | Open actions at end of day |
| `total_completed_today` | INTEGER | Actions closed on this date |
| `total_overdue` | INTEGER | Actions past due_at at end of day |
| `total_escalated` | INTEGER | Actions with escalation_level >= 1 |
| `sla_compliance_pct` | NUMERIC | % of closed actions resolved within SLA |
| `avg_resolution_hours` | NUMERIC | Mean hours from created_at to closed_at |
| `median_resolution_hours` | NUMERIC | Median hours (P50) |
| `p90_resolution_hours` | NUMERIC | 90th percentile resolution hours |
| `age_bucket_0_24h` | INTEGER | Open actions aged 0–24 hours |
| `age_bucket_24_72h` | INTEGER | Open actions aged 24–72 hours |
| `age_bucket_72h_plus` | INTEGER | Open actions aged 72+ hours |
| `by_module` | JSONB | `{ module_name: count }` |
| `by_priority` | JSONB | `{ priority: count }` |
| `by_system_type` | JSONB | `{ system_type: count }` |
| `assignee_workload` | JSONB | Array of `{ user_id, email, open, overdue, avg_age_hours }` |

---

## API Surfaces

### `GET /api/v1/actions/analytics/overview`

Returns current-state metrics computed live (does not use snapshots):

```json
{
  "data": {
    "total_open":       142,
    "total_overdue":     18,
    "total_escalated":   7,
    "total_blocked":     11,
    "by_priority": {
      "critical": 4,
      "high":     23,
      "medium":   87,
      "low":      28
    },
    "by_module": {
      "rfis":         31,
      "submittals":   22,
      "punch_items":  44,
      ...
    },
    "sla_compliance_last_30d": 0.82
  }
}
```

Implementation: 5 parallel `Promise.all` queries — open count, overdue count, escalated count, blocked count, by-module breakdown. SLA compliance reads from the last 30 days of snapshots if available, otherwise computes live.

**Authorization:** `admin` or `pm` role required.

### `GET /api/v1/actions/analytics/trends?days=30`

Returns one data point per day for the requested window:

```json
{
  "data": [
    { "date": "2026-05-01", "open": 138, "overdue": 14, "completed": 9 },
    { "date": "2026-05-02", "open": 141, "overdue": 16, "completed": 7 },
    ...
  ]
}
```

Implementation: reads from `action_analytics_snapshots` for dates within the window. Falls back to a live GROUP BY query for any dates not yet snapshotted (e.g. today, or days before the first snapshot ran).

**Authorization:** `admin` or `pm` role required.

### `GET /api/v1/actions/analytics/workload?limit=10`

Returns top N assignees by open action count:

```json
{
  "data": [
    {
      "user_id":       "uuid",
      "email":         "alice@example.com",
      "open_count":    23,
      "overdue_count": 4,
      "avg_age_hours": 31.5
    },
    ...
  ]
}
```

Implementation: live query — counts open/overdue per `assigned_to_user_id` joined with user email. Snapshots store a cached `assignee_workload` JSONB, but the live query is used for the API to reflect real-time assignment changes.

**Authorization:** `admin` or `pm` role required.

---

## Snapshot Job

### Registration

```typescript
// In server.ts:
registerAnalyticsSnapshotHandler()
```

Registers a named background handler `'action_analytics_snapshot'` that runs when a job of that type is dequeued. The handler is triggered nightly by:

```typescript
await enqueueSnapshotForAllTenants()
```

This function reads all active tenant IDs and enqueues one snapshot job per tenant, with dedup keys preventing double-execution on the same date.

### Snapshot Computation

`computeAndStoreSnapshot(tenantId, date)`:

1. Computes all metrics via SQL aggregation for actions belonging to `tenantId` with state as of `date`
2. Computes `assignee_workload` as a JSON aggregation
3. `UPSERT` into `action_analytics_snapshots ON CONFLICT (tenant_id, snapshot_date) DO UPDATE SET ...`

The upsert means snapshots are idempotent — re-running the job for the same date updates (corrects) the snapshot rather than erroring.

### Scheduling

Phase 2 registers the handler but defers scheduling to the operator. Recommended: use a cron job or the application scheduler to call `enqueueSnapshotForAllTenants()` at `00:05` daily (5 minutes past midnight, after the day's final SLA tick).

---

## Frontend: WorkloadSummaryCards

The `WorkloadSummaryCards` component consumes `/api/v1/actions/analytics/workload`:

- **Card mode (default):** Flex-wrap grid of cards, one per assignee. Each card shows open count, overdue count, average age, and an overdue ratio bar that shifts from green → orange → red as the overdue ratio crosses 20% and 50%.
- **Compact mode (`compact={true}`):** Simple table for embedding in sidebars or dashboards.
- **Initials avatar:** Derives 1–2 letter initials from the email's local part (e.g. `alice.smith` → `AS`).

---

## Data Freshness Model

| Surface | Freshness | Source |
|---------|-----------|--------|
| Overview metrics | Real-time | Live queries |
| Workload | Real-time | Live queries |
| Trend history | 24h lag | Snapshots (live fallback for today) |
| SLA compliance 30d | 24h lag | Snapshots |

This hybrid model balances query cost (snapshots for historical aggregates) with accuracy (live queries for current-state decisions).

---

## Known Limitations

- Snapshot computation runs in a single transaction per tenant. Very large tenants (100k+ actions) may need cursor-based batching in Phase 3.
- `median_resolution_hours` and `p90_resolution_hours` use PostgreSQL `percentile_cont` aggregates, which are accurate but not incremental. Recomputing them for historical corrections requires re-running the full snapshot.
- There is no multi-tenant admin view (global dashboard across all tenants). Phase 3 should add a super-admin analytics surface.
- Trend data before the first snapshot run will always fall back to live queries, which are slower. Consider bootstrapping historical snapshots on first deploy.
