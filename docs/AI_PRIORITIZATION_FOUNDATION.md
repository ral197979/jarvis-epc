# AI Prioritization Foundation

**Ava Phase 2 | Denver Engineering v4.34.0**

---

## Overview

The AI Prioritization Foundation provides a deterministic, rule-based scoring pipeline that ranks actions by operational risk. It is designed with a provider interface that allows future LLM-based reranking (OpenAI, Anthropic, Together.ai) to be plugged in without changing callers. No LLM is invoked in Phase 2.

---

## Design Principles

1. **Deterministic by default** — scores are fully reproducible given the same inputs. No randomness, no model inference, no network calls.
2. **Provider-agnostic** — the `ScoringProvider` interface separates the scoring contract from any specific implementation.
3. **Interpretable** — every score is decomposable into its 6 weighted components, enabling UI explanation ("this action is high priority because it is 2h from SLA breach and has 3 downstream dependents").
4. **Cheap to run** — scoring is in-process, runs in microseconds, and can score hundreds of actions synchronously during inbox rendering.
5. **No PII** — scoring inputs use IDs, counts, and enums only. No user-identifying information is passed to any scoring provider.

---

## Scoring Model

### Components and Weights

| Component | Weight | Input Signal |
|-----------|--------|-------------|
| `severity` | 25% | Action priority (critical/high/medium/low) |
| `sla_risk` | 30% | Remaining SLA minutes (or breached) |
| `escalation` | 15% | Current escalation level (0–3+) |
| `downstream` | 15% | Downstream impact count (blocked dependents) |
| `module_criticality` | 10% | Source module (compliance > alarm > inspection …) |
| `reopen_penalty` | 5% | Number of times action has been reopened |

Total weight = 100%. Final score = Σ(component_score × weight), range 0–100.

### Component Scoring Functions

**Severity (0–100):**
```
critical → 100
high     →  75
medium   →  40
low      →  10
```

**SLA Risk (0–100):**
```
already breached (remaining <= 0)   → 100
< 30 minutes remaining              →  90
< 2 hours remaining                 →  70
< 8 hours remaining                 →  45
< 24 hours remaining                →  20
>= 24 hours remaining or no SLA    →   0
```

**Escalation (0–100):**
```
level 0 → 0
level 1 → 35
level 2 → 65
level 3 → 90
level 4+ → 100
```

**Downstream impact (0–100):**
```
0 dependents  → 0
1             → 20
2–3           → 40
4–6           → 60
7–10          → 80
11+           → 100
```

**Module Criticality (0–100):**

```typescript
const MODULE_CRITICALITY: Record<string, number> = {
  COMPLIANCE_TASK: 90,
  ALARM:           85,
  INSPECTION:      80,
  RFI:             70,
  SUBMITTAL:       65,
  PUNCH_ITEM:      55,
  BIM_ISSUE:       50,
  DAILY_LOG:       20,
}
// Unknown modules default to 30
```

**Reopen Penalty (0–100):**
```
0 reopens → 0
1 reopen  → 30
2 reopens → 55
3 reopens → 75
4+ reopens → 90
```

### Example Score Calculation

```
Action: "Structural inspection overdue, 2 downstream blocked, escalated L2"
  severity:           critical  → 100 × 0.25 = 25.0
  sla_risk:           breached  → 100 × 0.30 = 30.0
  escalation:         level 2   →  65 × 0.15 =  9.75
  downstream:         2         →  40 × 0.15 =  6.0
  module_criticality: INSPECTION → 80 × 0.10 =  8.0
  reopen_penalty:     1 reopen  →  30 × 0.05 =  1.5
                                          ────────
  Total score:                              80.25
```

---

## API

### `scoreAction(input)`

```typescript
import { scoreAction } from '../services/actions/actionScoringService'

const score = scoreAction({
  priority:            'critical',
  sla_remaining_minutes: -45,    // negative = breached
  escalation_level:    2,
  downstream_count:    2,
  action_type:         'INSPECTION',
  reopen_count:        1,
})

// Returns:
{
  total_score:   80.25,
  components: {
    severity:           100,
    sla_risk:           100,
    escalation:          65,
    downstream:          40,
    module_criticality:  80,
    reopen_penalty:      30,
  },
  weights: { severity: 0.25, sla_risk: 0.30, ... },
}
```

### `scoreAndRankActions(inputs[])`

Scores all inputs and returns them sorted by `total_score` descending:

```typescript
const ranked = scoreAndRankActions(actions.map(a => ({
  id:                    a.id,
  priority:              a.priority,
  sla_remaining_minutes: a.sla_remaining_minutes,
  escalation_level:      a.max_escalation_level ?? 0,
  downstream_count:      a.dependency_count ?? 0,
  action_type:           a.action_type,
  reopen_count:          0,  // Phase 2: not yet tracked; Phase 3: read from events
})))
// Returns: ActionScore[] sorted highest first
```

---

## Provider Interface

```typescript
export interface ScoringProvider {
  name: string
  rerank(actions: ActionScoreInput[], context?: Record<string, unknown>): Promise<number[]>
}

export function registerScoringProvider(provider: ScoringProvider): void
```

When a provider is registered, `scoreAndRankActions` calls the provider's `rerank()` after computing deterministic scores. The provider returns an array of adjusted scores (same length, same order as input), which replace the deterministic scores for final sorting.

This allows:
- **Deterministic baseline** (Phase 2, now): always available, zero latency, no external dependencies
- **LLM reranking** (Phase 3): OpenAI embeddings or Anthropic's context-aware scoring adjusts the order based on project context, historical patterns, or natural language descriptions
- **Graceful degradation**: if the LLM provider errors, fall back to deterministic scores

No provider is registered in Phase 2.

---

## Rule-Based Recommendations

`actionRecommendationService.ts` applies threshold rules to a set of scored actions:

| Rule | Trigger | Recommendation |
|------|---------|---------------|
| `escalate_manual` | `sla_risk_score >= 80 AND escalation_level < 2` | "Escalate this action manually" |
| `pause_sla` | `downstream_score >= 40 AND remaining_minutes < 120` | "Pause SLA while upstream is blocked" |
| `prioritize` | `total_score >= 75` | "Prioritize for immediate attention" |

```typescript
const { high_priority, recommendations } = generateInboxRecommendations(scoredActions)
// high_priority: ActionScore[]  (score >= 75)
// recommendations: { action_id, rule, message }[]
```

### Assignee Suggestion

```typescript
const suggestedEmail = await suggestAssignee(tenantId, 'INSPECTION', projectId)
```

Returns the email of the assignee with the fewest open actions for the given `action_type` on the given project. Tiebreaks by lowest `overdue_count`. Returns `null` if no eligible assignees found.

---

## Phase 3 Roadmap

| Capability | Description |
|------------|-------------|
| LLM reranking | Register OpenAI/Anthropic provider; pass action descriptions + project context |
| Embedding similarity | Detect duplicate actions via cosine similarity of title embeddings |
| Historical pattern learning | Weight `module_criticality` dynamically from resolution time history per tenant |
| Explain endpoint | `GET /api/v1/actions/:id/score` returns score breakdown for UI explanation tooltip |
| Feedback loop | Track whether recommended actions were acted on; adjust rule thresholds |
| `reopen_count` from event stream | Phase 2 stubs this at 0; Phase 3 reads `count(*) WHERE event_type = 'reopened'` from `action_events` |
