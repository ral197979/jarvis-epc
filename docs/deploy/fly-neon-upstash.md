# Deploying Denver on Fly.io + Neon (cheapest US-owned; Upstash Redis optional)

Run Denver (`main`) on a tiny **always-on Fly.io** machine with **Neon** (managed Postgres + `pgvector`).
Redis is **optional** — a single instance uses Denver's built-in in-memory token store, so the cheapest
setup is just **Fly + Neon (~$5/mo, all US-owned)**. Add **Upstash** Redis only when you scale to multiple
instances.

**Documentation only.** `fly.toml` and commands are templates to run on your machine — not committed config.

---

## 0. Why this stack
- **Neon** = managed Postgres with **`pgvector`** built in (migration `071` needs `CREATE EXTENSION vector`),
  scale-to-zero, free tier ~0.5 GB.
- **Fly.io** = small **always-on** VM. Denver runs background workers, so do **not** scale the app to zero.
- **Redis is optional.** `api/tokenStore.ts` uses Redis only when `REDIS_URL` is set and otherwise
  **degrades gracefully to an in-memory token store**. For a *single* always-on machine that's fine — the
  only tradeoff is that JWT/refresh tokens and rate-limit counters live in process memory (reset on
  redeploy/restart → users re-login; acceptable for one instance). Add Upstash + `ioredis` when you run
  **multiple** instances and need shared/persistent token state (see §7).

## 1. Provision Neon
1. Create a Neon project (US region, Postgres 16). Copy the connection string
   (`postgres://USER:PWD@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`).
2. `pgvector` is available; migration `071` runs `CREATE EXTENSION IF NOT EXISTS vector` as the project
   owner. Nothing to pre-create — but **watch the first deploy's migrate log** for role/extension errors
   (§4 gotchas).

## 2. Install & init Fly
```bash
curl -L https://fly.io/install.sh | sh        # installs flyctl
fly auth signup   # or: fly auth login
cd <repo>                                       # main checkout
fly launch --no-deploy --dockerfile Dockerfile.api --name denver-api
# choose a US region (e.g. iad/ord/sjc); decline Fly Postgres/Redis (using Neon; Redis optional)
```

## 3. `fly.toml` (API service — always-on)
```toml
app = "denver-api"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile.api"

[env]
  NODE_ENV = "production"
  PORT = "3001"
  DB_SSL = "true"          # Neon requires TLS
  LOG_LEVEL = "info"
  STORAGE_BACKEND = "local"
  # Federation flags OFF (v2.0.1 ships dormant)
  COMMISSIONING_EXTERNAL = "false"
  CAPABILITY_REGISTRY = "false"
  UNIVERSAL_EVENTS = "false"
  OBJECT_REGISTRY = "false"
  KNOWLEDGE_GRAPH = "false"
  IDEMPOTENCY = "false"
  OPENAPI_ENABLED = "false"
  DENVER_MCP_SERVER = "false"
  EAP_ENABLED = "false"

[http_service]
  internal_port = 3001
  force_https = true
  auto_stop_machines = false      # ← keep ON: background workers must stay alive
  auto_start_machines = true
  min_machines_running = 1        # ← always-on

  [[http_service.checks]]
    method = "GET"
    path = "/api/v1/health"
    interval = "30s"
    timeout = "5s"

[[vm]]
  memory = "1gb"     # 512mb may work; 1gb is safer for Node + workers
  cpus = 1
```

## 4. Secrets (never in fly.toml)
```bash
fly secrets set \
  DATABASE_URL="postgres://USER:PWD@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require" \
  JWT_SECRET="$(openssl rand -hex 32)" \
  ANTHROPIC_API_KEY="<your key>" \
  ALLOWED_ORIGINS="https://app.yourdomain.com" \
  VITE_BACKEND_URL="https://denver-api.fly.dev"
# REDIS_URL: omit for single-instance (in-memory fallback). See §7 to add Upstash.
```
> **Gotchas:** (1) Neon needs `DB_SSL=true` (in `[env]`) *and* `?sslmode=require` in the URL. (2)
> `DATABASE_URL_APP` (the non-owner `jarvis_app` role for full RLS enforcement) is **required** in
> production — as of AUDIT-P0-06 the API refuses to boot with `NODE_ENV=production` and this unset,
> because without it every "tenant-scoped" query silently runs as the RLS-exempt table owner. Create
> the `jarvis_app` role in Neon (`NOBYPASSRLS`, migration 075 grants it) and set `DATABASE_URL_APP`
> *before* deploying with `NODE_ENV=production`. (3) With no `REDIS_URL`, `/health` still reports
> `redis.ok` (the in-memory store) — green.

