# Action Intelligence Layer — Architecture Overview

**Ava Phase 2 | Denver Engineering v4.34.0**

---

## Overview

The Action Intelligence Layer sits above the Phase 1 Action Engine and transforms raw action records into an observable, prioritized, and analytically rich operational surface. It introduces nine independent services, five database migrations, seven frontend components, and a comprehensive event stream — all without modifying Phase 1 behavior.

---

## Architectural Principles

1. **Additive, never destructive** — Phase 2 extends; it does not rewrite. All Phase 1 APIs, SLA engine hooks, and module fire-and-forget calls remain unchanged.
2. **Asynchronous background work** — No synchronous long operations in request handlers. All background workers use `FOR UPDATE SKIP LOCKED` claim patterns registered via `registerPromoter()`.
3. **Tenant isolation at every layer** — All nine new tables carry `tenant_id` and Row Level Security policies. No cross-tenant data exposure is possible at the query layer.
4. **Append-only audit trail** — The event stream is enforced immutable at the PostgreSQL rule level, not just the application layer.
5. **Provider-agnostic AI** — Scoring is deterministic and rule-based. An `ScoringProvider` interface allows future LLM plug-ins without changing callers.
6. **Idempotency by design** — Relationship upserts reactivate soft-deleted edges. Notification deduplication uses a partial unique index. Analytics snapshots use `ON CONFLICT DO UPDATE`.

---

## System Layers

```
┌──────────────────────────────────────────────────────────────┐
│                      Frontend Layer                          │
│  UnifiedOperationsInbox · ActionDetailDrawer · SlaBadge      │
│  EscalationIndicator · WorkloadSummaryCards · TimelinePanel  │
│  DependencyGraphPlaceholder                                  │
└────────────────────────────┬─────────────────────────────────┘
                             │ REST (plain fetch, 30s poll)
┌────────────────────────────▼─────────────────────────────────┐
│                       Route Layer                            │
│  GET  /api/v1/actions/inbox                                  │
│  GET  /api/v1/actions/analytics/{overview,trends,workload}   │
│  POST /api/v1/actions/:id/relationships                      │
│  GET  /api/v1/actions/:id/relationships                      │
│  DEL  /api/v1/actions/relationships/:relId                   │
│  GET  /api/v1/actions/:id/timeline                           │
│  GET  /api/v1/actions/:id/dependencies                       │
│  POST /api/v1/actions/:id/sla/pause                          │
│  POST /api/v1/actions/:id/sla/resume                         │
└─────┬──────────────┬──────────────┬──────────────┬───────────┘
      │              │              │              │
┌─────▼──────┐ ┌─────▼──────┐ ┌────▼──────┐ ┌────▼──────────┐
│Relationship│ │  SLA Policy │ │Analytics  │ │   Scoring &   │
│  Service   │ │   Engine    │ │ Service   │ │Recommendation │
└─────┬──────┘ └─────┬──────┘ └────┬──────┘ └────┬──────────┘
      │              │              │              │
┌─────▼──────────────▼──────────────▼──────────────▼──────────┐
│                    Core Service Layer                        │
│  actionEventPublisher · actionDependencyGraph                │
│  notificationQueue · notificationWorker                      │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│                     Database Layer                           │
│  action_relations · action_sla_state · sla_profiles          │
│  sla_profile_rules · notification_jobs                       │
│  notification_delivery_attempts · notification_dead_letters  │
│  action_analytics_snapshots · action_events                  │
└──────────────────────────────────────────────────────────────┘
```

---

## Service Inventory

