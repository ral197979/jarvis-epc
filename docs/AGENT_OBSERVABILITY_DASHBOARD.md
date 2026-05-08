# Agent Observability Dashboard

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Overview

Full observability across all agent executions with three levels of detail: task-level status, execution events, and decision traces.

## Frontend Components

### AgentCommandCenterPage
Main hub for agent operations:
- Launch objectives via the objective selector
- Monitor active tasks and executions
- Review pending approvals
- Refresh on demand

### AgentTaskTimeline
Visual execution timeline per task:
- Per-step status indicators (completed/running/failed/skipped)
- Duration per step
- Error details on failure
- Collapsible step layout

### AgentApprovalPanel
Human-in-the-loop review UI:
- Risk-level color coding (critical/high/medium/low)
- Payload inspection (expandable)
- Review notes textarea
- Approve / Reject buttons with confirmation
- Expiry countdown
- Previously reviewed decisions shown in history

### AgentDecisionTraceViewer
Explainability panel:
- Decision type badge
- Confidence bar (color-coded: green ≥80%, yellow ≥60%, red <60%)
- Chosen action highlighted in green
- Alternatives listed with rejection reasons
- Policy context (expandable JSON)

### AgentRiskSummary
Risk gauge card:
- SVG radial gauge with score
- Risk level with color indicator
- Mitigation recommendations
- Async polling via task ID

### AgentMemoryInspector
Memory store browser:
- Filter by agent type, memory type, scope
- Full-text search across keys and values
- Expandable value viewer
- Forget individual entries
- Expiry warnings

## Key Observability Data

### Per Execution
- `agent_execution_events` — ordered event sequence
- `agent_decision_traces` — rationale and alternatives
- `policy_checks` snapshot from governance check
- `input_snapshot` — immutable copy of what the agent received

### Aggregate
- Active task count by agent type and status
- Approval queue depth and age
- Memory utilization by scope
- Execution duration trends per agent type

## API Endpoints for Observability

```
GET /api/v1/agents/executions/:id
  → { execution, events[], traces[] }

GET /api/v1/agents/tasks?tenantId=&status=&agentType=&limit=
  → { tasks[] }

GET /api/v1/agents/approvals?tenantId=&agentType=
  → { approvals[] }

GET /api/v1/agents/memory?tenantId=&agentType=&scopeType=
  → { entries[] }
```

## Tracing an Execution

1. Find task via `GET /agents/tasks`
2. Get execution ID from `task.executionId`
3. Load `GET /agents/executions/:id` for events + traces
4. Events are ordered by `sequence_num ASC`
5. Each `governance_checked` event shows policy results
6. Each `agent_started` marks when domain logic ran
7. `execution_closed` event contains final output + duration
