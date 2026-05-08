# Risk Agent Design

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Purpose

The RiskAgent analyzes operational risk across projects and workflows, scoring risk levels and recommending targeted mitigations.

## Capabilities

| Capability ID | Task Types | Approval Required |
|---------------|-----------|-------------------|
| `risk.analyze` | `analyze_risk`, `score_risk`, `flag_risk` | No |
| `risk.mitigate` | `recommend_mitigation`, `auto_mitigate` | **Yes** |

## Governance Level: High

## Risk Scoring Algorithm

```
criticalCount = COUNT(actions WHERE status='open' AND priority IN ('high','critical'))
riskScore = MIN(100, criticalCount × 10)
level = riskScore ≥ 70 → 'high' | riskScore ≥ 40 → 'medium' | 'low'
```

Mitigations are generated when:
- `criticalCount > 5` → "Escalate to senior management"
- `criticalCount > 2` → "Assign dedicated resource to clear backlog"

## Memory Persistence

After each analysis, RiskAgent stores:
```typescript
storeMemory({
  memoryType: 'outcome',
  key: 'last_risk_score',
  value: { riskScore, level, criticalCount, at: timestamp },
  confidence: 95,
})
```

Future analyses use historical scores as baseline for trend detection.

## Output Schema

```typescript
{
  riskScore: number    // 0–100
  level: 'low' | 'medium' | 'high' | 'critical'
  mitigations: string[]
}
```

## Decision Trace

```typescript
{
  decisionType: 'risk_assessment',
  rationale: '{N} critical actions found, risk score {score}',
  confidence: 80,
  alternatives: [{ action: 'defer', reason: 'Low urgency', confidence: 20, rejected: true }],
  policyContext: { criticalCount },
  chosenAction: level,
}
```

## Policy Interactions

- `ai_confidence_minimum` policy gates risk flags — scores below threshold are rejected
- `freeze_condition` prevents risk mitigation actions during maintenance windows
- All `auto_mitigate` actions require explicit human approval
