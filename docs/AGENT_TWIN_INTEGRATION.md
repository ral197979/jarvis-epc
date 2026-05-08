# Agent-Twin Integration

**Denver Engineering — Ava Phase 6 (v6.0.0)**

## Overview

Phase 6 twins are first-class data sources for Phase 5 agents. Every agent task that involves risk, readiness, or maintenance can read from the twin layer, and agents can trigger twin mutations (sync, status updates) as governed actions.

## Data Flow: Agents → Twins

```
Agent Task Start
    ↓
buildAgentContext()
    ↓
Fetches: recentEvents, activeAlerts, memoryEntries
    +
Twin data (readiness, risk, health scores from operational_twins)
    ↓
Agent executes with full operational context
    ↓
(Optionally) Agent calls syncTwin / updateTwinStatus / captureSnapshot
via governed action (checkGovernance → approve → execute)
```

## Context Builder Integration

The `agentContextBuilder` was extended in Phase 6 to include twin scores in the operational snapshot:

```typescript
// In buildAgentContext:
const twinData = await tenantQuery(tenantId,
  `SELECT entity_id, readiness_score, risk_score, health_score
   FROM operational_twins WHERE tenant_id = $1 AND entity_type = 'project'`,
  [tenantId]
)
context.operationalSnapshot.twinReadiness = Object.fromEntries(
  twinData.rows.map(r => [r.entity_id, Number(r.readiness_score ?? 50)])
)
```

## Agent-Specific Integration Points

### RiskAgent
- Calls `detectAnomalies()` → adds detected anomalies to risk analysis
- Calls `propagateRisk()` on the twin graph → identifies downstream impact
- Calls `detectPortfolioConflicts()` → surfaces cross-project risks
- Outputs: `riskScore`, `criticalNodes`, `conflictCount`

### ReadinessCoordinatorAgent
- Calls `computePortfolioReadiness()` → gets current readiness snapshot
- Calls `listTwins()` filtered by `status = 'degraded'` → identifies problem twins
- Calls `forecastBottlenecks()` → projects upcoming pressure points
- Outputs: readiness assessment, coordination recommendations

### SchedulingAgent
- Reads maintenance recommendations from `maintenanceForecastEngine`
- Creates scheduled actions for recommended maintenance windows
- Links actions back to equipment twins via `twinSync`

### ValidationAgent
- Verifies twin snapshots using `verifySnapshot()` (SHA-256 check)
- Reads `TwinStateSnapshot.diff` to validate that expected changes occurred
- Rejects validation if checksum mismatch detected

## Governed Twin Mutations

Twin mutations from agents go through the same governance layer as all agent actions:

```typescript
const govResult = await checkGovernance(task, tenantId, agentType)
if (!govResult.allowed) throw new PolicyBlockedError(govResult.blockingReason)
if (govResult.requiresApproval) {
  await requestApproval(...)
  return { status: 'requires_approval' }
}
// Only then:
await syncTwin(tenantId, twinId, newState)
```

## Memory Integration

Agents store twin-related insights in their memory store:

```typescript
await storeMemory({
  tenantId, agentType: 'RiskAgent',
  scopeType: 'twin', scopeId: twinId,
  key: 'last_risk_assessment',
  value: { score: 72, criticalNodes: [...] },
  confidence: 0.85,
})
```

This allows subsequent tasks to recall prior assessments and detect trends over time.
