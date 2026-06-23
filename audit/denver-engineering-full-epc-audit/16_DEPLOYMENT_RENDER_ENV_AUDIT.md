# 16 — Deployment, Render & Environment Audit

## Deployment Configuration

**Primary:** Render.com (`render.yaml`)  
**Alternative:** Docker Compose (`docker-compose.yml`) for self-hosted  
**Container:** Dockerfile.api + Dockerfile.frontend

---

## Render.yaml Analysis (Critical Issues)

```yaml
databases:
  - name: jarvis-epc-db
    databaseName: jarvis_epc
    plan: basic-256mb          # ⚠️ P0 — INADEQUATE
    postgresMajorVersion: '16'

services:
  - type: web
    name: jarvis-epc
    runtime: node
    plan: free                 # ⚠️ P0 — FREE TIER SLEEPS
    autoDeploy: true
    buildCommand: npm install --include=dev && npm run build
    startCommand: npm run api:start
    healthCheckPath: /api/v1/health
```

### P0 Issues

**1. `plan: free` (Web Service)**  
Render free tier:
- Sleeps after 15 minutes of inactivity
- Cold start takes 30–60 seconds
- 512MB RAM
- Shared CPU
- No uptime SLA

**For an EPC platform:** Field workers need instant access. IoT sensor ingest stops during sleep. Real-time WebSocket connections drop. Background workers restart from scratch. This is completely unacceptable for production.

**2. `plan: basic-256mb` (Database)**  
Render basic-256mb:
- 256MB RAM
- 1GB storage
- No connection pooling
- No read replicas

**For a 69-table EPC database with IoT ingest, vector embeddings, and multi-tenant workloads:** 256MB RAM and 1GB storage are critically insufficient. Vector embeddings alone can consume GBs.

### Missing from render.yaml

**No Redis service.** The `docker-compose.yml` includes Redis for:
- JWT refresh token revocation store
- Rate limiting cache (if using Redis-backed rate limiter)

Without Redis:
- `getTokenStore()` returns in-memory store → refresh tokens cannot be revoked across restarts
- This is a **P1 security issue** — stolen refresh tokens cannot be invalidated after server restart

### Environment Variables in Render

| Variable | Source | Status |
|---|---|---|
| NODE_ENV | `value: production` | ✅ |
| DATABASE_URL | `fromDatabase` | ✅ |
| SESSION_SECRET | `generateValue: true` | ✅ |
| JWT_SECRET | `generateValue: true` | ✅ |
| PORT | `value: '10000'` | ✅ |
| ANTHROPIC_API_KEY | **NOT IN render.yaml** | ❌ P1 |
| OPENAI_API_KEY | **NOT IN render.yaml** | ❌ P1 |
| ALLOWED_ORIGINS | **NOT IN render.yaml** | ❌ P1 |
| STORAGE_BACKEND | **NOT IN render.yaml** | ❌ P1 |
| EMBED_PROVIDER | **NOT IN render.yaml** | ❌ P1 |

**Critical:** `ANTHROPIC_API_KEY` is not declared in `render.yaml`. If not set as a Render environment variable manually, Ask Jarvis / all AI features will be disabled in production. Same for `OPENAI_API_KEY` (embeddings).

`ALLOWED_ORIGINS` not set → CORS blocks all browser requests.

---

## Build Process

```
buildCommand: npm install --include=dev && npm run build
startCommand: npm run api:start
```

**Build:** `npm install --include=dev && npm run build`  
- Installs ALL deps including devDependencies (needed for TypeScript/Vite build)
- Runs Vite build (`dist/`)
- No `npm run typecheck` in build — type errors don't block deploy
- No `npm run lint` in build — lint errors don't block deploy
- No `npm test` in build — test failures don't block deploy

**Risk P1:** Code with type errors, lint issues, or test failures can be deployed to production automatically.

**Start:** `npm run api:start` = `tsx api/server.ts`  
- Uses `tsx` runtime (no pre-compilation) — adds startup overhead, fine for this scale

---

## Auto-Deploy

`autoDeploy: true` — every push to main branch deploys automatically.

**Risk P1:** With no test gate in the build command, broken code auto-deploys.

---

## Health Check

`healthCheckPath: /api/v1/health`

The health endpoint:
```javascript
app.get('/api/v1/health', async (_req, res) => {
  // checks pool health, returns status
})
```
Health check includes DB pool health ✅. Render will restart the service if health check fails.

---

## Docker Compose (Alternative/Dev)

`docker-compose.yml` includes:
- PostgreSQL 16 ✅
- Redis 7 with password ✅
- API service ✅
- Frontend (nginx) ✅
- Internal network (DB not exposed to public) ✅

**Assessment:** Docker Compose is well-configured for self-hosted/dev. The Render.yaml is the gap.

---

## Dockerfile Assessment

**Dockerfile.api:** Node.js multi-stage build (assumed standard pattern)  
**Dockerfile.frontend:** Nginx serving static files

---

## Environment Variables (.env Analysis)

Present in `.env` (actual file, no secrets exposed in audit):
```
DATABASE_URL, DB_SSL, DB_POOL_MIN, DB_POOL_MAX
JWT_SECRET
ANTHROPIC_API_KEY
OPENAI_API_KEY
TOGETHER_AI_API_KEY
EMBED_PROVIDER, EMBED_DIMENSIONS, EMBED_MAX_INPUT_CHARS
PORT, NODE_ENV, LOG_LEVEL
ALLOWED_ORIGINS
STORAGE_BACKEND, STORAGE_LOCAL_DIR, MAX_FILE_SIZE_MB
KNOWLEDGE_INGEST_ROOTS
```

**`.env` is committed** — File exists at root with actual values, not just as `.env.example`. This is fine for local dev but should never reach a public repository. **Confirmed in `.gitignore`** — `.env` is excluded from git. ✅

---

## Scaling Concerns

| Concern | Issue |
|---|---|
| Single dyno | All 13 workers + HTTP server on one process |
| No horizontal scaling | Workers not distributed |
| No connection pooler | pg pool maxes out at DB_POOL_MAX connections |
| In-memory scheduler | Cron jobs not cluster-aware |
| WebSocket single-instance | No Redis pub/sub for WS cluster |

---

## Risk Summary

| Finding | Severity |
|---|---|
| Render free plan — service sleeps | P0 |
| Render basic-256mb DB — too small | P0 |
| ANTHROPIC_API_KEY not in render.yaml | P1 |
| ALLOWED_ORIGINS not in render.yaml | P1 |
| No Redis in render.yaml — token revocation broken | P1 |
| No test gate in CI/CD pipeline | P1 |
| autoDeploy without test validation | P1 |
| No horizontal scaling strategy | P2 |
| Workers co-located with HTTP server | P2 |
| Typecheck/lint not part of build command | P2 |
