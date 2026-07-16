# Secret and Prerequisite Inventory (names only — no values, ever)

## GitHub Actions repository secrets — actual current state (inspected via `gh secret list` and the GitHub API, read-only)
| Name | Present today? | Scope |
|---|---|---|
| `RENDER_DEPLOY_HOOK` | **Yes** | repository-level |
| `FLY_API_TOKEN` | **No** | — |
| `DATABASE_URL` | **No** | — |
| `JWT_SECRET` | **No** | — |
| `ANTHROPIC_API_KEY` | **No** | — |

Also checked: both GitHub "environments" on this repo (`main - jarvis-epc`, `main - jarvis-epc-bdrm`, both auto-created by the Render GitHub integration) have **zero** environment-scoped secrets.

**Finding:** the existing, already-merged `.github/workflows/fly-deploy.yml` (production Fly deploy, not created by this task) references `FLY_API_TOKEN`, `DATABASE_URL`, `JWT_SECRET`, and `ANTHROPIC_API_KEY` as GitHub Actions secrets — **none of which exist**. Combined with every Fly release to date being attributed to `ral34780@gmail.com` (a human, via local `flyctl`, per `flyctl releases --app denver-epc`), this indicates the production Fly deploy workflow has likely never been successfully run through GitHub Actions — all production deploys so far were done by a human running `flyctl` locally. This predates this task and is not something this task fixes (out of scope: this task creates a new *staging* workflow with its own, currently-also-unset, secret requirements — it does not repair the production workflow).

## Fly secrets — actual current state (inspected via `flyctl secrets list`, names/digests only)
| App | Secret name | Present today? |
|---|---|---|
| `denver-epc` (production) | `JWT_SECRET` | Yes (deployed) |
| `denver-epc` (production) | `DATABASE_URL` | Yes (deployed) |
| `denver-epc` (production) | `DATABASE_URL_APP` | **No** |
| `denver-epc-staging` | *(any)* | **No — zero secrets, app just created, expected** |

## Required for a future staging deployment (names only — this task does not create, rotate, or supply any of these values)

| Variable | Classification | Where it lives |
|---|---|---|
| `FLY_API_TOKEN` | Secret, missing, staging-specific recommended (scope a token to the `personal` org or, if Fly supports it, to `denver-epc-staging` only) | GitHub Actions secret |
| `STAGING_DATABASE_URL_APP` | Secret, missing, **staging-specific — must never be copied from production**, application-runtime role (`jarvis_app`, NOBYPASSRLS) on the staging Neon branch | GitHub Actions secret → staged onto Fly as `DATABASE_URL_APP` |
| `STAGING_JWT_SECRET` | Secret, missing, staging-specific (do not reuse production's `JWT_SECRET`) | GitHub Actions secret → staged onto Fly as `JWT_SECRET` |
| A provisioned staging Neon branch/project | Infrastructure prerequisite, missing | See `DATABASE_ISOLATION_DECISION.md` |
| `ANTHROPIC_API_KEY` (staging) | Secret, optional — app boots without it; AI-dependent routes fail until set, same as production's documented behavior | GitHub Actions secret, if staging needs to exercise AI features |

## Classification key (applied above)
- **Non-secret and committed:** none of the above — every credential-shaped value here is a secret.
- **Secret and already available:** none (all four candidate secrets are currently absent from both GitHub and Fly for staging).
- **Secret and missing:** `FLY_API_TOKEN`, `STAGING_DATABASE_URL_APP`, `STAGING_JWT_SECRET`, optionally `ANTHROPIC_API_KEY`.
- **Staging-specific:** `STAGING_DATABASE_URL_APP`, `STAGING_JWT_SECRET` — must not be copied from production values.
- **Safe to share across environments:** none identified — even `FLY_API_TOKEN` is recommended staging-scoped rather than reusing a production-capable token, to limit blast radius if the staging workflow or its secrets are ever compromised.
- **Prohibited from sharing across environments:** `DATABASE_URL_APP` / `DATABASE_URL` (any form) — staging must never receive production's connection string, and vice versa.
- **Unknown and requiring owner approval:** whether a single Neon branch is acceptable for staging vs. a fully separate Neon project (see `DATABASE_ISOLATION_DECISION.md`), and whether `FLY_API_TOKEN` can practically be scoped to a single app on the account's current Fly plan.

No value for any of the above was requested from, typed by, or shared by the user in this task. No credential rotation or creation was performed.