## 5. Deploy (runs migrations on boot)
```bash
fly deploy
fly logs        # watch: "[migrate] Applied N migration(s)" then "listening on port 3001"
```
First deploy applies `000–081` to Neon (the same 81 migrations validated on a clean PG). Each migration is
atomic (BEGIN/COMMIT per file); a failure rolls back that file and stops — fix and re-deploy (idempotent:
applied migrations are skipped).

## 6. Verify (the v2.0.1 acceptance gate)
```bash
fly status
curl -s https://denver-api.fly.dev/api/v1/health | jq .         # status:ok, db.ok:true, redis.ok:true
curl -s -o /dev/null -w '%{http_code}\n' https://denver-api.fly.dev/metrics            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://denver-api.fly.dev/api/v1/projects    # 401 (authz)
```
No startup/federation-init errors (flags off). **Green here = host healthy → tag `v2.0.1`.**

## 7. (Optional) Add Upstash Redis — only when scaling to multiple instances
A single Fly machine doesn't need Redis. If you run **>1 instance** (shared token store / rate limiting):
1. Create an Upstash Redis DB (US region); copy the **`rediss://`** TLS URL.
2. `ioredis` is **not** a default dependency — add it: move it into `dependencies` (`npm i ioredis`) so the
   Docker build (`npm ci --omit=dev`) includes it (ioredis handles `rediss://` TLS natively).
3. `fly secrets set REDIS_URL="rediss://default:PWD@us1-xxx.upstash.io:6379"` and redeploy.
4. Confirm `/health` `redis.ok:true` is now backed by Upstash (not the in-memory fallback).
> Cost add: Upstash free tier $0 → ~$10/mo.

## 8. Frontend (cheapest = free static host)
The SPA (`Dockerfile.frontend`/nginx) is static:
- **Free:** `npm run build` → deploy `dist/` to **Cloudflare Pages** or **Netlify** (free, US), with
  `VITE_BACKEND_URL=https://denver-api.fly.dev`. Set `ALLOWED_ORIGINS` on the API to that origin.
