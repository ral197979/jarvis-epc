# Deploying Denver on a Z.com VPS (self-hosted Docker)

A complete, copy-pasteable runbook to run Denver (`main` @ v2.0.1) on a **Z.com VPS** using the repo's
existing Docker stack. Self-hosted = lowest cost, you own ops (patching, backups, TLS).

**Documentation only.** Treat the embedded `docker-compose.zcom.yml`, `Caddyfile`, and `.env` as templates
to copy onto the VPS — they are not committed runtime config.

---

## 0. Why these specifics (don't skip)
- **Postgres MUST have `pgvector`.** Migration `071` runs `CREATE EXTENSION vector`. The repo's
  `docker-compose.yml` uses `postgres:16-alpine` (no pgvector) — for the VPS, swap to
  **`pgvector/pgvector:pg16`** (Postgres 16 + pgvector; `uuid-ossp`, `pgcrypto`, `pg_trgm` are standard
  contrib, already included). This is the single most important change.
- **Redis required** — `/api/v1/health` checks it; schedulers/workers in `api/server.ts` use it.
- **Always-on** — Denver runs background workers (scheduler, IFC parser, federated aggregation), so a VPS
  (not scale-to-zero functions) is the right shape.
- **App runs on Node 20** (`Dockerfile.api`), DB on Postgres 16 — keep this parity (v2.0.1 was validated on
  Node 20).

## 1. Z.com VPS sizing
- **Minimum:** 4 GB RAM / 2 vCPU / 80 GB SSD (single-tenant or staging).
- **Comfortable prod:** 8 GB RAM / 4 vCPU (Postgres + Redis + Node + Caddy on one box). Render prod used a
  `standard-4gb` DB — match RAM if you expect real load.
- OS: Ubuntu 22.04/24.04 LTS. Open only **22 (SSH, locked down), 80, 443** at the Z.com firewall.

## 2. Provision the host
```bash
# As root on the fresh Z.com VPS
apt-get update && apt-get -y upgrade
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sh
# Non-root deploy user
adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
# Firewall: SSH + web only
apt-get -y install ufw && ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
# (Recommended) SSH: key-only, disable root + password login in /etc/ssh/sshd_config, then: systemctl restart ssh
```

## 3. Get the code
```bash
su - deploy
git clone https://github.com/ral197979/jarvis-epc.git denver && cd denver
git checkout main   # v2.0.1 baseline
```

## 4. Compose override — `docker-compose.zcom.yml`
Layer this over the repo's `docker-compose.yml` to (a) use a pgvector image and (b) keep DB/Redis private
(no public ports). The app stays on its internal network; Caddy (next step) terminates TLS.
```yaml
# docker-compose.zcom.yml  — VPS overrides
services:
  postgres:
    image: pgvector/pgvector:pg16          # ← pgvector for migration 071
  api:
    ports: []                              # no public 3001; Caddy reverse-proxies it
  frontend:
    ports: []                              # no public 80/443; Caddy serves/proxies
networks:
  public:
    external: false
```
> Keep `postgres`/`redis` off the `public` network (the base compose already does — DB/Redis are
> internal-only). Never expose 5432/6379 to the internet.

## 5. TLS reverse proxy — `Caddy` (auto-HTTPS)
Simplest path to HTTPS on a VPS. Add a Caddy service (separate `docker-compose.caddy.yml` or append to the
override) and a `Caddyfile`:
```yaml
# docker-compose.caddy.yml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [public]
    depends_on: [api, frontend]
volumes:
  caddy_data:
  caddy_config:
```
```caddyfile
# Caddyfile  — replace domains
app.yourdomain.com {
    reverse_proxy frontend:80
}
api.yourdomain.com {
    reverse_proxy api:3001
}
```
Caddy obtains/renews Let's Encrypt certs automatically once DNS points at the VPS (Step 7).

## 6. Configure `.env`
```bash
cp .env.example .env
```
Fill the **required** keys (generate strong secrets: `openssl rand -hex 32`):
```ini
# Database (embedded pgvector container)
DB_NAME=jarvis_epc
DB_USER=jarvis
DB_PASSWORD=<openssl rand -hex 24>
DB_POOL_MIN=2
DB_POOL_MAX=20
# Redis
REDIS_PASSWORD=<openssl rand -hex 24>
# Auth — MUST be 32+ char random
JWT_SECRET=<openssl rand -hex 32>
# AI
ANTHROPIC_API_KEY=<your key>
# Runtime
NODE_ENV=production
LOG_LEVEL=info
# CORS + frontend → API URL (your real domains)
ALLOWED_ORIGINS=https://app.yourdomain.com
VITE_BACKEND_URL=https://api.yourdomain.com
# Storage (local volume is fine to start; S3 optional later)
STORAGE_BACKEND=local

# Federation flags — keep OFF (v2.0.1 ships dormant; turn on per Epic-1 rollout later)
COMMISSIONING_EXTERNAL=false
CAPABILITY_REGISTRY=false
UNIVERSAL_EVENTS=false
OBJECT_REGISTRY=false
KNOWLEDGE_GRAPH=false
IDEMPOTENCY=false
OPENAPI_ENABLED=false
DENVER_MCP_SERVER=false
EAP_ENABLED=false
```
> `DATABASE_URL`/`REDIS_URL` are derived inside compose from `DB_*`/`REDIS_PASSWORD` (api service env);
> you do not need to set them by hand when using the embedded containers.

