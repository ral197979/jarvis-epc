# Fly Staging Readiness — Evidence Package
**Task:** `infra/fly-staging-readiness` · **Date:** 2026-07-16 · **Branch:** `infra/fly-staging-readiness`

Follow-on to `audit/evidence/fly-release-2026-07/SAFE_STOP_REPORT.md` (the prior task's safe stop — no staging app, no available `DATABASE_URL_APP`). This package documents what this task built to remove the *infrastructure* blocker (no staging app existed) while leaving the *credential* blocker exactly where it was — deliberately, since credential rotation/creation was out of scope for both tasks.

| File | Contents |
|---|---|
| `GIT_BASELINE.md` | Branch, base SHA, pre-existing untracked-file handling |
| `FLY_PRODUCTION_BASELINE.md` | Read-only production inventory; confirmation nothing was changed |
| `SCHEDULER_PROMOTER_BASELINE.md` | Classification of the pre-existing recurring log errors |
| `STAGING_APP_PROOF.md` | Proof `denver-epc-staging` was created cleanly, with no deploy |
| `DATABASE_ISOLATION_DECISION.md` | Recommended staging DB isolation model (Neon branch) |
| `STAGING_CONFIG_REVIEW.md` | `fly.staging.toml` review and Fly validation |
| `WORKER_TOPOLOGY.md` | Current in-process web+scheduler architecture, preserved as-is |
| `SECRET_PREREQUISITES_REDACTED.md` | Every required secret name, current presence/absence, no values |
| `VALIDATION_RESULTS.md` | Full local + Fly + Docker validation gate results |
| `DEPLOYMENT_NOT_EXECUTED.md` | Explicit confirmation nothing was deployed |

**Bottom line:** the staging *foundation* (app, config, workflow, guardrails, decision record) is ready for review. Staging cannot actually be *deployed to* yet — that needs an approved `STAGING_DATABASE_URL_APP` (and `FLY_API_TOKEN`, `STAGING_JWT_SECRET`) supplied out-of-band, plus the Neon branch those credentials point at, none of which this task was authorized to create.
