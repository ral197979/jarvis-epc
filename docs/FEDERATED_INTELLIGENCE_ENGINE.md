# Federated Intelligence Engine

## Overview

The Federated Intelligence Engine enables privacy-safe data sharing across tenants to derive aggregate performance patterns. Each tenant voluntarily contributes anonymized metrics; the engine pools contributions into industry benchmarks without exposing any individual tenant's raw data.

## Core Principles

- **Opt-in only** — tenants must explicitly enable data contribution via `federated_consent` flags. Any contribution without `opt_in_verified = TRUE` is rejected.
- **K-anonymity** — no pattern is published unless at least `K_ANONYMITY_MIN = 5` distinct tenants contributed. This prevents re-identification from small cohorts.
- **Differential privacy** — all raw values are anonymized before storage. The `_anonymize()` helper strips PII fields (`tenant_id`, `user_id`, `project_id`) and injects a random salt and `_dp_noise_applied = true` marker.
- **Immutable audit trail** — every contribution, pattern publish, and opt-out is logged to `federated_privacy_audits`.

## Data Flow

```
Tenant opts in
  → contributeData() validates opt-in via tenantQuery
  → rawData is anonymized (_anonymize)
  → privacyHash computed (SHA-256)
  → stored in federated_contributions (status='active')

Aggregation job
  → K-anonymity check (contributorCount >= 5)
  → publishPattern() inserts into federated_patterns
  → pattern marked is_active=TRUE, k_anonymity_met=TRUE

Model activation
  → activateModelVersion() deactivates prior version
  → new version becomes the production pattern model
```

## API Surface

| Function | Description |
|---|---|
| `contributeData(tenantId, input)` | Submit anonymized metric for pooling |
| `withdrawContribution(tenantId, contributionId)` | Mark contribution withdrawn |
| `publishPattern(input)` | Publish aggregate pattern (requires K >= 5) |
| `getActivePattern(patternType)` | Retrieve current production pattern |
| `activateModelVersion(versionId)` | Promote a model version to active |
| `getPrivacyAudits(contributionId)` | Admin: retrieve privacy audit records |

## Privacy Guarantees

- Raw data is never stored — only the anonymized form is persisted.
- The `privacy_hash` field is a SHA-256 of the anonymized payload, used for deduplication only.
- The `k_count` tracks the minimum cohort size at the time of publish.
- Withdrawn contributions are flagged `status='withdrawn'` and excluded from all future aggregations.
- All cross-tenant queries use `pool` (admin bypass), never `tenantQuery`, to prevent data leakage.

## Configuration

```env
K_ANONYMITY_MIN=5          # Minimum contributors for pattern publish
```

## Related Services

- `benchmarkingService` — computes cohort percentile bands from federated patterns
- `certificationEvidenceService` — references federated audit trails for SOC2 evidence
