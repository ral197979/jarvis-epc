# Fly Staging Proof and Production Deployment — Safe Stop Report
**Date:** 2026-07-11 · **Task:** Fly Staging Proof and Production Deployment (post PR #18 merge)
**Disposition:** `SAFE STOP — DEPLOYMENT BLOCKED`

No staging or production deployment was performed. No secrets were rotated, changed, printed, or persisted. No repository changes were made **at the time this report was originally written**.

**Provenance/tracking-status note (added 2026-07-11 during the follow-on `infra/fly-staging-readiness` task):** at the time this file was first written, it existed only as an **untracked** file on disk in the working tree (confirmed via `git ls-files` returning nothing and `git check-ignore -v` exiting 1, i.e. not matched by `.gitignore` either) — it was never committed by the original task, and the original task correctly reported "no repository changes were made" because none had been. This follow-on task now commits it (along with the rollback correction above) as part of a real, reviewable branch/PR, so that the record is preserved rather than lost as loose working-tree state. As of this task's commit, the file **is tracked**.

---

## Exact blockers (two independent, either alone sufficient to stop)

### Blocker 1 — Stop condition 1: no approved application-runtime connection string available
`test -n "${DATABASE_URL_APP:-}"` against the local shell environment: **absent**. The only `DATABASE_URL_APP` value that exists anywhere accessible to this session is a local-development-only entry in the untracked `.env` file (`postgresql://jarvis_app@localhost:5432/jarvis_epc`), created during an earlier local remediation/verification pass. It is not reachable from Fly's infrastructure, was never represented as an approved production/staging credential, and using it would not satisfy this task's requirement — it was excluded from consideration, not tested against Fly.

No other secure local or out-of-band source offered a candidate value. Per the task's explicit instruction, credential rotation/creation is out of scope, so no substitute was generated.

### Blocker 2 — Stop condition 5: no staging Fly app exists
`flyctl apps list` (full account inventory, read-only) returns exactly one app related to this project: `denver-epc` (deployed, owner `personal`). No `denver-epc-staging` or equivalent exists. Corroborated by static inspection: the repo defines exactly one `fly.toml` (single `app = "denver-epc"`, no environment-specific variants) and exactly one deploy workflow (`.github/workflows/fly-deploy.yml`, `workflow_dispatch`-only, hardcodes the single app name via `grep -m1 '^app' fly.toml`). Nothing in the repository or the live Fly account defines a staging target to deploy to or prove the release in before promoting to production.

Provisioning a new Fly app (and, almost certainly, a new Neon database/branch to back it) is new infrastructure, not a "minimal deployment-configuration correction... necessary to boot the already-merged release" (the task's stated boundary for in-scope repository changes). It was not attempted.

---

## Work actually performed (read-only reconnaissance, no state changed)

### Repository/release reconciliation
- Repo path: `/Users/rommelaguillon/Local Documents/Claude/Production/Denver Engineering`
- Local branch: `fix/audit-p0-p1-closure-2026-07-02` (unchanged; not switched to `main`)
- Working tree: clean except the pre-existing untracked `audit/evidence/PR_DRAFT_2026-07-02.md` (present before this task; left untouched, not staged, not deleted)
- `origin/main` SHA: `eda53c921685316afe758ff7ba474e858bc9d343` — **exactly** the PR #18 merge commit, confirmed via `git log --oneline --decorate -10 origin/main`. `main` has **not** advanced since PR #18. Selected deployment SHA (had deployment proceeded): `eda53c9`.

### Deployment architecture (static inspection)
- Single Fly app: `denver-epc`, org `personal`, region `iad`.
- Single Fly process group: `app` (fly.toml has no `[processes]` block). There is **no separate Fly worker process group** — `Dockerfile.api`'s `CMD` runs only `npx tsx api/server.ts`, and `api/server.ts` starts the scheduler/pack-worker/etc. **in-process**, in the same machine as the HTTP server (fly.toml's own comment: "background workers must stay alive" next to `auto_stop_machines = false`, on the single `[[vm]]` block). `api/worker.ts` exists in the repo as a separate entrypoint but is not referenced by `Dockerfile.api` or `fly.toml` — it is not deployed as a distinct Fly process today. This is a real architectural fact worth surfacing: the task's assumption of independently provable "web process" and "worker process" boot proof does not map onto a distinct machine/process group in the current Fly topology — both live in one process on one machine.
- `fly-deploy.yml`: `workflow_dispatch` only (no auto-trigger), stages `DATABASE_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY` from GitHub Actions secrets via `flyctl secrets set --stage`, deploys via `flyctl deploy --remote-only --ha=false` (Fly's remote builder builds the image fresh from the checked-out source each run — not a pre-built immutable image promoted between environments), then polls `GET /api/v1/health` up to 20× for `200`.
- No `release_command` / migration step is defined in `fly.toml`; migrations run automatically at process startup inside `api/server.ts` (`initPool()` → `runMigrations()`), confirmed against this session's earlier local verification logs (`[startup] Running migrations...`).
- No mechanism in this repo currently distinguishes a migration/admin database role from the runtime role at the *deployment* level beyond the application code's own `DATABASE_URL` vs `DATABASE_URL_APP` split (`api/db/pool.ts`) — the workflow only ever stages `DATABASE_URL`.
- Rollback mechanism available: `flyctl releases --app denver-epc` lists prior releases (v1–v5); Fly supports `flyctl deploy --image <prior-release-image>` or the dashboard's rollback action. Not exercised (nothing was deployed).

### Fly state (read-only, no secret values)
- `flyctl auth whoami` → `ral34780@gmail.com` (authenticated).
- `flyctl apps list` → 10 apps on this account total; only `denver-epc` relates to this project. No staging variant.
- `flyctl status --app denver-epc`: 1 machine (`6836e9b7127418`, process group `app`, region `iad`), state `started`, checks `1/1 passing`, running image `denver-epc:deployment-01KWHGAAYG0J0Z4TSFD7H2M6NF` (release **v5**, deployed 2026-07-02T13:30:48Z — i.e. still the pre-PR#18 build; the PR #18 code has not been deployed here).
- `flyctl releases --app denver-epc`: v1 (failed, 2026-07-02 02:13), v2–v5 (complete).
- **[CORRECTED 2026-07-11, during the follow-on `infra/fly-staging-readiness` task]** Rollback candidate for a *future* deploy: this report originally named v4 as "the" rollback candidate without qualification. That was imprecise. The correct model: **v5 is the primary rollback target**, because v5 is the release currently running in production right now, and its health check is currently passing (`1/1 passing`, `db.ok:true`, `redis.ok:true` — see Fly state below). If a future deploy of PR #18 (or any later change) fails, rolling back means returning to whatever was running immediately before that deploy, which is v5 — not skipping past it to v4. **v4 (2026-07-02 12:32) is only a secondary fallback**, to be used only if v5 itself is later formally shown to be unsuitable (e.g., if the recurring `[scheduler]`/`[promoter]` errors — present on v5 today — are later found to be more than cosmetic). No such finding exists yet; see `SCHEDULER_PROMOTER_BASELINE.md` in `audit/evidence/fly-staging-readiness-2026-07/` for the baseline classification.
- `flyctl secrets list --app denver-epc` (names/digests only, no values retrieved or printed): `JWT_SECRET` (deployed), `DATABASE_URL` (deployed). **`DATABASE_URL_APP` is not present.**
- `flyctl checks list --app denver-epc`: 1 check, `servicecheck-00-http-3001`, passing; last output (non-sensitive fields only): `status: ok, version: 9.0.0, uptime: 6s, db.ok: true, redis.ok: true`.
- `flyctl logs --app denver-epc` (tail): the currently-running (pre-PR#18) build shows a recurring, pre-existing `[JARVIS:scheduler] [promoter] Failed` log line roughly every 1–3 minutes. This predates and is unrelated to this task's scope — noted as an observed condition, not investigated or remediated here.

---

## Secret handling attestation
- No secret value was requested from the user, echoed, printed, logged, or written to any file in this session.
- No `flyctl secrets set` command was executed.
- No database connection was made to any Neon/Fly-hosted database as part of this task.
- `DATABASE_URL_APP` and `DATABASE_URL` values were referenced only by name throughout.

## Whether anything was changed
- Secrets rotated/changed: **no.**
- Staging modified: **no** (no staging environment exists).
- Production (`denver-epc`) modified: **no** — no `flyctl deploy`, no `flyctl secrets set`, no machine restart, no scale change was performed.
- Repository changed: **no** — read-only inspection only; no branch, commit, or PR was created (per the task's own guidance not to create empty/documentation-only PRs when no repository change is genuinely required to unblock this — the blockers here are operational/infrastructure, not a code or workflow defect).

## Remediation required before this task can proceed
1. Provide an approved, Fly-reachable Neon application-runtime connection string for `DATABASE_URL_APP` (the `jarvis_app` NOBYPASSRLS role, per migration 075) through a secure out-of-band channel — not pasted into chat, not committed. Out of scope for this task to create/rotate.
2. Decide how a Fly staging environment should be established (a second Fly app + a Neon branch/database, at minimum) before a staging-first promotion process can exist at all. This is an infrastructure decision, not something this task's "minimal correction" scope covers.
3. Separately, decide whether `api/worker.ts` should be deployed as its own Fly process group, or whether the current single-process (web+workers combined) topology is the intended production architecture — this affects how "worker boot proof" should even be defined going forward.