## 6.1 Optional integrations & credentials
Everything below is **off until you set credentials** — the base deploy needs none of them. Add only what
you use (status + files in `docs/integrations/connector-status.md`). Implemented connectors:
```ini
# File storage on S3 (instead of the local uploads volume)
STORAGE_BACKEND=s3
S3_BUCKET=...
S3_ENDPOINT=...            # optional (for S3-compatible providers)
AWS_REGION=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
#   also: docker exec into api or add to image — npm i @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# Error tracking (optional; Pino-only if unset)
SENTRY_DSN=...

# Slack / Teams / QuickBooks are configured PER-TENANT at runtime via
#   POST /api/v1/integrations  (not env) — Slack bot token / webhook URL,
#   Teams webhook URL, Intuit OAuth client+tokens. No VPS env needed.

# SSO / SCIM (enterprise): configure SAML IdP metadata + SCIM token via the
#   tenant/admin APIs; no extra VPS env beyond JWT_SECRET.
```
> **Not wired** (don't expect them to work): Procore, Autodesk/BIM360, SAP, Primavera, MS Project, Aconex
> are stub sync types; **Stripe** is data-model only. See the status matrix.

## 7. DNS
Point both records at the VPS public IP (A/AAAA):
```
app.yourdomain.com  → <vps-ip>
api.yourdomain.com  → <vps-ip>
```

## 8. Bring it up + run migrations
```bash
docker compose -f docker-compose.yml -f docker-compose.zcom.yml -f docker-compose.caddy.yml up -d --build
docker compose logs -f api      # watch: "[migrate] Applied N migration(s)" then "listening on port 3001"
```
The api container runs `npm run db:migrate`-equivalent on boot (via `start()`); on a fresh DB it applies
`000–081` (≈ the 81 migrations validated on a clean PG during v2.0.1). Migration `001` self-provisions the
`jarvis_app` role; `071` creates `vector` (works because of the pgvector image).

## 9. Verify (the v2.0.1 acceptance gate)
```bash
# On the box (internal):
curl -s localhost:3001/api/v1/health | jq .       # status:ok, db.ok:true, redis.ok:true
# Public (after DNS+TLS):
curl -s https://api.yourdomain.com/api/v1/health   # 200, status ok
curl -s -o /dev/null -w '%{http_code}\n' https://api.yourdomain.com/metrics   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://api.yourdomain.com/api/v1/projects   # 401 (authz works)
```
Confirm logs show **no startup errors** and **no federation init failures** (flags off). This is the same
suite Render verification was gated on.

## 10. Backups (don't skip)
```bash
# Nightly pg_dump to a volume + offsite (cron on the host, as deploy user)
0 2 * * * docker exec jarvis_epc_db pg_dump -U jarvis jarvis_epc | gzip > ~/backups/db-$(date +\%F).sql.gz
# Retain 14 days; sync ~/backups offsite (rclone/S3/another host).
```
Rollback = restore the latest dump (migrations are forward-only; the snapshot is the rollback).

## 11. Operations
- **Updates:** `git pull && docker compose -f docker-compose.yml -f docker-compose.zcom.yml -f docker-compose.caddy.yml up -d --build` (migrations apply idempotently — already-applied are skipped).
- **Logs/metrics:** `docker compose logs`, `/metrics` (the repo also has `docker-compose.observability.yml` if you want Prometheus/Grafana later).
- **Restart policy:** all services `restart: unless-stopped` (survive reboots).
- **Secrets rotation:** rotate `JWT_SECRET`/`DB_PASSWORD`/`REDIS_PASSWORD` via `.env` + `up -d`.

## 12. Z.com-specific notes
- Z.com gives a plain VPS — there is **no managed Postgres/Redis**, so the embedded pgvector + redis
  containers above are the stack. Confirm the plan's RAM (≥4 GB) and that outbound HTTPS works (for
  Let's Encrypt + the Anthropic API).
- Set the **firewall in the Z.com panel** *and* `ufw` (defense in depth); expose only 80/443 (+ SSH).
- Snapshots: if Z.com offers VPS snapshots, schedule them as a coarse second backup layer.

## 13. Cost vs Render (directional)
One Z.com VPS (~$5–15/mo depending on RAM) replaces Render's web + Postgres(`standard-4gb`) + Redis +
staging duplicates — typically a large saving — at the cost of self-managed ops. If ops burden grows,
the lower-effort middle ground is **Neon (Postgres+pgvector) + Upstash (Redis) + a small always-on box**
(set `DATABASE_URL`/`REDIS_URL` to the managed services and drop the postgres/redis containers).

## 14. Cutover checklist
- [ ] VPS provisioned, firewall = 22/80/443, non-root docker user
- [ ] DNS A records → VPS for app + api
- [ ] `.env` filled (strong `JWT_SECRET`/`DB_PASSWORD`/`REDIS_PASSWORD`; flags OFF)
- [ ] `pgvector/pgvector:pg16` image in the override
- [ ] `docker compose up` → migrations applied (81), api "listening"
- [ ] Caddy issued TLS certs
- [ ] `/api/v1/health` 200 (db+redis ok), `/metrics` 200, `/projects` 401, no startup errors
- [ ] Nightly pg_dump + offsite configured
- [ ] (then) tag `v2.0.1`, publish release notes — release gated on this host being healthy