| Service | File | Responsibility |
|---------|------|----------------|
| Action Relationship Service | `actionRelationshipService.ts` | Directed graph edges, cycle detection, soft delete |
| Action Dependency Graph | `actionDependencyGraph.ts` | Recursive blocker resolution, critical path |
| Action Event Publisher | `actionEventPublisher.ts` | Append-only event log, timeline queries |
| SLA Policy Engine | `slaPolicyEngine.ts` | Business hours math, pause/resume, remaining minutes |
| Notification Queue | `notificationQueue.ts` | Enqueue, dedup, multi-channel, escalation helpers |
| Notification Worker | `notificationWorker.ts` | Claim, deliver, backoff, dead-letter |
| Action Scoring Service | `actionScoringService.ts` | Deterministic 6-component score, provider interface |
| Action Recommendation Service | `actionRecommendationService.ts` | Rule-based inbox recommendations, assignee suggestion |
| Action Analytics Service | `actionAnalyticsService.ts` | Overview, trends, workload, nightly snapshot job |

---

## Migration Sequence

| Migration | Table(s) | Purpose |
|-----------|----------|---------|
| 030 | `action_relations` | Directed relationship graph |
| 031 | `sla_profiles`, `sla_profile_rules`, `action_sla_state` | SLA policy profiles + per-action state |
| 032 | `notification_jobs`, `notification_delivery_attempts`, `notification_dead_letters` | Notification pipeline |
| 033 | `action_analytics_snapshots` | Pre-aggregated analytics |
| 034 | `action_events` (+ enum + immutability rules) | Append-only event stream |

---

## Data Flow: Action Created → Intelligence Pipeline

```
POST /api/v1/[module]                    (Phase 1 unchanged)
  └── createAction()                     (Phase 1 fire-and-forget)
        ├── INSERT INTO actions
        ├── _resolveSlaRule() → sets due_at
        └── publishActionEvent('created') ──► action_events

Inbox polling (30s, frontend)
  └── GET /api/v1/actions/inbox
        ├── SELECT actions + sla_state + relation counts
        ├── batchBlockerStatus() ──────────► action_relations
        └── JSON response → UnifiedOperationsInbox

SLA Engine tick (60s, Phase 1)
  └── _fireNextEscalation()
        ├── UPDATE actions.escalation_level
        ├── publishActionEvent('escalated') ► action_events
        └── enqueueEscalationNotification() ► notification_jobs

Notification Worker tick (30s)
  └── Claim notification_jobs (SKIP LOCKED)
        ├── deliver(job)
        ├── On success → status = 'delivered'
        └── On failure → exponential backoff → dead_letters

Analytics Snapshot (nightly)
  └── enqueueSnapshotForAllTenants()
        └── computeAndStoreSnapshot(tenantId)
              └── UPSERT action_analytics_snapshots
```

---

## Correlation ID Threading

Every request that enters the system carries a correlation ID:

```
X-Correlation-ID: <uuid-or-hex>   (from client or generated)
  └── Middleware attaches req.correlationId
        └── Passed into publishActionEvent(opts.correlationId)
              └── Stored in action_events.correlation_id
```

This enables distributed tracing: a single API call that triggers escalation, notification enqueue, and event publication can be traced end-to-end via the correlation ID.

---

## Security Model

- **RBAC enforcement** — Analytics endpoints (`/analytics/*`) require `admin` or `pm` role. All mutation routes check `tenant_id` ownership before operating.
- **Tenant isolation** — Row Level Security on all Phase 2 tables using `current_setting('app.current_tenant_id', true)::uuid`.
- **No PII in dedup keys** — Notification dedup keys are action-ID + event-type scoped, never email addresses.
- **Immutable audit log** — `action_events` has PostgreSQL-level `DO INSTEAD NOTHING` rules preventing UPDATE and DELETE.

---

## Phase 3 Extension Points

| Interface | Current | Phase 3 Target |
|-----------|---------|----------------|
| `ScoringProvider` | Rule-based deterministic | OpenAI / Anthropic embedding reranking |
| Notification channels | in_app, email, webhook, slack | SMS, PagerDuty, Teams |
| Dependency visualization | Placeholder div | D3.js / Cytoscape graph |
| Analytics snapshots | Daily | Hourly for active projects |
| SLA profiles | Per-tenant | Per-project, per-user overrides |
