# Validation Agent Design

**Denver Engineering — Ava Phase 5 (v5.0.0)**

## Purpose

The ValidationAgent checks evidence completeness, action completion criteria, and regulatory compliance before allowing workflows to advance.

## Capabilities

| Capability ID | Task Types | Approval Required |
|---------------|-----------|-------------------|
| `validation.evidence` | `validate_evidence`, `check_completeness` | No |
| `validation.compliance` | `compliance_check`, `regulatory_review` | **Yes** |

## Governance Level: Medium

## Task Type Behaviors

### `validate_evidence`
Queries `evidence_assets` for the target action. Returns `valid: false` with issue list if no evidence found. Score = 100 - (issues × 20), clamped to 0.

### `check_completeness`
Verifies all required fields on an action are populated before closure. No approval required.

### `compliance_check`
Reviews action against applicable regulatory requirements. Requires human approval because compliance failures may trigger mandatory reporting.

### `regulatory_review`
Deep review against project-level compliance rules. Always requires approval.

## Output Schema

```typescript
{
  valid: boolean
  issues: string[]
  score: number   // 0–100
}
```

## Integration Points

- Reads from `evidence_assets` table
- Used as a prerequisite step in `assess_readiness` and `validate_and_document` objective plans
- ValidationAgent is commonly the `to_agent` in handoffs from TaskAgent

## Decision Trace

```typescript
{
  decisionType: 'validation',
  rationale: 'All checks passed' | '{N} issues found',
  confidence: 85,
  chosenAction: 'pass' | 'fail',
}
```
