# Task Agent Design

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Purpose

The TaskAgent creates, assigns, and escalates corrective and safety actions autonomously within policy constraints.

## Capabilities

| Capability ID | Task Types | Approval Required |
|---------------|-----------|-------------------|
| `task.create` | `create_action`, `assign_action`, `bulk_assign` | No |
| `task.escalate` | `escalate_action`, `prioritize_actions` | **Yes** |

## Governance Level: Medium

## Task Type Behaviors

### `create_action`
Inserts a new action record with title and priority from payload. Records decision trace with rationale.

### `escalate_action`
Updates action priority to `critical` and sets `escalated_at`. Requires approval because escalation affects SLA timers and team notification behavior.

### `assign_action`
Updates `assigned_to` on an action. No approval required — assignments are reversible.

### `bulk_assign`
Batch assignment across multiple actions. Constrained by `assignment_restriction` policies.

## Decision Trace Fields

```typescript
{
  decisionType: 'task_routing',
  rationale: 'Executing {taskType} for scope {scopeId}',
  confidence: 90,
  alternatives: [],
  chosenAction: taskType,
}
```

## Required Context

- `tenant` — for RLS
- `scope` — to locate the target actions
- `policyConstraints` — assignment_restriction, freeze_condition

## Output Schema

```typescript
{
  actionId?: string    // for create_action
  escalated?: boolean  // for escalate_action
  status: string
}
```

## Policy Interactions

- `freeze_condition` blocks all task mutations when matched
- `assignment_restriction` limits who TaskAgent may assign to
- `approval_requirement` gates escalations behind human review
