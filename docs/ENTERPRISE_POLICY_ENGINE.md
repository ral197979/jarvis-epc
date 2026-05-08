# Enterprise Policy Engine

**Denver Engineering — Ava Phase 4 (v4.40.0)**

## Overview

The Policy Engine provides configurable, inheritable governance rules that control escalation behavior, approval requirements, freeze conditions, evidence requirements, AI confidence thresholds, assignment restrictions, and after-hours restrictions. Policies are evaluated at runtime before operational mutations execute.

## Core Principles

- **AND-logic rule evaluation** — all rules in a policy must match for the policy to trigger
- **Scope inheritance** — more-specific scopes override broader ones; first match wins per `policyType:scope:scopeId` key
- **No eval()** — rule operators are evaluated with a switch statement against typed values only
- **Immutable audit** — `policy_audit_log` blocks UPDATE and DELETE at the DB level via CREATE RULE
- **Non-blocking warnings** — policies can be configured to `warn` rather than `block`

## Scope Precedence

Scopes are evaluated from most-specific to least-specific:

```
severity → role → workflow → module → project → tenant
```

When two policies match the same `policyType:scope:scopeId`, the first one in precedence order wins. Inheritance deduplication ensures each combination is evaluated at most once.

## Schema

### `governance_policies`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | Policy identifier |
| tenant_id | UUID | Tenant scope (RLS) |
| name | TEXT | Human-readable name |
| scope | TEXT | tenant / project / module / role / workflow / severity |
| scope_id | TEXT | Specific scope value (nullable = applies to all) |
| policy_type | TEXT | escalation_rule / approval_requirement / freeze_condition / evidence_requirement / ai_confidence_minimum / assignment_restriction / after_hours_restriction |
| rules | JSONB | Array of PolicyRule |
| priority | INT | Lower = higher precedence |
| status | TEXT | active / inactive / archived |
| supersedes | UUID FK | Policy this one replaces (nullable) |
| effective_at | TIMESTAMPTZ | When policy takes effect |
| expires_at | TIMESTAMPTZ | When policy expires (nullable) |

### `policy_audit_log`
Immutable log of all policy evaluations and enforcement actions.

## Rule Operators

| Operator | Type | Example |
|----------|------|---------|
| `eq` | Equality | `{ field: "priority", operator: "eq", value: "critical" }` |
| `gte` | ≥ (numeric) | `{ field: "confidence_score", operator: "gte", value: 80 }` |
| `lte` | ≤ (numeric) | `{ field: "impact_score", operator: "lte", value: 30 }` |
| `in` | Array contains | `{ field: "action_type", operator: "in", value: ["corrective","safety"] }` |
| `not_in` | Array excludes | `{ field: "role", operator: "not_in", value: ["admin"] }` |
| `exists` | Field present | `{ field: "assignee_id", operator: "exists", value: "" }` |

## Policy Evaluation Flow

```
enforcePolicy(policyType, ctx)
  → evaluatePolicy(policyType, ctx)
    → getPoliciesForContext(tenantId, policyType, ctx)  [DB query, filtered by scope]
    → _inheritPolicies(policies)  [dedup by policyType:scope:scopeId]
    → for each policy:
        _evaluateRules(policy.rules, ctx.payload)  [AND logic]
        if matches and action=block → log + throw PolicyBlockedError
        if matches and action=warn  → collect warning, continue
```

`PolicyBlockedError` carries `policyName` and the matched `policy` object for downstream error handling.

## Policy Types

| Type | Effect |
|------|--------|
| `escalation_rule` | Controls when automatic escalation triggers |
| `approval_requirement` | Adds approval gates to specific action types |
| `freeze_condition` | Prevents mutations when matched |
| `evidence_requirement` | Requires evidence before completion |
| `ai_confidence_minimum` | Sets per-scope AI recommendation threshold |
| `assignment_restriction` | Limits who can be assigned |
| `after_hours_restriction` | Blocks work outside permitted hours |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/policies` | List tenant policies |
| POST | `/api/v1/policies` | Create new policy |
| PATCH | `/api/v1/policies/:id` | Update / toggle status |
| POST | `/api/v1/policies/evaluate` | Evaluate policies against a payload |
| GET | `/api/v1/policies/audit` | Get policy audit log |

## Frontend: PolicyRuleBuilder

The `PolicyRuleBuilder` component provides a visual rule editor with field/operator/value dropdowns. Policies can be enabled/disabled without deletion, preserving the full audit history.
