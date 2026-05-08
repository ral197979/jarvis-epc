# Adaptive Visualization Layer

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

Phase 7 adds 10 new frontend components that expose adaptive intelligence signals to operators. All components follow the Phase 6 design conventions (emerald/amber/red/violet, load-on-mount, no polling).

## Component Catalog

### AdaptiveObservabilityDashboard
**File**: `src/components/AdaptiveObservabilityDashboard.tsx`
**Purpose**: Master Phase 7 health view. Aggregates learning signal quality, 7-day feedback volume, optimization gain accuracy, and simulation accuracy into a single status grid.

**Data sources**:
- `GET /api/v1/adaptive/feedback/health`
- `GET /api/v1/optimization/proposals/summary`
- `GET /api/v1/adaptive/simulation-outcomes/stats`

**Features**: 6-tile status grid, color-coded by health threshold, system status indicators with dot.

---

### ForecastAccuracyPanel
**File**: `src/components/ForecastAccuracyPanel.tsx`
**Purpose**: Per-type forecast accuracy breakdown with MAE, RMSE, bias, calibration factor, and drift severity.

**Data sources**:
- `GET /api/v1/adaptive/forecast-accuracy/stats/:type`
- `GET /api/v1/adaptive/calibrate/drift/:type`

---

### DriftAnalysisPanel
**File**: `src/components/DriftAnalysisPanel.tsx`
**Purpose**: Time-series drift visualization. Plots absolute error over time with severity color dots. Supports filtering by type and unmeasured-only mode.

**Data source**: `GET /api/v1/adaptive/forecast-accuracy`

---

### ForecastDriftPanel
**File**: `src/components/ForecastDriftPanel.tsx`
**Purpose**: Drift overview across all forecast types + interactive calibration test form. Shows top 5 drift signals and lets operators test specific calibration scenarios.

**Data sources**:
- `GET /api/v1/adaptive/calibrate/drift/:type` (5 types)
- `POST /api/v1/adaptive/calibrate`

---

### RecommendationImpactGrid
**File**: `src/components/RecommendationImpactGrid.tsx`
**Purpose**: Two-tab view: top-ranked recommendations from DB history, and per-agent effectiveness breakdown with acceptance/rejection rates.

**Data sources**:
- `GET /api/v1/adaptive/rank/top`
- `GET /api/v1/adaptive/outcomes/effectiveness`

---

### RecommendationQualityPanel
**File**: `src/components/RecommendationQualityPanel.tsx`
**Purpose**: Filterable list of top recommendation outcomes with SVG radial effectiveness gauges per outcome.

**Data source**: `GET /api/v1/adaptive/outcomes/top`

---

### OptimizationCommandCenter
**File**: `src/components/OptimizationCommandCenter.tsx`
**Purpose**: Master optimization view: summary stats, pending proposal list with approve button, resource allocation view.

**Data sources**:
- `GET /api/v1/optimization/proposals/summary`
- `GET /api/v1/optimization/proposals?status=proposed`
- `GET /api/v1/optimization/resources`

**Interactions**: Approve button calls `POST /proposals/:id/approve`.

---

### ConsensusDecisionViewer
**File**: `src/components/ConsensusDecisionViewer.tsx`
**Purpose**: Interactive consensus builder. Operators input agent votes, run consensus, and view conflict breakdown.

**Data source**: `POST /api/v1/optimization/consensus`

---

### LearningLoopMetrics
**File**: `src/components/LearningLoopMetrics.tsx`
**Purpose**: Two-tab view: overall signal health by type with positive-rate bars, and anomaly detection patterns showing learned thresholds.

**Data sources**:
- `GET /api/v1/adaptive/feedback/health`
- `GET /api/v1/adaptive/anomaly-patterns`

---

### MitigationEffectivenessChart
**File**: `src/components/MitigationEffectivenessChart.tsx`
**Purpose**: Simulation outcome tracker. Shows predicted vs actual delta for each scenario with color-coded accuracy, expandable mitigation lists.

**Data sources**:
- `GET /api/v1/adaptive/simulation-outcomes`
- `GET /api/v1/adaptive/simulation-outcomes/stats`

## Design Conventions (Phase 7)

Identical to Phase 6:
- **Colors**: emerald = healthy/good, amber = warning, red = critical, violet = primary action
- **Loading states**: Inline text placeholders
- **Error states**: Red bordered message boxes
- **Empty states**: Centered zinc-500 text
- **Data refresh**: Load-on-mount or user-triggered; no polling
