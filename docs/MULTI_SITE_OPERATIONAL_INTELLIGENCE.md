# Multi-Site Operational Intelligence

**Denver Engineering — Ava Phase 6 (v6.0.0)**

## Overview

Multi-site intelligence aggregates and compares operational data across physical locations. Site twins (`entity_type = 'site'`) are the unit of analysis. The `SiteClusterDashboard` provides a real-time cluster view of all site twins.

## Site Twin

A site twin represents a physical project site or operational location:

```typescript
{
  entityType: 'site',
  entityId: '<site UUID>',
  name: 'Main Construction Site',
  status: 'active' | 'degraded' | 'maintenance' | ...,
  readinessScore: number,   // aggregate of sub-systems
  riskScore: number,        // composite risk index
  healthScore: number,      // asset health aggregate
  syncLagMs: number,        // data freshness indicator
  lastSyncedAt: Date,
}
```

## Sync Freshness

Sites with no sync in the past 5 minutes (30,000ms) are marked **stale**. The `SiteClusterDashboard` displays an amber indicator for stale twins, alerting operators to potential connectivity issues or sync failures.

```typescript
const STALE_THRESHOLD_MS = 5 * 60 * 1000  // 5 minutes
const isStale = lastSyncedAt 
  ? Date.now() - lastSyncedAt.getTime() > STALE_THRESHOLD_MS 
  : true
```

## Cluster View

The dashboard provides:
- **Total sites**: All registered site twins
- **Active sites**: status == 'active'
- **Average readiness**: mean readiness across all sites
- **Average risk**: mean risk across all sites
- **Stale sync count**: sites with stale data

Sites can be sorted by readiness (ascending problem-first), risk (descending threat-first), or name (alphabetical).

## Site-Level Risk Ring

Each site card displays a colored ring border matching its status:
- Emerald: active
- Amber: degraded
- Red: failed
- Blue: maintenance

## Cross-Site Comparison

The `CrossProjectHeatmap` component works at the project level but the same pattern extends to sites: each cell represents a site, colored by readiness or risk. A tooltip shows exact scores on hover.

## Regional Aggregation

Region twins (`entity_type = 'region'`) aggregate metrics from constituent site twins via the graph engine. The `contains` relationship links region → site:

```
region-twin  --[contains]-->  site-twin-A
region-twin  --[contains]-->  site-twin-B
```

Regional readiness = average of contained sites' readiness scores, weighted by their risk scores.

## Integration

- **Real-time events** (`realtime_event_log`) are linked to site twins via `twin_event_links`
- **Anomaly detection** runs site-scoped when `entity_type = 'site'`
- **Maintenance recommendations** target equipment twins within a site cluster
- **Agent Context Builder** includes site metrics in the operational context for all agent tasks
