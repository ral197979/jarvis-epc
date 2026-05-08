# Adaptive Intelligence Architecture

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

Phase 7 introduces a continuous learning layer above the Phase 6 Digital Twin system. Every recommendation, forecast, anomaly detection, and scenario simulation is now observed, measured, and used to improve future decisions. Learning is immutable and explainable — all signals are stored as append-only records, and every calibration factor carries a human-readable explanation.

## Core Principles

### 1. Observe Everything
Every system output that can have a real-world outcome is tracked:
- Agent recommendations → `recommendation_outcomes`
- Forecast values vs actuals → `forecast_accuracy_history`
- Anomaly detections (true/false positive) → `learning_feedback`
- Scenario simulation predictions vs outcomes → `learning_feedback`

### 2. Immutable Feedback History
The `learning_feedback` table is append-only. No record is ever deleted or modified. This provides a complete causal chain from input to outcome.

### 3. Tenant-Scoped Learning
All learning is scoped per tenant. No cross-tenant signal bleed. Each tenant's calibration factors, thresholds, and memory are completely isolated.

### 4. Explainable Calibration
When the system adjusts a forecast, `adjustmentExplained` provides a human-readable string:
```
"8% downward adjustment based on 20 historical observations (MAE: 5.2)"
```

### 5. Governance Preserved
No learning trigger autonomous execution. All optimization proposals require human approval before application (`status = 'proposed' → 'approved' → 'applied'`).

## Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Phase 7: Adaptive Layer                   │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Learning     │  │ Forecast     │  │ Recommendation   │  │
│  │ Loop Engine  │  │ Calibration  │  │ Ranking Engine   │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Resource     │  │ Root Cause   │  │ Operational      │  │
│  │ Optimizer    │  │ Synthesis    │  │ Memory Engine    │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Adaptive     │  │ Optimization │  │ Simulation       │  │
│  │ Anomaly Eng  │  │ Coordinator  │  │ Learning Service │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
           ↓ reads from / writes to
┌─────────────────────────────────────────────────────────────┐
│               Phase 6: Digital Twin Layer                   │
│  operational_twins, twin_state_snapshots, ...               │
└─────────────────────────────────────────────────────────────┘
```

## Database Tables (Phase 7)

| Table | Purpose |
|-------|---------|
| `learning_feedback` | Immutable append-only signal log |
| `recommendation_outcomes` | Effectiveness per recommendation |
| `forecast_accuracy_history` | Predicted vs actual values |
| `optimization_feedback` | Optimization proposals and their outcomes |

## API Surface

| Mount | Purpose |
|-------|---------|
| `POST /api/v1/adaptive/feedback` | Record a learning signal |
| `GET /api/v1/adaptive/feedback/health` | Learning system health report |
| `POST /api/v1/adaptive/calibrate` | Apply calibration to a prediction |
| `POST /api/v1/adaptive/rank` | Rank candidate recommendations |
| `POST /api/v1/optimization/strategy` | Generate strategy plan |
| `POST /api/v1/optimization/consensus` | Build multi-agent consensus |
| `POST /api/v1/optimization/root-cause` | Synthesize root cause |
