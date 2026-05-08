# Resource Optimization Agent Design

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Purpose

The ResourceOptimizationAgent analyzes team workloads and proposes reassignments to balance utilization across team members.

## Capabilities

| Capability ID | Task Types | Approval Required |
|---------------|-----------|-------------------|
| `resource.balance` | `balance_workload`, `suggest_assignments`, `rebalance_team` | **Always** |

## Governance Level: High

High governance because:
- Reassignment affects people's work queues
- HR implications if redistributed unfairly
- `assignment_restriction` policies must be respected
- Changes are visible to affected users immediately

## Workload Analysis Algorithm

```
SELECT assigned_to, COUNT(*) as cnt
FROM actions
WHERE tenant_id = $1 AND status = 'open' AND assigned_to IS NOT NULL
GROUP BY assigned_to
ORDER BY cnt DESC
LIMIT 20

overloaded = users with cnt > 10
suggestions = overloaded.map(u => ({ userId, currentCount, suggestion: 'redistribute' }))
utilizationDelta = -(overloaded.length × 2)
```

## Output Schema

```typescript
{
  assignments: Array<{
    userId: string
    currentCount: number | string
    suggestion: 'redistribute' | 'defer' | 'accept'
  }>
  utilizationDelta: number   // negative = work reduced for overloaded users
}
```

## Memory Usage

Stores workload snapshots for trend analysis:
```typescript
{
  memoryType: 'pattern',
  key: 'workload_distribution',
  value: { overloadedCount, avgWorkload, capturedAt },
}
```

## Policy Interactions

- `assignment_restriction` — agent respects any restrictions on who can be assigned
- All proposals are approval-gated before any actual reassignment occurs
