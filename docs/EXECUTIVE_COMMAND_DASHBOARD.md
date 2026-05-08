# Executive Command Dashboard

**Denver Engineering — Ava Phase 4 (v4.40.0)**

## Overview

The Executive Command Dashboard aggregates portfolio risk, escalation hotspots, contractor performance, SLA compliance, AI acceptance rates, and operational throughput into a single top-level view for program leadership. All data is read-only and derived from existing operational tables.

## KPI Strip

The dashboard header shows six KPI cards:

| KPI | Source | Color |
|-----|--------|-------|
| Open Actions | actions.open_count | Blue |
| SLA Breached | actions.breached_count | Red |
| Escalated | actions.escalated_count | Orange |
| Readiness Ready % | readiness states (ready/total) | Green |
| AI Pending Approvals | ai_recommendation_queue.pending | Purple |
| Active Incidents | incidents.count | Red/Green |

## Tab Panels

### Portfolio Heatmap
Renders a grid of projects with risk-color-coded readiness, SLA compliance, open action counts, and escalation signals. Sortable by risk level or SLA compliance. Uses `GET /api/v1/executive/portfolio-risk`.

### Escalation Radar
SVG bubble chart of escalation hotspots by module. Bubble size = escalation count. Color maps to severity. Backed by `GET /api/v1/executive/escalation-hotspots`.

### Contractor Performance Grid
Sortable table of assignee performance metrics. Columns: assignee (ID prefix), total assigned, completed (with %), overdue, escalated, avg completion hours, risk badge. Risk is computed client-side from thresholds:
- `high`: overdue > 5 OR escalated > 2
- `medium`: overdue > 1 OR escalated > 0
- `low`: otherwise

## API Endpoints

### `GET /api/v1/executive/overview`
Runs four parallel DB queries and returns:

```json
{
  "data": {
    "actions": {
      "open_count": 42,
      "in_progress_count": 15,
      "completed_count": 230,
      "breached_count": 7,
      "escalated_count": 3
    },
    "readiness": [
      { "state": "ready", "count": 18 },
      { "state": "at_risk", "count": 4 }
    ],
    "incidents": [{ "severity": "critical", "count": 2 }],
    "ai_recommendations": { "pending_approvals": 5, "executed_today": 12 }
  }
}
```

### `GET /api/v1/executive/portfolio-risk`
Returns project-level risk summary with readiness state, SLA compliance, action counts.

### `GET /api/v1/executive/escalation-hotspots`
Returns escalation counts grouped by module/source for radar visualization.

### `GET /api/v1/executive/contractor-performance`
Returns per-assignee metrics: total_assigned, completed, overdue, escalated, avg_completion_hours.

### `GET /api/v1/executive/sla-compliance`
Returns SLA compliance trend data by week/month.

### `GET /api/v1/executive/ai-acceptance`
Returns AI recommendation acceptance rate over time.

### `GET /api/v1/executive/throughput`
Returns daily/weekly action completion throughput.

## Frontend Components

| Component | Description |
|-----------|-------------|
| `ExecutiveOverviewPage` | Top-level container with KPI strip, readiness summary, and tab panels |
| `PortfolioHeatmap` | Project risk grid with color-coded columns |
| `EscalationRadar` | SVG bubble chart of escalation hotspots |
| `ContractorPerformanceGrid` | Sortable assignee performance table |
