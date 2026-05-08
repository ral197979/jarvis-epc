# Readiness Coordinator Agent Design

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Purpose

The ReadinessCoordinatorAgent assesses operational readiness scores, identifies gaps, and generates improvement plans. It is the primary agent for the `assess_readiness` objective.

## Capabilities

| Capability ID | Task Types | Approval Required |
|---------------|-----------|-------------------|
| `readiness.assess` | `assess_readiness`, `generate_readiness_plan` | No |
| `readiness.coordinate` | `coordinate_readiness`, `trigger_remediation` | **Yes** |

## Governance Level: Medium

## Readiness Scoring Algorithm

```
SELECT
  COUNT(*) FILTER (WHERE status = 'open')      AS open_count,
  COUNT(*) FILTER (WHERE status = 'completed') AS done_count
FROM actions WHERE tenant_id = $1

readinessScore = total = 0 ? 100 : ROUND((done_count / total) × 100)

gaps = []
if open_count > 10 → 'High number of open actions'
if readinessScore < 60 → 'Readiness below acceptable threshold'
```

## Memory Persistence

After each assessment, stores:
```typescript
storeMemory({
  memoryType: 'outcome',
  key: 'last_readiness_score',
  value: { score, openCount, doneCount, at },
  confidence: 95,
  sourceExecutionId,
})
```

Future assessments compare against this baseline to detect trends.

## Output Schema

```typescript
{
  readinessScore: number   // 0–100
  gaps: string[]           // gap descriptions
  plan: {
    openCount: number
    doneCount: number
  }
}
```

## Objective: `assess_readiness`

Full task plan:
```
1. assess_readiness (ReadinessCoordinatorAgent, no approval)
2. validate_evidence (ValidationAgent, no approval, depends on 1)
3. analyze_risk (RiskAgent, no approval, depends on 1)
4. generate_readiness_plan (ReadinessCoordinatorAgent, no approval, depends on 2+3)
```

## Integration

- Phase 3 `ReadinessEngine` provides the underlying readiness score data
- Results feed into `ExecutiveOverviewPage` readiness indicators
- Works alongside `RiskAgent` — low readiness + high risk triggers escalation
