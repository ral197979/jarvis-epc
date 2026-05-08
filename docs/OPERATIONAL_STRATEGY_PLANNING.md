# Operational Strategy Planning

**Denver Engineering — Ava Phase 7 (v7.0.0)**

## Overview

The operational strategy planner generates multi-horizon action plans by synthesizing portfolio state, open anomalies, and pending optimization proposals. Plans are advisory — all actions requiring significant operational change are flagged `requiresApproval: true`.

## Plan Generation

`generateStrategyPlan(tenantId, { horizon, objectives })` collects:

1. **Portfolio state** — all `project` twins ordered by readiness ascending (worst first)
2. **Open anomalies** — from `operational_anomalies` where `resolved_at IS NULL`, ordered by severity
3. **Bottlenecks** — pending optimization proposals for resource/workload/capacity types

## Action Priority Order

| Priority | Trigger | Requires Approval |
|----------|---------|-------------------|
| 1 | Critical anomalies exist | No (emergency response) |
| 2 | Degraded project twins | Yes (status change) |
| 3 | Active projects with readiness < 50 | No (monitoring action) |
| 4 | Pending resource optimization proposals | Yes |
| 5 | High-risk projects (risk ≥ 70) | No (monitoring increase) |

## Default Objectives (30-day horizon)

1. Achieve ≥65% portfolio readiness within 30 days
2. Resolve all critical anomalies
3. Reduce high-risk project count by 30%
4. Maintain zero SLA breaches

Custom objectives can be passed via the API.

## Risk Mitigations

Generated based on:
- High/critical anomaly count → escalation recommendation
- Average portfolio risk > 60 → risk review meeting
- Always includes: "Maintain daily twin sync health checks"

## Contingencies

Standard contingencies are always included:
- If readiness drops below 40: pause non-critical scheduled work
- If critical anomaly count exceeds 5: trigger emergency response protocol
- If failed projects remain unresolved: escalate to senior operations

## API

```
POST /api/v1/optimization/strategy
{
  "horizon": 30,
  "objectives": ["Custom objective 1", "Custom objective 2"]
}
→ {
  "planId": "<uuid>",
  "horizon": 30,
  "objectives": [...],
  "actions": [{ "priority": 1, "action": "...", "requiresApproval": false, ... }],
  "riskMitigations": [...],
  "contingencies": [...],
  "estimatedReadinessGain": 12,
  "generatedAt": "..."
}
```

## Estimated Readiness Gain

Calculated as:
```
estimatedGain = min(25, degradedProjects × 3 + min(10, bottlenecks × 2))
```

This is a conservative estimate. Actual gains depend on plan execution.
