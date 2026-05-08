# Agent Governance Model

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Overview

Every agent action passes through a multi-layer governance stack before execution. No mutation occurs without clearing policy checks. Human approval gates are enforced at the DB and service layers independently.

## Governance Layers

### Layer 1 — Policy Engine Integration

`agentPolicyAdapter.ts` evaluates 5 policy types before every execution:

| Policy Type | Effect |
|-------------|--------|
| `approval_requirement` | Adds human approval gate |
| `freeze_condition` | Blocks all mutations |
| `after_hours_restriction` | Blocks outside working hours |
| `assignment_restriction` | Limits who can be assigned |
| `ai_confidence_minimum` | Rejects low-confidence recommendations |

A `PolicyBlockedError` from the Phase 4 engine is caught and surfaced as `action: 'block'` in the `PolicyCheckResult`.

### Layer 2 — Governance Check

`agentGovernanceService.checkGovernance()` runs before every agent execution:

```typescript
checkGovernance({
  tenantId, agentType, taskType, executionId, payload
}) → GovernanceCheckResult {
  allowed: boolean
  requiresApproval: boolean
  policyChecks: PolicyCheckResult[]
  blockingReason?: string
  warnings: string[]
}
```

The result is appended to the execution event log for full traceability.

### Layer 3 — Agent-level Approval Queue

When `requiresApproval: true`:
1. Task transitions to `pending_approval` status
2. `AgentApproval` record created with TTL (default 24h)
3. Execution is paused until a human reviews
4. On approval → `resumeFromApproval` transitions task to `running`
5. On rejection → task stays cancelled; no execution occurs
6. On expiry → approval status set to `expired`

## Risk Levels

| Level | Color | Typical Use |
|-------|-------|-------------|
| `low` | Green | Informational changes |
| `medium` | Yellow | Assignments, re-prioritization |
| `high` | Orange | Escalations, bulk changes |
| `critical` | Red | Emergency responses, org-wide changes |

## Governance Level by Agent

| Agent | Level | Why |
|-------|-------|-----|
| DocumentationAgent | low | Read-only output |
| TaskAgent | medium | Mutates actions |
| ValidationAgent | medium | May block completions |
| SchedulingAgent | medium | Affects timelines |
| ReadinessCoordinatorAgent | medium | Cross-system writes |
| RiskAgent | high | Risk flags affect SLAs |
| ResourceOptimizationAgent | high | Reassigns work to users |
| IncidentResponseAgent | high | High-urgency mutations |

## Audit Trail

All governance decisions are recorded in:
- `agent_execution_events` — `governance_checked` event with check summary
- `agent_decision_traces` — rationale, alternatives, confidence per decision
- `agent_approvals` — immutable record of every human review

## Non-Negotiable Rules

1. No agent may mutate production data without a `checkGovernance` call
2. `PolicyBlockedError` always results in task failure, never silent bypass
3. Approval records are never deleted (no DELETE permission granted)
4. Decision traces are written before, not after, the action executes
