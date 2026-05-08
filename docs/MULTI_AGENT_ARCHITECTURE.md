# Multi-Agent Architecture

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Overview

The Multi-Agent Operational Intelligence system provides a coordinated fleet of specialized AI agents that collaborate to analyze, plan, validate, and execute operational improvements across the Denver Engineering platform. Every agent action is policy-constrained, human-reviewable, auditable, replayable, and tenant-isolated.

## Core Principles

- **Policy-first** — every agent action is evaluated against Phase 4 Policy Engine rules before execution
- **Human-in-the-loop** — high-risk actions require explicit human approval before proceeding
- **Immutable ledger** — all executions are recorded in `agent_executions` (INSERT-only via DB rules)
- **Explainability** — decision traces record rationale, confidence, and alternatives considered
- **Memory persistence** — agents accumulate domain knowledge across executions
- **Tenant isolation** — all tables RLS-gated; no cross-tenant data access possible

## System Components

```
AgentCommandCenter (UI)
    ↓
AgentOrchestrator
    ↓ plans via
AgentRouter ←── AgentRegistry (8 agents, capability catalog)
    ↓ queues via
AgentTaskQueue ←── FOR UPDATE SKIP LOCKED
    ↓ workers claim
AgentWorker
    ↓ enforces via
AgentGovernanceService ←── AgentPolicyAdapter ←── Phase 4 PolicyEngine
    ↓ builds via
AgentContextBuilder ←── DB (events, alerts, memory)
    ↓ executes
Individual Agent (TaskAgent | ValidationAgent | ...)
    ↓ records in
AgentExecutionLedger (immutable) + AgentMemoryService
    ↓ handoffs via
AgentHandoffService
```

## Agent Fleet

| Agent | Governance | Approval Required |
|-------|-----------|-------------------|
| TaskAgent | medium | For escalation tasks |
| ValidationAgent | medium | For compliance checks |
| DocumentationAgent | low | Never |
| RiskAgent | high | For mitigations |
| SchedulingAgent | medium | Always |
| ResourceOptimizationAgent | high | Always |
| IncidentResponseAgent | high | For coordination |
| ReadinessCoordinatorAgent | medium | For coordination |

## Execution Lifecycle

```
enqueueTask → claimNextTask (FOR UPDATE SKIP LOCKED)
  → openExecution (immutable record)
  → checkGovernance (PolicyEngine integration)
  → buildAgentContext (tenant + scope + memory)
  → executeAgent (domain-specific logic)
  → recordDecision (rationale + alternatives)
  → completeTask OR failTask (with retry)
  → closeExecution (append execution_closed event)
```

## Handoff Protocol

When an agent determines a different agent is better suited:
1. `initiateHandoff` — creates handoff with context package and TTL
2. Receiving agent calls `acceptHandoff` within TTL
3. Receiving agent executes and calls `completeHandoff`
4. Expired handoffs are automatically `timed_out`

## API Surface

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/agents` | List registered agents |
| GET | `/api/v1/agents/capabilities` | Capability catalog |
| POST | `/api/v1/agents/plan` | Dry-run execution plan |
| POST | `/api/v1/agents/execute` | Execute an objective |
| GET | `/api/v1/agents/tasks` | List tasks |
| GET | `/api/v1/agents/executions` | List executions |
| GET | `/api/v1/agents/executions/:id` | Execution + events + traces |
| GET | `/api/v1/agents/approvals` | Pending approvals |
| POST | `/api/v1/agents/approvals/:id/approve` | Approve an action |
| POST | `/api/v1/agents/approvals/:id/reject` | Reject an action |
| GET | `/api/v1/agents/memory` | Query memory store |
| POST | `/api/v1/agents/risk/analyze` | Trigger risk analysis |
| POST | `/api/v1/agents/readiness/coordinate` | Coordinate readiness |
