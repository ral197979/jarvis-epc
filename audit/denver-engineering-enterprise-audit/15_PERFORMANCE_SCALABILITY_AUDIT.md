# 15 — PERFORMANCE & SCALABILITY AUDIT

---

## Architecture Constraints

**Runtime model:** Single Node.js process (HTTP server + all background workers)  
**Database:** PostgreSQL 16 (Render `standard-4gb` plan = 4GB RAM)  
**Cache:** Redis (Render `free` plan = 25MB RAM)  
**Connection pool:** `DB_POOL_MIN=2`, `DB_POOL_MAX=10` (from render.yaml)

---

## Request Latency Estimates

### Tier 1 — Fast Paths (< 50ms p99)

Simple tenant-scoped queries with indexed lookups:

| Endpoint | Complexity | Estimated p99 |
|---------|-----------|--------------|
| GET /api/v1/actions/my | Single indexed query | 15–30ms |
| GET /api/v1/projects | Paginated list | 20–40ms |
| GET /api/v1/sensors/:id | Point lookup + latest | 10–25ms |
| GET /api/v1/health | No DB | < 5ms |
| POST /api/v1/auth/token | bcrypt verify + JWT | 150–300ms |

### Tier 2 — Medium Paths (50–500ms)

Multi-join queries, computations, or external API calls:

| Endpoint | Complexity | Estimated p99 |
|---------|-----------|--------------|
| GET /api/v1/projects/:id/evm/metrics | 4 DB queries + math | 80–200ms |
| GET /api/v1/projects/:id/cost-control | Aggregation query | 100–300ms |
| GET /api/v1/schedule/:id/cpm | DB + CPM computation | 50–200ms |
| POST /api/v1/sensors/tokens | Token gen + DB | 30–80ms |

### Tier 3 — Slow Paths (> 500ms)

AI calls, external APIs, complex aggregations:

| Endpoint | Complexity | Estimated p99 |
|---------|-----------|--------------|
| POST /api/v1/ask | Embed + pgvector + Claude | 3–15s |
| POST /api/v1/commissioning/generate-draft | AI generation | 10–60s |
| GET /api/v1/projects/:id/evm/scurve | Full history scan | 200–800ms |
| POST /api/v1/bim-models/:id/parse (IFC) | web-ifc parse | 30–300s |

---

## Scaling Bottlenecks

### Bottleneck 1: Single Process (All Workers + HTTP)

All 14 background workers + HTTP server share one Node.js process and 10 DB connections.

**Impact at load:**
- IFC parse job (web-ifc) blocks the event loop → HTTP latency spikes
- Knowledge embedding worker consumes DB connections → fewer for HTTP requests
- SLA engine poller + compliance watcher + KPI snapshot all competing for pool slots

**Breaking point estimate:** ~50 concurrent users on a single Render `standard` instance (1 vCPU, 2GB RAM).

### Bottleneck 2: DB Connection Pool (max 10)

At 10 connections max, each connection can serve ~1 query at a time.

**At 50 concurrent HTTP requests:**
- Each request needs at most 1 tenantQuery (typically)
- With the transaction wrapper (BEGIN/SET/query/COMMIT), each tenantQuery holds a connection for ~5ms
- Pool utilization: 50 req/s × 5ms = 0.25 connections average → feasible up to ~2,000 req/s theoretically
- **Reality:** Background workers consume 2–4 connections at all times → effective max ~6 for HTTP

**Recommendation:** Increase `DB_POOL_MAX` to 20 for medium production load.

### Bottleneck 3: Redis (Free Plan — 25MB)

Current Redis usage:
- JWT revocation store (jti blacklist)
- Rate limiting counters
- Session caching
- Pub/sub for WebSocket events

**25MB is extremely limited.** With 1,000 active users each having tokens, and WebSocket pub/sub traffic, the 25MB limit will be exhausted.

**Action required:** Upgrade to Render Redis `starter` (500MB) before launch.

### Bottleneck 4: No Query Result Caching

No Redis caching of expensive query results:
- EVM metrics recomputed on every request
- Cost control snapshots recomputed on every request
- KPI dashboard rebuilt from scratch each load

**Opportunity:** Cache EVM metrics for 5 minutes (results change only when actuals/progress are recorded).

### Bottleneck 5: Unbounded SELECT * in 20 Routes

From source (verified in Backend Architecture audit):

```sql
SELECT * FROM compliance_tasks     -- no LIMIT
SELECT * FROM punch_items          -- no LIMIT on some paths
```

These can return thousands of rows with no pagination enforcement.

---

## Missing Indexes (From Database Audit)

These missing indexes directly impact performance:

| Table | Missing Index | Query Pattern |
|-------|-------------|--------------|
| `chat_messages` | `session_id` | Load message history by session |
| `sensor_readings` | `sensor_id, ts DESC` | Time-series dashboard queries |
| `audit_log` | `user_id, created_at` | Audit history by user/date |
| `actions` | `assigned_to_user_id, status` | SLA engine + my-actions list |
| `evm_actuals` | `project_id, period_date` | EVM metric computation |

Each of these will perform sequential scans on large tables.

---

## Horizontal Scaling Assessment

**Can it scale horizontally (multiple instances)?**

| Component | Horizontal-safe? | Issue |
|-----------|-----------------|-------|
| HTTP server | ✅ Yes | Stateless |
| WebSocket server | ⚠️ Partial | Redis pub/sub handles cross-instance; session affinity needed |
| Background workers | ❌ No | setInterval workers will double-fire on 2nd instance |
| File uploads | ✅ Yes | S3 backend is shared |
| DB queries | ✅ Yes | Connection pooling per instance |

**Critical issue:** The setInterval-based workers will run duplicates across instances. A second Render instance will double-process IFC parse jobs, double-send notifications, and double-compute KPI snapshots.

**Fix required before horizontal scaling:** Implement distributed locking (Redis `SET NX` or BullMQ) on all background workers.

---

## Load Testing Assessment

**No load tests found.** The test suite contains unit and integration tests but no:
- `k6` or `autocannon` load test scripts
- Performance baseline measurements
- Regression benchmarks

**Risk:** Unknown breaking point in production.

---

## Performance Summary

| Area | Grade | Key Finding |
|------|-------|-------------|
| Database queries | B | Raw SQL, tenant-scoped; missing key indexes |
| Connection pooling | C+ | Max 10; workers compete with HTTP |
| Caching | D | No query result cache |
| Worker architecture | C | Single process; IFC blocks event loop |
| Horizontal scaling | D | Worker duplication; Redis too small |
| Load testing | F | None found |
| API response times | B+ | Fast for simple queries; slow for AI paths |

**Performance & Scalability Score: 52/100**

**Recommended before 100+ user production launch:**
1. Upgrade Redis to 500MB plan
2. Increase DB_POOL_MAX to 20
3. Add Redis-distributed worker locking
4. Add index on `sensor_readings(sensor_id, ts)` and `actions(assigned_to_user_id, status)`
5. Cache EVM metrics with 5-minute TTL
