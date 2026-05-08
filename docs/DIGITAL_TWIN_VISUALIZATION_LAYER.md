# Digital Twin Visualization Layer

**Denver Engineering — Ava Phase 6 (v6.0.0)**

## Overview

The visualization layer translates graph state, temporal projections, and intelligence signals into interactive React components. All components are data-driven, polling-free (load-on-demand or mount-once), and consistent with the Denver Engineering design system.

## Component Catalog

### TwinOperationsMap
**File**: `src/components/TwinOperationsMap.tsx`
**Purpose**: Primary graph overview — shows degraded/failed nodes, node count, edge count, and per-node dependency traversal.

**Data sources**:
- `GET /api/v1/twins/graph/overview` — node/edge counts, degraded list
- `GET /api/v1/twins/:twinId/traverse` — on node selection

**Interactions**: Click a node card → BFS traversal panel loads with depth, criticality score, cycle detection, and impacted entity list.

---

### ReadinessPropagationGraph
**File**: `src/components/ReadinessPropagationGraph.tsx`
**Purpose**: Portfolio-level readiness view with conflict browser.

**Data sources**:
- `GET /api/v1/portfolio/readiness`
- `GET /api/v1/portfolio/conflicts`

**Interactions**: Tab between readiness bars (sorted ascending by score) and conflict cards (expandable, sorted by severity).

---

### TemporalTimelineViewer
**File**: `src/components/TemporalTimelineViewer.tsx`
**Purpose**: Time-travel and state change analysis for a specific twin.

**Data sources**:
- `GET /api/v1/twins/:twinId/snapshots`
- `GET /api/v1/scenarios/temporal/:twinId/diff`
- `GET /api/v1/scenarios/temporal/:twinId/velocity`

**Interactions**: Three tabs — snapshot replay (click to expand state JSON), date-range diff (highlights changed fields), velocity gauge.

---

### RiskPropagationPanel
**File**: `src/components/RiskPropagationPanel.tsx`
**Purpose**: Risk propagation from a root twin through the dependency graph.

**Data source**: `GET /api/v1/twins/:twinId/risk-propagation`

**Interactions**: UUID input → propagation result with sorted bar chart, critical node badges, propagation path visualization.

---

### OperationalForecastPanel
**File**: `src/components/OperationalForecastPanel.tsx`
**Purpose**: Forward projection of readiness with confidence bands.

**Data sources**:
- `GET /api/v1/scenarios/projection/:twinId`
- `GET /api/v1/portfolio/forecast`

**Features**: Configurable horizon (7/14/30/60/90d), SVG mini-chart with confidence band shading, SLA breach probability, cache validity indicator.

---

### CrossProjectHeatmap
**File**: `src/components/CrossProjectHeatmap.tsx`
**Purpose**: Heatmap grid of all project twins colored by readiness or risk.

**Data sources**:
- `GET /api/v1/portfolio/readiness`
- `GET /api/v1/portfolio/bottlenecks`

**Features**: Toggle readiness/risk mode, hover tooltip with exact scores, upcoming bottleneck list below.

---

### SiteClusterDashboard
**File**: `src/components/SiteClusterDashboard.tsx`
**Purpose**: Multi-site overview with status rings and sync freshness.

**Data source**: `GET /api/v1/twins?entityType=site&limit=50`

**Features**: Status ring colors, stale sync amber dot, sortable by readiness/risk/name, aggregate metrics bar.

---

### AnomalyRadar
**File**: `src/components/AnomalyRadar.tsx`
**Purpose**: Real-time anomaly browser with severity filters and resolution controls.

**Data sources**:
- `GET /api/v1/portfolio/anomalies`
- `POST /api/v1/portfolio/anomalies/detect`
- `POST /api/v1/portfolio/anomalies/:id/resolve`
- `POST /api/v1/portfolio/anomalies/:id/false-positive`

**Features**: Filter by severity, detect-now button, expandable actions, resolve/false-positive controls.

---

### AssetHealthPanel
**File**: `src/components/AssetHealthPanel.tsx`
**Purpose**: Per-asset health score breakdown and maintenance recommendation list.

**Data sources**:
- `GET /api/v1/portfolio/maintenance/health/:twinId`
- `GET /api/v1/portfolio/maintenance/recommendations`

**Features**: Five-component gauge grid (SVG radial), trend indicator (↑/→/↓), priority-colored maintenance cards.

---

### ScenarioSimulationPanel
**File**: `src/components/ScenarioSimulationPanel.tsx`
**Purpose**: What-if simulation builder and result viewer.

**Data sources**:
- `POST /api/v1/scenarios`
- `POST /api/v1/scenarios/:id/run`

**Features**: Event injection builder (type, target, offset), scenario type selector, results panel with delta metrics and mitigation recommendations.

## Design Conventions

- **Colors**: emerald = healthy/good, amber = warning, red = critical, violet = primary action
- **Loading states**: Inline text placeholders (no skeleton spinners)
- **Error states**: Red bordered message boxes
- **Empty states**: Centered zinc-500 text with context
- **Data refresh**: Load-on-mount or user-triggered button; no polling loops
