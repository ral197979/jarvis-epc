# AI Execution Governance

**Denver Engineering — Ava Phase 4 (v4.40.0)**

## Overview

The AI Governance layer ensures that every AI-generated operational recommendation passes through a structured human review process before affecting production data. No autonomous execution occurs without explicit approval. Every decision is logged to an immutable audit chain.

## Core Principles

- **Approval required by default** — `DEFAULT_APPROVAL_REQUIRED = true`
- **Confidence threshold enforced** — recommendations below 70% confidence are auto-rejected before persisting
- **Immutable audit events** — `ai_approval_events` uses CREATE RULE to block UPDATE and DELETE at the database level
- **Preview without mutation** — callers can inspect projected impact before approving
- **Execution gated by status** — the execute function re-checks `status === 'approved'` regardless of caller claims

## Confidence Threshold

```
DEFAULT_CONFIDENCE_THRESHOLD = 70
```

Recommendations with `confidence_score < threshold` are inserted with `status = 'rejected'` and an `auto_rejected: true` audit event. They are never set to `pending`. Callers can override with `minConfidenceThreshold` per-recommendation.

## Recommendation Lifecycle

```
[Generated] → queued (if ≥ threshold)
           → rejected (if < threshold, auto)
[Queued]   → approved (human via PATCH)
           → rejected (human via PATCH)
           → expired (background sweep)
[Approved] → executed (human-triggered)
```

## Schema

### `ai_recommendation_queue`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Recommendation identifier |
| tenant_id | UUID | Tenant scope (RLS) |
| action_id | UUID | Related action (nullable) |
| recommended_action | TEXT | Action type string |
| category | TEXT | Operations category |
| confidence_score | NUMERIC | 0–100 confidence |
| impact_score | NUMERIC | Expected operational impact |
| urgency_score | NUMERIC | Time sensitivity |
| status | TEXT | pending / approved / rejected / executed / expired |
| approval_required | BOOL | Gate flag (default true) |
| approved_by | UUID | Approver (FK → users) |
| executed_by | UUID | Executor (FK → users) |
| expires_at | TIMESTAMPTZ | Auto-expire if not acted on |

### `ai_approval_events`
Immutable append-only audit log. CREATE RULE blocks UPDATE and DELETE.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Event identifier |
| recommendation_id | UUID FK | Parent recommendation |
| event_type | TEXT | queued / approved / rejected / executed / previewed / expired |
| actor_id | TEXT | User or 'system' |
| metadata | JSONB | Context data for the event |

## Approval Gate

`executeRecommendation()` always re-fetches the recommendation and checks:

```typescript
if (rec.approval_required && rec.status !== 'approved') {
  return { executed: false, output: { error: 'approval_required' } }
}
```

This check cannot be bypassed through the API. Even if a caller claims prior approval, the database state governs.

## Preview

`previewRecommendation()` returns projected impact data from `affected_entities`, `rollback_plan`, and confidence scores. It writes only a single `previewed` audit event — no production tables are touched.

## Expiry

`expireStaleRecommendations(tenantId)` is designed to run as a background cron job. It sets `status = 'expired'` for all pending recommendations past their `expires_at` timestamp and appends an audit event for each.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ai/recommendations` | List pending recommendations |
| POST | `/api/v1/ai/recommendations` | Queue a new recommendation |
| GET | `/api/v1/ai/recommendations/:id/preview` | Preview impact (no mutations) |
| POST | `/api/v1/ai/recommendations/:id/approve` | Approve for execution |
| POST | `/api/v1/ai/recommendations/:id/reject` | Reject with reason |
| POST | `/api/v1/ai/recommendations/:id/execute` | Execute (requires approved status) |
| POST | `/api/v1/ai/recommendations/expire` | Expire stale pending items |
