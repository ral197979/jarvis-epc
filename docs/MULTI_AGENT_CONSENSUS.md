# Multi-Agent Consensus

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

The optimization coordinator aggregates recommendations and decisions from multiple Phase 5 agents (RiskAgent, ReadinessCoordinatorAgent, SchedulingAgent, ValidationAgent) into a unified, conflict-resolved output. When agents disagree, the consensus algorithm identifies the majority position and lists conflicting agents.

## Consensus Algorithm

```typescript
// 1. Group votes by value
// 2. Sort by (total votes DESC, total confidence DESC)
// 3. Winner = highest-ranked group
// 4. consensusConfidence = (winnerAvgConf × winnerCount) / totalVotes
// 5. conflictingAgents = all agents NOT in the winning group
```

### Tie Breaking

If two options receive equal vote counts, the option with higher total confidence wins. This prevents arbitrary tie breaks and rewards more confident agents.

## Conflict Detection

When coordinating recommendations from multiple agents, conflicts are detected when the same entity is targeted with different action types:

```typescript
// If entityId 'proj-123' receives both 'risk_reduction' (from RiskAgent)
// and 'readiness_boost' (from ReadinessCoordinatorAgent), that's a conflict
conflicts: [{ entityId: 'proj-123', conflictingAgents: ['RiskAgent', 'ReadinessCoordinatorAgent'] }]
```

Conflicts are surfaced in the `coordinateRecommendations()` output. The unified ranked list still includes all recommendations — humans resolve conflicts by selecting the highest-scored one.

## API

### Build Consensus
```
POST /api/v1/optimization/consensus
{
  "topic": "Should we delay deployment?",
  "votes": [
    { "agentType": "RiskAgent", "vote": "yes", "confidence": 0.9, "rationale": "Risk too high" },
    { "agentType": "SchedulingAgent", "vote": "no", "confidence": 0.6, "rationale": "Deadline pressure" }
  ]
}
→ {
  "consensus": "yes",
  "consensusConfidence": 0.75,
  "conflictingAgents": ["SchedulingAgent"],
  ...
}
```

### Coordinate Recommendations
```
POST /api/v1/optimization/coordinate
{
  "inputs": [
    { "agentType": "RiskAgent", "recommendations": [ { "id": "r1", "type": "risk_reduction", ... } ] },
    { "agentType": "ReadinessCoordinatorAgent", "recommendations": [ { "id": "r2", ... } ] }
  ]
}
→ { "unified": [...], "conflicts": [...], "topPriority": [...] }
```

## ConsensusDecisionViewer

The `ConsensusDecisionViewer` frontend component provides an interactive UI for:
- Inputting agent votes with confidence levels
- Running consensus calculations
- Viewing conflict breakdown
- Displaying confidence percentage prominently

## Governance

Consensus is advisory only. The system cannot execute an action based purely on agent consensus — a human approval step is always required for operations that modify twin state, schedule work, or apply optimizations.
