# Operational Digital Twin Architecture

**Denver Engineering — Ava Phase 6 (v6.0.0)**

## Overview

The Operational Digital Twin (ODT) system creates live, event-linked virtual representations of every operational entity in the Denver Engineering platform. Each twin maintains a complete, auditable state history and participates in a multi-layer graph that drives predictive intelligence across projects, sites, and portfolios.

## Design Principles

1. **Entity completeness** — Every entity type (project, system, equipment, workflow, etc.) has a corresponding twin. Twins exist for the life of the entity.
2. **Event-linked state** — Every state transition is traceable to a source event. No state changes silently.
3. **Deterministic replay** — Any point-in-time state can be reconstructed exactly from the snapshot log.
4. **Tenant isolation** — All data is isolated by `tenant_id` via PostgreSQL RLS policies.
5. **Governance-first** — Mutations flow through the same governance layer as Phase 5 agent actions.

## Core Layers

```
┌─────────────────────────────────────────────────────┐
│                   Frontend Layer                    │
│  TwinOperationsMap  ReadinessPropagation  AnomalyRadar │
├─────────────────────────────────────────────────────┤
│                    API Routes                       │
│      /api/v1/twins   /portfolio   /scenarios        │
├─────────────────────────────────────────────────────┤
│                 Twin Core Services                  │
│  Registry  Snapshot  Graph  StateStore  Sync        │
├─────────────────────────────────────────────────────┤
│              Intelligence Services                  │
│  GraphTraversal  RiskPropagation  TemporalEngine    │
│  ForecastEngine  AnomalyDetection  Maintenance      │
├─────────────────────────────────────────────────────┤
│               Database Layer (Postgres)             │
│  operational_twins  twin_state_snapshots            │
│  twin_relationships  twin_event_links               │
│  operational_anomalies  scenario_simulations        │
│  operational_forecasts                              │
└─────────────────────────────────────────────────────┘
```

## Entity Types

| Type | Description |
|------|-------------|
| `project` | Top-level project twin |
| `system` | Engineering system (electrical, HVAC, etc.) |
| `subsystem` | Sub-component of a system |
| `equipment` | Physical asset |
| `tag` | Instrument or control tag |
| `workflow` | Operational workflow |
| `action` | Single work item |
| `inspection` | Inspection record |
| `deficiency` | Open deficiency |
| `permit` | Work permit |
| `vendor` | Vendor entity |
| `workforce` | Crew or workforce group |
| `site` | Physical site location |
| `region` | Geographic or operational region |

## Twin Lifecycle

```
Register (upsert) → Active → Sync events → Snapshot
     ↓                           ↓
 Degraded → Maintenance → Active (recovered)
     ↓
  Failed → Decommissioned
```

## Data Flows

1. **Source entity mutation** (e.g., action status changes)
2. **Event published** to `realtime_event_log`
3. **twinSync** picks up event, calls `syncTwin`
4. **State diff** computed vs. latest snapshot
5. If changed: **snapshot captured** with SHA-256 checksum
6. **Hot cache** invalidated, downstream predictions re-computed

## Performance Characteristics

- **Hot state TTL**: 30 seconds (in-memory cache)
- **Snapshot frequency**: On-change only (no polling overhead)
- **Forecast TTL**: 1 hour (DB cache, invalidated on sync)
- **Graph build**: Lazy on first query, not persistent in memory
