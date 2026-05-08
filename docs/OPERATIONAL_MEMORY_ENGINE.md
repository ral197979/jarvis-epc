# Operational Memory Engine

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

The operational memory engine provides cross-session persistent knowledge storage for Phase 5 agents. Unlike the phase 5 `agent_memory` table (which stores raw key-value pairs), the Phase 7 engine adds confidence decay, reinforcement, and TTL-based expiry.

## Storage Model

Memory entries extend the Phase 5 `agent_memory` table with Phase 7-specific metadata in the `metadata` JSONB field:

```json
{
  "decayRate": 0.01,         // confidence reduction per day
  "expiresAt": "2024-12-31"  // optional hard expiry
}
```

## Confidence Decay

Over time, memories become less reliable. Decay is applied on demand via `applyMemoryDecay()`:

```sql
confidence = GREATEST(0.1, confidence - (
  EXTRACT(EPOCH FROM (now() - updated_at)) / 86400.0
  × COALESCE((metadata->>'decayRate')::float, 0.01)
))
```

- Minimum confidence: 0.1 (never fully forgotten, but flagged as unreliable)
- Default decay rate: 1% per day
- Agents can set higher decay for volatile knowledge (e.g., `decayRate: 0.1`)

## Memory Reinforcement

When new observations confirm an existing memory, `reinforceMemory()` boosts its confidence:
```typescript
await reinforceMemory(tenantId, agentType, scopeType, scopeId, key, confidenceBoost: 0.05)
```

Confidence is capped at 1.0.

## API

```
POST /api/v1/adaptive/memory           — Store/upsert memory
GET  /api/v1/adaptive/memory           — List memories (filterable)
GET  /api/v1/adaptive/memory/:agent/:scope/:key  — Recall specific memory
POST /api/v1/adaptive/memory/decay     — Apply decay to a scope
POST /api/v1/adaptive/memory/reinforce — Boost confidence
```

## Error Handling

All memory operations gracefully handle missing `agent_memory` tables (Phase 5 not deployed) by returning `null` or `0` instead of throwing. This allows Phase 7 to be deployed incrementally without requiring Phase 5.

## Integration

RiskAgent example:
```typescript
// After risk assessment:
await storeMemory(tenantId, {
  scopeType: 'project', scopeId: projectId,
  agentType: 'RiskAgent',
  key: 'last_risk_assessment',
  value: { score: 72, criticalNodes: [...] },
  confidence: 0.85,
  decayRate: 0.05,  // risk assessments decay faster
})

// On next task:
const prior = await recallMemory(tenantId, {
  agentType: 'RiskAgent', scopeType: 'project',
  scopeId: projectId, key: 'last_risk_assessment',
})
if (prior != null && prior.confidence > 0.5) {
  // use prior assessment to seed current analysis
}
```
