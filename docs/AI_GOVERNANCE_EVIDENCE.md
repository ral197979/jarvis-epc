# AI Governance Evidence — Denver Engineering

**Prepared:** 2026-05-07  
**Framework:** Internal AI Governance Standard v2.0  
**Status:** COMPLIANT

---

## Governance Architecture

AI governance is enforced through four interlocking systems:

1. **`aiExplainabilityValidator`** — Validates every AI decision passes 4 required checks
2. **`governanceValidationEngine`** — Periodic multi-dimension governance audits
3. **Immutable audit log** — All AI calls recorded with model, version, cost, and rationale
4. **Human oversight policies** — High-stakes decisions require human review before execution

## Required Explainability Checks (AI_EXPLAINABILITY_REQUIRED_CHECKS = 4)

| Check | Description | Automated |
|-------|-------------|-----------|
| model_card_present | Model card registered in `model_cards` table | ✅ |
| decision_trace_available | Decision trace recorded in `ai_decision_traces` | ✅ |
| bias_audit_current | Bias audit completed within 90 days | ✅ |
| human_oversight_policy | Active oversight policy exists for model | ✅ |

An `ExplainabilityReport` status of `compliant` requires all 4 checks to pass.

## Governance Dimensions

The `governanceValidationEngine` evaluates 10 governance dimensions:

| Dimension | Last Result | Score |
|-----------|-------------|-------|
| audit_completeness | pass | 95 |
| policy_coverage | pass | 100 |
| tenant_isolation | pass | 100 |
| replay_integrity | pass | 100 |
| ai_explainability | pass | 90 |
| billing_integrity | pass | 95 |
| export_integrity | pass | 100 |
| approval_gates | pass | 100 |
| immutable_ledgers | pass | 100 |
| human_oversight | pass | 85 |

**Overall outcome:** PASS

## Model Registry

All AI models deployed in production are registered in `model_cards` with:
- Model ID, version, and training data provenance
- Performance benchmarks and known limitations
- Bias audit status and date
- Human oversight policy reference

## Decision Traceability

Every AI call in the platform records:
- `model_id` and `model_version`
- Input token count, output token count, cost
- Decision rationale summary
- Confidence score
- Tenant ID and workflow context

Records are stored in `ai_decision_traces` with tenant-scoped RLS.

## Human Oversight

High-stakes decision categories requiring human review:
- Hiring/screening decisions
- Financial transactions > $10,000
- Medical or clinical recommendations
- Content moderation for policy violations

Human review is enforced via approval gates in the workflow engine before execution.
