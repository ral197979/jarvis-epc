# Ecosystem Moderation and Trust

**Denver Engineering — Phase 12**  
**Status:** Active | **Version:** 12.0.0

---

## Overview

The ecosystem trust system ensures all plugins, workflows, and partners meet safety and quality thresholds before accessing tenant data. Four services enforce trust from initial submission through ongoing reputation monitoring.

---

## Services

| Service | Purpose |
|---------|---------|
| `ecosystemModerationEngine` | Manages moderation lifecycle for plugins/workflows |
| `pluginTrustScorer` | Computes trust scores for plugins |
| `workflowSafetyScanner` | Validates workflow safety invariants |
| `partnerReputationService` | Scores and classifies partner reliability |

---

## Plugin Trust Scoring

### Formula
```
score = (sandboxPassRate × 40 + authorReputation × 20)
      − (apiScopeRisk × 20 + dataAccessRisk × 20)
      − min(abuseFlags × 15, 40)

Clamped to [0, 100]
```

All inputs are 0–1 except `abuseFlags` (integer count).

### Trust Threshold
```
PLUGIN_TRUST_SCORE_THRESHOLD = 70

isPluginTrusted = score ≥ 70 AND abuseFlags === 0
requiresManualReview = abuseFlags > 0 OR score < 70
```

---

## Moderation Lifecycle

### States
```
pending → under_review → approved
                      ↘ rejected
approved → revoked
```

### Escalation to Approved
A plugin can be escalated to `approved` only when:
1. `status === 'under_review'`
2. `sandboxValidated === true`
3. `trustScore ≥ 70`

### Risk Classification
| Condition | Risk |
|-----------|------|
| Sandbox not validated OR abuseFlags ≥ 3 | `high` |
| trustScore < 50 OR abuseFlags ≥ 1 | `medium` |
| All clear | `low` |

### Final States
`approved`, `rejected`, `revoked` — no further transitions possible.

---

## Workflow Safety

### Safety Score
```
if (!tenantIsolation): score = 0
else if (!replaySafe): score ≤ 20
else:
  base = (checksPassed / checksTotal) × 100
  penalty = !governance ? −20 : 0
  score = base + penalty
```

### Safety Gate
```
isWorkflowSafe = tenantIsolation AND replaySafe AND governanceCompliant AND checksFailed === 0
```

### Risk Classification
| Condition | Risk |
|-----------|------|
| !tenantIsolation OR score < 40 | `unsafe` |
| !replaySafe OR !governance OR score < 80 | `review_required` |
| Otherwise | `safe` |

---

## Partner Reputation

### Score Formula
```
score = uptime × 100 × 0.6
      − errorRate × 100 × 3
      − min(incidents × 20, 50)

Clamped to [0, ∞)
```

### Trust Level Classification
| Condition | Level |
|-----------|-------|
| incidents ≥ 3 OR score < 30 | `untrusted` |
| incidents ≥ 1 OR score < 60 | `provisional` |
| score ≥ 85 | `verified` |
| Otherwise | `trusted` |

### Reliability Gate
```
isPartnerReliable = level ≠ 'untrusted' AND errorRate < 0.05 AND uptime ≥ 0.99
```

---

## Key Tables

| Table | Description |
|-------|-------------|
| `p12_moderation_records` | Plugin/workflow moderation state |
| `p12_plugin_trust_scores` | Computed trust scores with flag counts |
| `p12_workflow_safety_checks` | Per-workflow safety check results |
| `p12_partner_reputations` | Partner reputation scores and trust levels |

---

## Operational Guidance

- Plugins with `abuseFlags > 0` are **always** queued for manual review regardless of score.
- `unsafe` workflows must be blocked from tenant execution immediately.
- Partners downgraded to `untrusted` are automatically suspended from API access.
- Trust scores are recomputed on every sandbox run — scores are not cached indefinitely.
- Revoked plugins generate an audit event and must be excluded from all active tenant configurations.
