# AI Recommendation Engine
**Denver Engineering — Ava Phase 3 (v4.35.0)**

## Purpose

The Recommendation Engine analyzes the current state of open actions and surfaces the highest-value next step a supervisor should take. Every recommendation is deterministic, explainable, and traceable to specific data signals.

## Design Philosophy

- **Deterministic first:** Rules produce consistent outputs for the same inputs. No randomness or opaque model weights in the base implementation.
- **Explainable:** Every recommendation includes a human-readable `reason` string and a numeric `confidence_score`.
- **Provider-extensible:** A `RecommendationProvider` interface allows future LLM-backed rerankers to replace or augment the rule engine without changing the API contract.

## Recommendation Input Schema

```typescript
interface RecommendationInput {
  actionId:        string
  actionTitle:     string
  actionType:      string
  priority:        string
  status:          string
  escalationLevel: number
  slaRemainingMins: number | null
  downstreamCount: number       // actions blocked by this one
  workloadScore:   number       // 0–100: assignee load
  reopenCount:     number       // times this action was reopened
  readinessImpact: number       // 0–100: impact on project readiness
}
```

## Recommendation Schema

```typescript
interface Recommendation {
  action_id:         string
  action_title:      string
  recommended_action: string    // 'escalate' | 'reassign' | 'resolve' | 'close' | 'prioritize' | 'pause'
  category:          string     // 'critical_path' | 'compliance' | 'sla' | 'workload' | 'quality'
  urgency_score:     number     // 0–100
  impact_score:      number     // 0–100
  confidence_score:  number     // 0–100
  reason:            string
  data_signals:      string[]
  estimated_effort:  'low' | 'medium' | 'high'
}
```

## Rule Definitions

Seven named rules are evaluated against each input in priority order. The first matching rule wins.

### Rule 1: `escalate_manual`
- **Trigger:** `escalationLevel === 0 AND slaRemainingMins !== null AND slaRemainingMins < 60`
- **Action:** `escalate`
- **Category:** `sla`
- **Urgency:** `min(100, 80 + (60 - slaRemainingMins) * 0.2)`
- **Reason:** "SLA breach imminent — escalate to expedite resolution."

### Rule 2: `reassign_overloaded`
- **Trigger:** `workloadScore > 80`
- **Action:** `reassign`
- **Category:** `workload`
- **Urgency:** `workloadScore`
- **Reason:** "Assignee workload exceeds threshold — consider redistributing."

### Rule 3: `resolve_to_unblock`
- **Trigger:** `downstreamCount > 0 AND status === 'open'`
- **Action:** `resolve`
- **Category:** `critical_path`
- **Urgency:** `min(100, 60 + downstreamCount * 10)`
- **Reason:** "Resolving this action unblocks {N} downstream actions."

### Rule 4: `close_duplicate_cluster`
- **Trigger:** `reopenCount >= 3`
- **Action:** `close`
- **Category:** `quality`
- **Urgency:** `50 + reopenCount * 5`
- **Reason:** "Action has been reopened {N} times — review for root cause or closure."

### Rule 5: `compliance_priority`
- **Trigger:** `actionType === 'COMPLIANCE_TASK' OR actionType includes 'COMPLIANCE'`
- **Action:** `prioritize`
- **Category:** `compliance`
- **Confidence:** always `≥ 90`
- **Reason:** "Compliance task — regulatory deadlines apply."

### Rule 6: `readiness_blocker`
- **Trigger:** `readinessImpact > 60`
- **Action:** `escalate`
- **Category:** `critical_path`
- **Urgency:** `readinessImpact`
- **Reason:** "High impact on project readiness score — expedite."

### Rule 7: `pause_sla_blocked`
- **Trigger:** `slaRemainingMins !== null AND slaRemainingMins < 0 AND downstreamCount === 0`
- **Action:** `pause`
- **Category:** `sla`
- **Urgency:** `40`
- **Reason:** "SLA already breached with no downstream impact — pause to stop accumulating penalty."

## Impact Score Calculation

```
impact_score = min(100, (urgency_score × 0.4) + (downstreamCount × 10) + (readinessImpact × 0.4))
```

Capped at 100. High-impact recommendations (`impact_score ≥ 75`) are surfaced in the `high_impact` array.

## Provider Interface

```typescript
interface RecommendationProvider {
  name: string
  rerank(
    inputs: RecommendationInput[],
    recs: Recommendation[]
  ): Promise<Recommendation[]>
}

function registerRecommendationProvider(p: RecommendationProvider): void
```

When a provider is registered, it receives the full list of recommendations after rule evaluation and returns a reordered (or augmented) list. The system is designed for a single active provider; a future multi-provider ensemble can be added in Phase 4.

## Assignee Suggestion

The engine also surfaces suggested assignees for new actions:

```typescript
async function suggestAssignee(
  tenantId: string,
  actionType: string,
  projectId?: string
): Promise<string | null>
```

Implementation: queries `actions` for the most recently assigned user for the same `action_type` in the same project, returning the user with the lowest recent workload. Falls back to `null` if no history exists.

## API Endpoint

```
GET /api/v1/ops/recommendations?project_id=<uuid>&limit=20
```

Response:
```json
{
  "recommendations": [...],
  "high_impact": [...]      // subset with impact_score >= 75
}
```

## `RecommendationPanel` Component

The `RecommendationPanel` React component renders each recommendation as a card:

- **Category badge:** color-coded by category.
- **Recommended action pill:** action label (escalate / reassign / etc.).
- **Reason text:** human-readable explanation.
- **Score bars:** urgency, impact, confidence as visual bars.
- **Accept / Dismiss:** optimistic dismiss with `opacity: 0.4`.

## Explainability Guarantee

Every recommendation in the API response includes:
- `reason`: plain-English string from the rule that fired.
- `data_signals`: the specific data points that triggered the rule (e.g., `["sla_remaining_mins: 45", "escalation_level: 0"]`).
- `confidence_score`: numeric 0–100.

No recommendation is surfaced without a traceable origin rule.

## Known Limitations

- Rules evaluate inputs independently — no cross-action correlation (e.g., "these 5 actions share an assignee who is overloaded"). Cross-action intelligence is a Phase 4 enhancement.
- `suggestAssignee` uses recency heuristic, not workload optimization.
- Provider interface is synchronous for reranking; async streaming responses from LLM providers will require interface update in Phase 4.
