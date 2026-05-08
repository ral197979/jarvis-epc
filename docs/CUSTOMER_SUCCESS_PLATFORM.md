# Customer Success Platform

**Denver Engineering — Ava Phase 8 (v8.0.0)**

## Overview

The Customer Success Platform provides real-time visibility into tenant health, adoption, churn risk, and support load. It enables proactive intervention before customers reach the point of churn.

## Health Score Composition

`CustomerHealthScore` (0–100 for all dimensions):

| Dimension | Weight | Description |
|-----------|--------|-------------|
| `adoptionScore` | 40% | User activity vs seat utilization |
| `riskOfChurn` (inverted) | 30% | Inverse risk applied to health |
| `supportLoad` (inverted) | 20% | Inverse ticket load |
| `aiUsageEfficiency` | 10% | AI budget utilization quality |

```typescript
tenantHealthScore = adoptionScore * 0.40
                  + (100 - riskOfChurn) * 0.30
                  + (100 - supportLoad) * 0.20
                  + aiUsageEfficiency * 0.10
```

All scores are clamped to [0, 100].

## Adoption Scoring

```typescript
utilizationScore = min(100, (activeUsers7Days / seatLimit) * 100)
loginScore       = min(100, loginCount30Days * 2)   // 50 logins = 100
adoptionScore    = utilizationScore * 0.6 + loginScore * 0.4
```

Adoption data comes from `audit_log` (action = `'user.login'`). If the audit log table does not exist, adoption gracefully defaults to 0.

## Churn Risk Scoring

```typescript
featureScore  = min(100, enabledFeatureCount * 10)  // 10 features = 100
riskOfChurn   = (100 - adoptionScore) * 0.50
              + supportLoad * 0.30
              + (100 - featureScore) * 0.20
```

High churn risk = low adoption + high support burden + few features enabled.

## Support Load

```typescript
supportLoad = min(100, openTicketCount * 10)  // 10+ tickets = 100 load
```

Only non-terminal tickets (`open`, `in_progress`, `waiting_customer`) count.

## AI Usage Efficiency

- < 5% utilization: score 20 (underusing the platform)
- 5–80% utilization: score 20–100 (linear, good range)
- > 80% utilization: score penalized (approaching limits)

## SLA Management

Tickets are assigned SLA deadlines on creation based on priority:

| Priority | SLA |
|----------|-----|
| Critical | 4 hours |
| High | 24 hours |
| Medium | 72 hours |
| Low | 168 hours (7 days) |

`getSlaBreaches()` returns all open tickets past their `sla_deadline`, ordered by most overdue first.

## Escalation

`escalateTicket()` uses SQL-level priority promotion:
- `medium → high`
- `high → critical`
- `critical` stays `critical` (no-op promotion)

The `escalated_at` timestamp is set on first escalation (`COALESCE(escalated_at, now())`), preserving the original escalation time through subsequent operations.