- **Same platform:** a second small Fly app from `Dockerfile.frontend` (can `auto_stop` — it's just nginx).

## 9. Backups & ops
- **Neon** = point-in-time restore / branch-restore on its plans → your DB rollback path; no cron needed.
- **Updates:** `git pull && fly deploy` (migrations idempotent).
- **Secrets rotation:** `fly secrets set JWT_SECRET=...` → rolling restart.

## 10. Cost (directional)
- **Neon:** $0 (free) → ~$19/mo (launch) as data grows.
- **Fly:** ~$5/mo for a 1 GB always-on machine (+ ~$2 if a 2nd tiny frontend machine; $0 with Cloudflare
  Pages/Netlify free for the SPA).
- **Upstash:** $0 unless/until you add it for multi-instance (§7).
- **Total: ~$5/mo at low load (Fly + Neon), all US-owned.**

## 11. Cutover checklist
- [ ] Neon project (US) created, connection string copied, `pgvector` available
- [ ] `fly launch` (US region) + `fly.toml` with `min_machines_running=1`, `auto_stop_machines=false`
- [ ] `fly secrets set` (DATABASE_URL + `DB_SSL=true`, JWT_SECRET 32+, ANTHROPIC_API_KEY; flags OFF; no REDIS_URL)
- [ ] `fly deploy` → migrate log shows 81 applied, "listening"
- [ ] `/api/v1/health` 200 (db.ok + redis.ok), `/metrics` 200, `/projects` 401, no startup errors
- [ ] Frontend deployed (Cloudflare Pages/Netlify free, or 2nd Fly app); `VITE_BACKEND_URL` + `ALLOWED_ORIGINS` set
- [ ] (then) tag `v2.0.1` from `11f0903`, publish `docs/releases/v2.0.1.md`
- [ ] (later, if multi-instance) add Upstash + `ioredis` per §7

## 12. Staging environment (added by `infra/fly-staging-readiness`, 2026-07-16)

The actual production app on this account is **`denver-epc`** (org `personal`, region `iad`) — not the generic `denver-api` name used as an example above. A dedicated staging app, **`denver-epc-staging`** (same org, same region), now exists alongside it, created empty (no machines, no secrets, no release) — see `audit/evidence/fly-staging-readiness-2026-07/STAGING_APP_PROOF.md` for the creation proof.

**Config:** `fly.staging.toml` (repo root) — targets only `denver-epc-staging`, never `denver-epc`. Same `Dockerfile.api`, same `/api/v1/health` check, same single-machine/single-process topology as production (background schedulers still run **in-process** with the web server — see `audit/evidence/fly-staging-readiness-2026-07/WORKER_TOPOLOGY.md`; `api/worker.ts` remains an unused, undeployed second entrypoint). Staging differs only in non-secret ways: `APP_ENV=staging`, `LOG_LEVEL=debug`, and `min_machines_running=0` / `auto_stop_machines=true` for cost control.

**Deployment:** `.github/workflows/fly-staging-deploy.yml`, `workflow_dispatch` only — **staging never auto-deploys** (no `push`, `pull_request`, or `schedule` trigger). Opening a PR against this workflow, or merging one, does not run it. `scripts/validate-fly-staging-config.mjs` runs in CI on every push/PR and fails the build if the staging config or workflow ever drifts toward being able to target production (wrong app name, a push trigger, a user-suppliable app-name input, a literal `DATABASE_URL_APP` value committed anywhere, etc.).

**Database isolation:** staging must use its own Neon branch/project — **never** production's database, and never merely a schema inside it. Full analysis and recommendation: `audit/evidence/fly-staging-readiness-2026-07/DATABASE_ISOLATION_DECISION.md`. Staging must not use production customer data without a separate, explicit approval.

**`DATABASE_URL_APP` is mandatory, with no fallback, in both environments.** Since AUDIT-P0-06, the API refuses to boot in `NODE_ENV=production` (which both `fly.toml` and `fly.staging.toml` set, deliberately — staging runs the real production code paths) if `DATABASE_URL_APP` is unset. There is no code path that falls back to the owner-level `DATABASE_URL` for runtime traffic, in staging or production, and this document does not describe one — see `api/db/pool.ts`.

**Secrets are supplied out-of-band, never through this repo or this documentation.** Required names (values never recorded anywhere in the repo): `FLY_API_TOKEN`, `STAGING_DATABASE_URL_APP`, `STAGING_JWT_SECRET`, optionally `ANTHROPIC_API_KEY` — current presence/absence tracked by name only in `audit/evidence/fly-staging-readiness-2026-07/SECRET_PREREQUISITES_REDACTED.md`. **Credential rotation and creation are outside the scope of both the `infra/fly-staging-readiness` task and this document** — provisioning the staging Neon role/branch and supplying its connection string is a separate, explicitly-authorized step.

**Release identity:** `/api/v1/health` now includes a non-secret `releaseSha` field (`api/services/releaseIdentity.ts`), populated at deploy time via `flyctl deploy --env APP_RELEASE_SHA=<git-sha>` in the staging workflow. `null` when unset (e.g. local dev). This lets anyone confirm exactly which commit a running Fly release corresponds to without shell access.

**Rollback:** the primary rollback target for either app is always "whatever release was running immediately before the failed deploy" (for production, that is currently **v5** — see `audit/evidence/fly-staging-readiness-2026-07/FLY_PRODUCTION_BASELINE.md` for why v4 is a secondary fallback only, not primary). `flyctl releases --app <app>` plus `flyctl deploy --image <prior-release-image>` (or the Fly dashboard rollback action) is the mechanism; nothing new was built for this, since Fly's built-in release history already covers it.

**Render:** outside the active deployment path for both staging and production. `render.yaml` and `render-deploy.yml` are unmodified by this work and unrelated to it.

**Production promotion requires separate authorization.** This document, `fly.staging.toml`, and `fly-staging-deploy.yml` govern staging only. Nothing here deploys, or is intended to imply authorization to deploy, PR #18 (or any other change) to `denver-epc`. As of this section being written, **no application deployment — staging or production — has been performed** under `infra/fly-staging-readiness`; see `audit/evidence/fly-staging-readiness-2026-07/DEPLOYMENT_NOT_EXECUTED.md`.
