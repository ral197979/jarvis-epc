# Staging Environment

Denver Engineering runs a production-parity staging environment for validating changes before they reach production users.

Authoritative deployment guide: [`docs/deploy/fly-neon-upstash.md`](./docs/deploy/fly-neon-upstash.md) (§12 covers staging).

## Architecture

| Service | Staging | Production |
|---------|---------|------------|
| Web API + SPA | `denver-epc-staging` (Fly.io, org `personal`, region `iad`) | `denver-epc` (Fly.io, same org/region) |
| Background workers | In-process with the web server | In-process with the web server |
| PostgreSQL | Neon — dedicated staging branch/project | Neon — production project |
| Redis | Optional (Upstash); a single instance uses the in-memory token store | Optional (Upstash); a single instance uses the in-memory token store |

Infrastructure config lives in `fly.staging.toml` and `fly.toml` at the repo root. `api/worker.ts`
is an undeployed second entrypoint retained for a future dedicated worker tier — it is **not**
part of either environment today.

## Deploy Flow

```
developer push → GitHub Actions CI (.github/workflows/ci.yml, push + PR on main)
  └── npm run typecheck:all
  └── npm run lint
  └── npm test -- --run
  └── npm run build
  └── fly-staging-config-guard  (scripts/validate-fly-staging-config.mjs)

manual promotion → workflow_dispatch only
  ├── Fly Staging Deploy (.github/workflows/fly-staging-deploy.yml, requires a `ref` input)
  │     └── denver-epc-staging   ← health check: GET /api/v1/health → 200
  └── Fly Deploy       (.github/workflows/fly-deploy.yml)
        └── denver-epc
```

**Neither environment auto-deploys.** CI runs on every push and PR to `main` but contains no
deploy step; both Fly workflows are `workflow_dispatch` only. `scripts/validate-fly-staging-config.mjs`
fails CI if the staging config or workflow ever drifts toward being able to target production
(wrong app name, a `push` trigger, a user-suppliable app-name input, and similar).

Production deploys require separate, explicit owner authorization.

## Environment Differences

| Setting | Staging | Production |
|---------|---------|------------|
| `NODE_ENV` | `production` (staging runs the real production code paths) | `production` |
| `APP_ENV` | `staging` | unset |
| `LOG_LEVEL` | `debug` | `info` |
| `min_machines_running` | 0 (`auto_stop_machines=true`, cost control) | 1 (always-on — workers run in-process) |
| Log format | JSON (structured) | JSON (structured) |
| Pino-pretty | ❌ | ❌ |

Both staging and production emit structured JSON to stdout for Fly.io log shipping.

`DATABASE_URL_APP` is **mandatory with no fallback in both environments** — since AUDIT-P0-06 the
API refuses to boot in `NODE_ENV=production` if it is unset. There is no code path that falls back
to the owner-level `DATABASE_URL` for runtime traffic. See `api/db/pool.ts`.

Staging must use its own Neon branch or project — never production's database, and never merely a
schema inside it. Using production customer data in staging requires separate explicit approval.

## Initial Setup

### 1. Provision the Neon staging branch

Create a dedicated Neon branch/project (Postgres 16, `pgvector` available) and an application-level
role for it. Provisioning credentials is a separate, explicitly-authorized step — connection strings
are never committed to this repo.

### 2. Set GitHub Actions secrets

Supplied out-of-band; values are never recorded in this repo.

| Secret | Description |
|--------|-------------|
| `FLY_API_TOKEN` | Fly.io deploy token |
| `STAGING_DATABASE_URL_APP` | Neon staging connection string for the least-privilege app role |
| `STAGING_JWT_SECRET` | Staging JWT signing secret (never reuse production's) |
| `ANTHROPIC_API_KEY` | Optional — staging Anthropic key |

### 3. Set app secrets on Fly

Set any remaining runtime secrets on the staging app with `flyctl secrets set --app denver-epc-staging`:
`OPENAI_API_KEY`, `ALLOWED_ORIGINS`, `API_BASE_URL`, `APP_BASE_URL`, `SAML_SP_CERT`, `SAML_SP_KEY`
(generate separately — never reuse the production cert), `SENTRY_DSN`, `METRICS_TOKEN`.

### 4. Deploy

Run the **Fly Staging Deploy** workflow with the git ref to deploy. It passes
`--env APP_RELEASE_SHA=<git-sha>`, so `GET /api/v1/health` reports a non-secret `releaseSha`
confirming exactly which commit is running.

### 5. Seed staging database

The staging DB runs migrations automatically on deploy (same `runMigrations()` call in server startup). No seed script is required — the platform creates data on first use.

For SAML testing, register a test tenant via the API:

```bash
curl -X POST https://api-staging.yourcompany.com/api/v1/tenants \
  -H 'Content-Type: application/json' \
  -d "{ \"name\": \"Acme Test\", \"slug\": \"acme-test\", \"email\": \"admin@acme.test\", \"password\": \"${TEST_TENANT_PASSWORD}\" }"
```

## Rollback

The rollback target is whatever release was running immediately before the failed deploy.
List releases with `flyctl releases --app <app>`, then `flyctl deploy --image <prior-release-image>`
(or use the Fly dashboard rollback action).

## Prometheus Scraping

The `/metrics` endpoint is live on both staging and production. To configure Prometheus:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'denver-engineering-staging'
    scrape_interval: 30s
    static_configs:
      - targets: ['api-staging.yourcompany.com:443']
    scheme: https
    authorization:
      credentials: '<METRICS_TOKEN>'

  - job_name: 'denver-engineering-production'
    scrape_interval: 15s
    static_configs:
      - targets: ['api.yourcompany.com:443']
    scheme: https
    authorization:
      credentials: '<METRICS_TOKEN>'
```

Key metrics to alert on:

| Metric | Alert condition |
|--------|-----------------|
| `http_request_duration_ms_p99` | > 2000ms for 5 minutes |
| `auth_login_total{result="account_locked"}` | spike > 20/min (brute force) |
| `background_job_total{status="failed"}` | any increase over 5 min |
| `nodejs_heap_used_bytes` | > 80% of heap limit |
| `process_resident_memory_bytes` | > 90% of instance RAM |

## Staging Checklist (before promoting to production)

- [ ] `GET /api/v1/health` returns `200 ok` with all checks green
- [ ] `GET /metrics` returns Prometheus text (or 401 if METRICS_TOKEN not set)
- [ ] Login flow works (email + password)
- [ ] SAML SSO login works with at least one test IdP config
- [ ] SCIM provisioning: POST /scim/v2/Users creates a user
- [ ] Audit log export: GET /api/v1/audit/export?format=csv returns data
- [ ] Background jobs: scheduler is running (`flyctl logs --app denver-epc-staging` shows `[scheduler] Started`)
- [ ] No errors in Sentry staging project after smoke test
