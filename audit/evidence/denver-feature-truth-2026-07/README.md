# Denver Feature Truth Audit — Evidence Package

**Branch:** `audit/denver-feature-truth` · **Base:** `e6bdec8` (origin/main) · **Repository:** `ral197979/jarvis-epc`

## Repository isolation proof

| Item | Value |
|---|---|
| Confirmed repository root | `/Users/rommelaguillon/Local Documents/Claude/Production/Denver Engineering` |
| Confirmed Git remote | `https://github.com/ral197979/jarvis-epc.git` |
| Branch used | `audit/denver-feature-truth` (created from `origin/main`) |
| Repositories inspected | **`ral197979/jarvis-epc` only** |
| Repositories modified | **`ral197979/jarvis-epc` only** |
| Other repositories touched | **no** |
| Commands run above repository root | **no** |
| Sibling repository opened | **no** |
| Shared Docker resource changed | **no** (no Docker command run in this task) |
| External repository code copied | **no** |

`ava-math-engine` and `MEPPro-Precision-Edition` are referenced **only** as informational names already present in Denver's own committed documentation. They were **not** entered, inspected, fetched, or copied from. Their reported contents are therefore **not** used to upgrade any capability status — the relevant tools remain `EXTERNAL_SHELL`, exactly as the isolation rules require.

## What this audit produced

| Artifact | Path |
|---|---|
| Machine-readable capability registry (71 entries) | `src/config/capabilityRegistry.ts` |
| Coverage guard (CI job `feature-truth-guard`) | `scripts/validate-capability-registry.mjs` |
| Semantic honesty invariants + negative tests (14) | `src/__tests__/config/capabilityRegistry.test.ts` |
| System-prompt correction | `src/config/systemPrompt.ts` |
| System-prompt honesty tests | `src/__tests__/config/config.test.ts` |
| Primary product truth doc | `DENVER_FEATURE_TRUTH.md` |
| Engineering-tool matrix | `DENVER_ENGINEERING_TOOLS_STATUS.md` |
| AI mechanism map | `DENVER_AI_CAPABILITY_STATUS.md` |
| Route census | `DENVER_ROUTE_COVERAGE.md` |
| Deferred gap list | `DENVER_CAPABILITY_BACKLOG.md` |
| CI wiring | `.github/workflows/ci.yml` (`feature-truth-guard` job) |

## Route census (derived programmatically from source)

```
nav routes:      62
routable tabs:   70
HIDDEN (routable, not in sidebar): commissioning, procurement, engineering,
                                   plan, resources, audit, jobs, overview
NAV ITEMS WITH NO ROUTE (dead nav): none
```

Registry coverage: **100%** of nav routes; **0** phantom routes; **0** dead nav items.

## Capability status distribution (71 entries)

| Status | Count |
|---|---|
| VERIFIED_NATIVE | 31 |
| PARTIAL | 22 |
| DETERMINISTIC_AUTOMATION | 10 |
| VERIFIED_EXTERNAL | 2 |
| PREDICTIVE_MODEL | 2 |
| GROUNDING_OR_RAG | 1 |
| EXTERNAL_SHELL | 1 |
| DRAWING_GENERATOR | 1 |
| BROKEN_OR_DEAD | 1 |

## Verification-tier honesty

Every registry entry carries a `verification` tier: `runtime` (exercised live), `code` (source + route tracing), `audit` (carried from committed evidence with file:line proof), or `blocked`.

**Runtime verification was constrained** and this is stated rather than papered over:

- The local dev database is **empty** (0 tenants, 0 users) — verified by direct SQL this session.
- The login screen is a **stale PIN form** that does not match the email/password backend (`api/auth.ts` documents PIN mode as removed). No login was possible, so no authenticated multi-tenant workflow run was performed in this task.
- Consequently **no two-tenant isolation proof and no authenticated workflow depth-verification was produced by this audit**. Tenant-isolation evidence from prior sessions remains in `audit/INDEPENDENT_AUDIT_2026-07-02.md`; it was not re-run here.
- Routes verified live this session (render + empty state, unauthenticated shell): `feed`, `rfis`, `submittals`, `processdesign`. Server health (`/api/v1/health` → `db.ok:true`) verified live.

Workflow-depth classifications therefore rest on `code`/`audit` evidence. No entry claims `runtime` verification it did not receive.

## Not done (explicitly)

- No calculation engines implemented (out of scope by instruction).
- No deployment, no Fly/Render/Neon change, no credential created/rotated/printed.
- No PR merged.
- `audit/evidence/PR_DRAFT_2026-07-02.md` left untouched (pre-existing untracked file).
- Pre-existing working-tree changes to `src/config/workflows.ts` and `src/__tests__/config/workflows.test.ts` (from a prior task, user asked to leave as working tree) were **preserved and not committed**.
