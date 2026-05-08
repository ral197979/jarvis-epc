# Agent Handoff Protocol

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Overview

When an agent determines it cannot fully complete a task, it initiates a formal handoff to a more capable agent. The handoff is a first-class DB record with a TTL and acceptance protocol.

## Handoff Lifecycle

```
pending → accepted → completed
                   ↘ timed_out (if TTL expires before acceptance)
        ↘ rejected (receiving agent declines)
```

## API

```typescript
initiateHandoff(request: HandoffRequest): Promise<AgentHandoff>
// Creates handoff with context package; default TTL = 5 minutes

acceptHandoff(handoffId, tenantId): Promise<AgentHandoff>
// Transitions pending → accepted; fails if expired

rejectHandoff(handoffId, tenantId): Promise<AgentHandoff>
// Transitions pending → rejected

completeHandoff(handoffId, tenantId): Promise<AgentHandoff>
// Transitions accepted → completed

getPendingHandoffs(tenantId, toAgent): Promise<AgentHandoff[]>
// Lists active pending handoffs for a receiving agent

expireTimedOutHandoffs(tenantId): Promise<number>
// Marks expired pending handoffs as timed_out
```

## Context Package

The `contextPackage` field carries everything the receiving agent needs:
```typescript
{
  // What was accomplished so far
  priorResults: Record<string, unknown>
  // Why we're handing off
  reason: string
  // Relevant domain data the receiver needs
  payload: Record<string, unknown>
}
```

## Schema: `agent_handoffs`

| Column | Description |
|--------|-------------|
| `from_agent` | Originating agent type |
| `to_agent` | Receiving agent type |
| `task_id` | Task being handed off |
| `context_package` | Domain context for receiver |
| `expires_at` | TTL for acceptance |
| `status` | pending / accepted / rejected / completed / timed_out |

## TTL and Expiry

Default TTL is 300 seconds (5 minutes). The `expireTimedOutHandoffs` function is called periodically by the worker loop. Expired handoffs cause the originating task to be retried.

## Common Handoff Patterns

| From | To | Reason |
|------|----|--------|
| TaskAgent | ValidationAgent | Validate before closing |
| ValidationAgent | DocumentationAgent | Generate compliance report |
| IncidentResponseAgent | RiskAgent | Deep risk analysis during incident |
| ReadinessCoordinatorAgent | ValidationAgent | Verify evidence before readiness sign-off |
