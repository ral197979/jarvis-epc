# Phase 7 — Performance Remediation
**Denver Engineering Platform · Redis, Workers, Architecture**
**Status:** ❌ NOT STARTED — Gap analysis and architecture documented

---

## Objective

Address the two structural performance gaps identified in the enterprise audit:
1. Redis on a 25MB free plan — unusable at production scale
2. Single-process architecture where all workers run in one Node.js process

Both gaps prevent horizontal scaling and limit production reliability.

---

## Gap 1: Redis — 25MB Free Plan

### Current State

```
# Detected in render.yaml (Render.com Redis free plan)
REDIS_URL: from environment (free plan)
```

The free Render Redis plan provides **25MB** of storage. At production scale:

| Data type | Estimated size |
|-----------|---------------|
| Per-session data (1k active users) | ~5MB |
| Rate-limit counters | ~2MB |
| Token revocation store (24h window) | ~10MB |
| Worker distributed locks | ~1MB |
| Background job queue (Bull/BullMQ) | ~5MB |
| **Total at 1k users** | **~23MB** |

The platform hits the 25MB limit with ~1,000 active users. Beyond that:
- Redis `OOM` errors crash the session/rate-limit middleware
- Token revocation stops working (security regression)
- Job queues fill up and workers stall

### Fix: Upgrade to Render Redis Starter ($10/mo)

The Render Redis Starter plan provides:
- 1GB RAM (40× current)
- Persistent storage
- No connection limits
- Daily backups

**render.yaml change required:**
```yaml
# Current:
- type: redis
  name: denver-eng-redis
  ipAllowList: []
  plan: free

# Target:
- type: redis
  name: denver-eng-redis
  ipAllowList: []
  plan: starter   # $10/mo — 1GB
```

**Break-even:** The token revocation store alone justifies the cost. A $10/mo Redis instance prevents a security regression where JWT revocation silently stops working when Redis OOMs.

### Cache Eviction Policy

With the upgrade, set an explicit eviction policy to prevent OOM:
```
maxmemory-policy: allkeys-lru
```

This evicts the least-recently-used keys when memory pressure approaches the limit, which is safe for rate-limit counters and cache (they can be regenerated) but could be problematic for the token revocation store (security-critical data should never be evicted).

**Recommended:** Split Redis into two logical databases:
- `db 0` (default, LRU eviction) — rate limits, caches, sessions
- `db 1` (no eviction) — token revocation, distributed locks

---

## Gap 2: Single-Process Worker Architecture

### Current State

All workers run inside `server.ts` via `startAllWorkers()`:

```typescript
// server.ts (reconstructed from audit)
import { startAllWorkers } from './workers'

// Workers that start in the same process as the HTTP server:
// - notificationWorker    (processes notification queue)
// - schedulerWorker       (SLA + automation scheduler)
// - slaWorker             (SLA policy enforcement)
// - reportWorker          (PDF/Excel generation)
// - iotWorker             (IoT threshold alerting)
```

### Why This Is a Problem

**1. No horizontal scaling**

When you scale the HTTP server to 2 instances (e.g., Render scaling), both instances start all workers. Workers that use distributed locks (via Redis) would double-fire on jobs — or worse, if the lock check has a race condition, the same job runs twice.

**2. CPU-bound work blocks HTTP**

PDF report generation and IFC parsing are CPU-intensive. Running them in the same process as the HTTP server means a large report generation could delay request handling.

**3. Single point of failure**

One unhandled worker exception can crash the HTTP server.

**4. Deployment coupling**

You can't deploy a worker fix without restarting the HTTP server (and vice versa).

### Recommended Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Render.com                                                        │
│                                                                   │
│  ┌─────────────────┐    ┌─────────────────┐    ┌──────────────┐ │
│  │  api-server     │    │  worker-service  │    │  redis       │ │
│  │  (HTTP)         │    │  (background)    │    │  (starter)   │ │
│  │                 │    │                  │    │              │ │
│  │  Express app    │    │  notification    │───▶│  job queues  │ │
│  │  All routes     │───▶│  scheduler       │    │  locks       │ │
│  │  Auth/tenant    │    │  sla             │    │  revocation  │ │
│  │  Scale: 1-4     │    │  report          │    │              │ │
│  │                 │    │  iot             │    └──────────────┘ │
│  └─────────────────┘    │  Scale: 1        │                     │
│                         └─────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

**Required changes:**

1. Extract `startAllWorkers()` to a separate `worker.ts` entry point
2. Add `render.yaml` background worker service:
```yaml
- type: worker
  name: denver-eng-workers
  env: node
  buildCommand: npm run build
  startCommand: node dist/worker.js
  plan: starter
  envVars:
    - fromGroup: denver-engineering
```

3. Keep HTTP server workers-free — it serves HTTP requests only
4. Workers pull jobs from Redis queues (already using Bull/BullMQ pattern)

**Cost impact:** +$7/mo for a Render Starter worker service

### Distributed Lock Upgrade

Currently workers use Redis-based locks, but the 25MB plan makes these unreliable. With the Redis Starter upgrade, locks become reliable. The lock pattern should be:

```typescript
// Use redlock (multiple Redis instances) for distributed safety
// For single Redis: use SET NX PX (atomic lock with TTL)
const lockKey = `lock:worker:${workerId}`
const acquired = await redis.set(lockKey, workerId, 'NX', 'PX', 30000)
if (!acquired) return  // another instance has the lock
```

---

## Gap 3: Database Connection Pool

### Current State

```typescript
// Detected in api/db/pool.ts
max: parseInt(process.env.DB_POOL_MAX ?? '10', 10)
```

10 connections is appropriate for development and early production. At scale:

| Scenario | Connection demand |
|----------|-----------------|
| 50 concurrent HTTP requests | ~50 connections |
| 5 workers × 2 concurrent queries | ~10 connections |
| Peak load (100 concurrent) | ~100 connections |

PostgreSQL itself limits connections (Render free plan: 25 connections). A connection pool of 10 means >10 concurrent database-needing requests queue up.

### Fix

Increase pool max with PgBouncer (connection pooler) or per-environment tuning:
```bash
# render.yaml environment variable
DB_POOL_MAX=25   # Match PostgreSQL connection limit
```

For production scale (100+ concurrent users):
- Upgrade to Render PostgreSQL Pro (100 connections)
- Or add PgBouncer sidecar (transaction-mode pooling → effectively unlimited connections to the app, bounded connections to PG)

---

## Performance Score Impact

| Metric | Current | After Remediation |
|--------|---------|-------------------|
| Redis capacity | 25MB (unstable at >1k users) | 1GB (stable to 100k users) |
| Worker isolation | Single process | Separate process |
| Horizontal scaling | Not safe | Safe for HTTP tier |
| Performance score | 52/100 | ~72/100 |

---

## Priority Order

1. **Redis upgrade** (highest ROI, $10/mo, prevents security regression) — do immediately
2. **Worker extraction** (enables safe horizontal scaling) — sprint 2
3. **Connection pool tuning** (low risk, config-only change) — sprint 2
4. **PgBouncer** (enterprise scale, needed at ~500 concurrent users) — sprint 3
