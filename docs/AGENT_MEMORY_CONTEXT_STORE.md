# Agent Memory and Context Store

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Overview

Agents accumulate domain knowledge across executions. The memory store is a persistent, queryable knowledge base with an associative graph layer for linking related memories.

## Memory Types

| Type | Description | Example |
|------|-------------|---------|
| `fact` | Verified factual information | "Project Alpha has 3 critical SLA breaches" |
| `pattern` | Observed recurring behavior | "Monday mornings see 40% more escalations" |
| `preference` | Configuration or user preferences | "Team lead prefers email over Slack" |
| `outcome` | Results of past agent actions | "Risk score was 65 after last assessment" |

## Scope Hierarchy

| Scope | Description |
|-------|-------------|
| `global` | Shared across all agents/scopes for tenant |
| `project` | Specific to a project ID |
| `workflow` | Specific to a workflow ID |
| `action` | Specific to an individual action |

## Schema: `agent_memory_entries`

Key fields:
- `(tenant_id, agent_type, scope_type, scope_id, key)` — unique constraint enables upsert
- `confidence` — 0–100 score; entries sorted by confidence descending
- `times_accessed` / `last_accessed` — usage tracking
- `expires_at` — TTL for time-limited facts

## Schema: `agent_memory_links`

Associative graph connecting related memories:

| Link Type | Meaning |
|-----------|---------|
| `related` | General association |
| `caused_by` | Causal relationship |
| `contradicts` | Conflicting information |
| `supports` | Corroborating evidence |

`strength` (0–1) indicates link confidence.

## API

```typescript
storeMemory(input: StoreMemoryInput): Promise<AgentMemoryEntry>
// Upserts on (tenant_id, agent_type, scope_type, scope_id, key)

recallMemory(tenantId, agentType, scopeType, scopeId, key)
// Returns entry + increments times_accessed

queryMemory(tenantId, filters: { agentType?, scopeType?, scopeId?, memoryType?, minConfidence?, limit? })
// Returns entries ordered by confidence DESC

forgetMemory(tenantId, agentType, scopeType, scopeId, key): Promise<boolean>
// Hard deletes an entry

linkMemory(tenantId, fromEntryId, toEntryId, linkType, strength?)
// Upserts a link

getLinkedMemories(tenantId, entryId, linkType?): Promise<AgentMemoryEntry[]>
// Returns linked entries ordered by strength DESC

purgeExpiredMemory(tenantId): Promise<number>
// Deletes all expired entries, returns count
```

## Context Assembly

`buildAgentContext()` assembles the runtime context package:
1. Tenant metadata
2. Scope metadata (project/workflow/action record)
3. Recent events from `realtime_event_log` (last 50)
4. Active alerts (sla_breached, action_escalated, blocker_added in last 24h)
5. Memory entries (top 20 by confidence for agent + scope)

Policy constraints are injected after governance check via `injectPolicyConstraints()`.

## Memory Lifecycle

1. Agent executes and produces outcome
2. `storeMemory` called with `sourceExecutionId` for traceability
3. Future executions call `buildAgentContext` which includes memory
4. Agent uses memory to make better decisions
5. Conflicting memories linked with `contradicts` for human review
6. Expired memories auto-purged by `purgeExpiredMemory` (cron job)
