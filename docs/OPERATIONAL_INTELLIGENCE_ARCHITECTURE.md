# Operational Intelligence Architecture
**Denver Engineering — Ava Phase 3 (v4.35.0)**

## Overview

Phase 3 transforms the Denver Engineering platform from a workflow orchestration system into a real-time operational command platform. It adds a supervisory intelligence layer above Phase 2's action processing: live event streaming, predictive analytics, mobile field execution, and a unified operations center.

## System Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND — Operations Center (React)                                │
│  OperationsCenterPage · 10 ops/ components · LiveEventFeed          │
│  ReadinessGauge · RecommendationPanel · RiskTrendChart              │
├─────────────────────────────────────────────────────────────────────┤
│  REALTIME LAYER                                                      │
│  wsGateway (:3001/ws) · subscriptionManager · eventBroadcaster     │
│  Polling fallback: GET /ops/live-feed?last_seq=N                    │
├─────────────────────────────────────────────────────────────────────┤
│  API ROUTES (v4.35.0)                                                │
│  /api/v1/ops · /api/v1/readiness · /api/v1/sync · /api/v1/evidence │
├─────────────────────────────────────────────────────────────────────┤
│  INTELLIGENCE SERVICES                                               │
│  readinessEngine · predictiveSla · recommendationEngine             │
│  syncEngine · conflictResolver · evidencePipeline                  │
├─────────────────────────────────────────────────────────────────────┤
│  PHASE 2 SERVICES (preserved)                                        │
│  slaEngine · notificationWorker · actionAnalyticsService            │
│  actionEventPublisher · dependencyRelationService · aiPrioritizer   │
├─────────────────────────────────────────────────────────────────────┤
│  DATA LAYER (PostgreSQL)                                             │
│  9 new Phase 3 tables · 5 migrations (035–039) · RLS on all tables │
└─────────────────────────────────────────────────────────────────────┘
```

## Phase 3 Objectives

| # | Objective | Primary Files |
|---|-----------|---------------|
| 1 | Unified Operations Center | `routes/ops.ts`, `OperationsCenterPage` |
| 2 | Real-time Event Streaming | `realtime/wsGateway.ts`, `subscriptionManager.ts`, `eventBroadcaster.ts` |
| 3 | Readiness Engine | `services/readiness/readinessEngine.ts`, `readinessSnapshots.ts` |
| 4 | Mobile + Offline Field Execution | `services/mobile/syncEngine.ts`, `conflictResolver.ts` |
| 5 | QR/NFC Asset Execution | `components/ops/QRWorkflowLauncher.tsx`, `routes/evidence.ts` |
| 6 | AI Next-Best-Action Engine | `services/ops/recommendationEngine.ts` |
| 7 | Predictive SLA Breach Detection | `services/ops/predictiveSla.ts` |
| 8 | Field Evidence Ingestion Pipeline | `services/evidence/evidencePipeline.ts` |
| 9 | Supervisor Command Workflows | `routes/ops.ts` (reassign, freeze, escalate, incident) |
| 10 | Frontend UX Foundations | `src/components/ops/` (10 components) |

## New Migrations (Phase 3)

| Migration | Contents |
|-----------|----------|
| `035_readiness_engine.sql` | `readiness_thresholds`, `readiness_scores`, `readiness_snapshots` |
| `036_mobile_offline.sql` | `mobile_devices`, `sync_sessions`, `offline_mutations`, `offline_conflicts` |
| `037_evidence_assets.sql` | `evidence_assets`, `evidence_links`, `evidence_processing_jobs` |
| `038_ops_commands.sql` | `ops_incidents`, `ops_commands`, `asset_scan_events`, `realtime_event_log` |
| `039_predictive_sla.sql` | `action_resolution_samples`, `sla_breach_predictions`, `staffing_risk_snapshots` |

## Non-Negotiable Rules

1. **Phase 1 and Phase 2 behavior preserved** — no modifications to existing service interfaces.
2. **No module-owned escalation logic** — all escalation flows through `actionEventPublisher`.
3. **No direct WebSocket publishing from modules** — publish via `broadcastEvent()` in `eventBroadcaster`.
4. **No synchronous long-running upload processing** — evidence pipeline uses async job queue.
5. **All realtime events replayable** — persisted to `realtime_event_log` before broadcast.
6. **All scoring explainable** — every readiness score includes `components` breakdown; every recommendation includes `reason`.
7. **All offline operations idempotent** — enforced by `UNIQUE(tenant_id, device_id, client_id)`.
8. **All evidence audit-attributed** — `uploaded_by` FK required on every evidence record.
9. **No tenant data leakage** — `SubscriptionManager.broadcast()` checks `tenantId` before delivery.
10. **No opaque AI scoring** — `ScoringProvider` and `RecommendationProvider` interfaces require explainability.

## Correlation ID Threading

Every Phase 3 request inherits the `X-Correlation-ID` header established by the Phase 2 middleware. Events published to `realtime_event_log` carry `correlation_id` from the originating HTTP request, enabling end-to-end trace linking from field action → sync upload → event → recommendation.

## Tenant Isolation Model

- All 9 new tables include `tenant_id uuid NOT NULL` with RLS policies.
- `SubscriptionManager` maintains `client.tenantId` and gates every `broadcast()` call.
- Route handlers validate entity ownership via `tenantQuery()` before returning data.
- Sync sessions and offline mutations are scoped to `(tenant_id, device_id)` pairs.

## Phase 4 Extension Points

- Replace `ScoringProvider` stub with LLM-backed ranker (GPT-4o / Claude).
- Replace `RecommendationProvider` stub with multi-model ensemble.
- Add `action_resolution_samples` ML training pipeline.
- Upgrade `BlockerGraph` to D3/Cytoscape interactive visualization.
- Add `staffing_risk_snapshots` predictive workforce dashboard.
