# Cross-Project Orchestration

**Denver Engineering — Ava Phase 6 (v6.0.0)**

## Overview

Cross-project orchestration detects and resolves conflicts that span project boundaries. It operates at the portfolio level, using twin data to identify shared resource contention, timeline overlaps, and dependency bottlenecks before they cascade.

## Architecture

```
Portfolio Twin Layer
    ↓
PortfolioReadiness.readinessByProject
    ↓
detectPortfolioConflicts() → [Conflict, ...]
    ↓
RiskAgent / ReadinessCoordinatorAgent
    ↓
Recommendations → Approvals → Actions
```

## Conflict Types

### Resource Contention
An assignee has 5+ open actions due within 14 days across 2+ projects. The system identifies the projects and severity, then recommends workload rebalancing.

**Detection query pattern:**
```sql
SELECT assignee_id, array_agg(DISTINCT project_id), COUNT(*) as open_count
FROM actions
WHERE status NOT IN ('done','cancelled')
  AND due_date <= now() + interval '14 days'
GROUP BY assignee_id
HAVING COUNT(*) >= 5 AND COUNT(DISTINCT project_id) >= 2
```

### Timeline Overlap
Multiple projects have a high concentration of actions due in the same calendar week. When 3+ projects share a peak week with 20+ combined actions, coordination is required.

### Dependency Bottleneck
A project has 3+ blocked actions due within 7 days, indicating a critical path blockage that affects downstream projects.

## Resolution Strategies

| Conflict | Strategy |
|---------|---------|
| Resource contention | Rebalance assignments or extend lower-priority timelines |
| Timeline overlap | Stagger deadlines; allocate additional surge capacity |
| Dependency bottleneck | Escalate blocker; consider dependency re-routing via graph traversal |

## Bottleneck Forecast

`forecastBottlenecks(tenantId, horizonDays)` scans future action clusters to give project managers advance warning:

- 1–2 weeks notice: minor adjustments
- 3–4 weeks notice: workforce planning
- 5+ weeks notice: schedule restructuring

## Output: PortfolioConflict

```typescript
interface PortfolioConflict {
  conflictType: string
  severity: AnomalySeverity        // low/medium/high/critical
  involvedProjectIds: string[]
  description: string
  suggestedResolution: string
}
```

Results are sorted critical-first for efficient triage.

## Agent Integration

The `ReadinessCoordinatorAgent` calls `detectPortfolioConflicts` as part of its `coordinate_readiness` task and includes results in its handoff to the `RiskAgent`. The `RiskAgent` incorporates conflict count into its risk summary.

## Governance

All cross-project coordination recommendations go through the Policy Engine before becoming agent actions. Policies can:
- Block recommendations during freeze periods
- Require human approval for multi-project scope changes
- Restrict after-hours automated actions
