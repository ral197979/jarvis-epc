# Scheduling Agent Design

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Purpose

The SchedulingAgent optimizes task and inspection scheduling, identifies calendar conflicts, and proposes resolution strategies.

## Capabilities

| Capability ID | Task Types | Approval Required |
|---------------|-----------|-------------------|
| `schedule.optimize` | `optimize_schedule`, `resolve_conflicts`, `auto_schedule` | **Always** |

## Governance Level: Medium

All scheduling tasks require approval because:
- Schedule changes affect real people's calendars
- Conflicts may exist the agent is unaware of
- Reversing schedule changes is costly

## Output Schema

```typescript
{
  scheduleUpdates: Array<{
    itemId: string
    oldDate: string
    newDate: string
    reason: string
  }>
  conflicts: Array<{
    itemId: string
    conflictWith: string
    resolution: string
  }>
  optimized: boolean
}
```

## Approval Flow

1. SchedulingAgent calls `requestApproval` with proposed schedule changes as `payload`
2. Human reviews the changes in `AgentApprovalPanel`
3. If approved, `resumeFromApproval` re-queues the task for actual execution
4. If rejected, the existing schedule is preserved

## Policy Interactions

- `after_hours_restriction` prevents scheduling tasks outside business hours
- `freeze_condition` blocks scheduling during audit periods
- `assignment_restriction` limits which users can be assigned to scheduled items
