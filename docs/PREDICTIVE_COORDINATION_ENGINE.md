# Predictive Coordination Engine

**Denver Engineering — Ava Phase 6 (v6.0.0)**

## Overview

The Predictive Coordination Engine detects cross-project conflicts before they materialize, forecasts portfolio-wide bottlenecks, and generates actionable coordination recommendations.

## Portfolio Readiness

```typescript
computePortfolioReadiness(tenantId): Promise<PortfolioReadiness>
```

Aggregates readiness scores across all active project-type twins:
- `averageReadiness`: weighted mean of `readiness_score` values
- `readinessByProject`: map of `projectId → score`
- `atRiskProjects`: projects where readiness < 60% OR risk > 70%
- `topRisks`: top 5 project IDs by risk score

Updated on every twin sync; cached in `operational_forecasts` with 1-hour TTL.

## Conflict Detection

Three conflict types are detected:

### 1. Shared Resource Overload
Identifies assignees working across 2+ projects with 5+ open actions due within 14 days:
```sql
GROUP BY assignee_id HAVING COUNT(*) >= 5 AND COUNT(DISTINCT project_id) >= 2
```
**Severity**: High if ≥ 15 actions, Medium otherwise.
**Resolution**: Rebalance workload or extend lower-priority action timelines.

### 2. Timeline Overlap
Identifies weeks where 3+ projects have 20+ actions due simultaneously:
```sql
GROUP BY week HAVING COUNT(DISTINCT project_id) >= 3 AND COUNT(*) >= 20
```
**Severity**: High if 5+ projects, Medium otherwise.
**Resolution**: Stagger deadlines or add capacity for that week.

### 3. Dependency Bottleneck
Identifies projects with 3+ blocked actions due within 7 days:
```sql
WHERE status = 'blocked' AND due_date <= now() + interval '7 days'
GROUP BY project_id HAVING COUNT(*) >= 3
```
**Severity**: Critical if ≥ 10, High otherwise.
**Resolution**: Escalate blockers; consider dependency re-routing.

## Bottleneck Forecasting

```typescript
forecastBottlenecks(tenantId, horizonDays = 30): Promise<Bottleneck[]>
```

Scans for action clusters (10+ actions due in the same week for the same project) within the forecast horizon. Returns bottleneck severity, projected date, and description.

**Severity scale:**
- ≥ 30 actions: critical
- ≥ 20 actions: high
- Otherwise: medium

## Conflict Severity Ordering

Conflicts are returned sorted by severity (critical → high → medium → low) so the most impactful items appear first in the UI.

## Integration with Agent System

The `RiskAgent` (Phase 5) calls `detectPortfolioConflicts` to populate its risk summary. The `ReadinessCoordinatorAgent` calls `computePortfolioReadiness` to assess overall portfolio health before issuing coordination recommendations.
