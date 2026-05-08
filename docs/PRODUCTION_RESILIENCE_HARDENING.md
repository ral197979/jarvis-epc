# Production Resilience Hardening

**Denver Engineering — Ava Phase 4 (v4.40.0)**

## Overview

Phase 4 introduces three resilience primitives: distributed database-backed leases (Worker Supervisor), a circuit breaker (Circuit Breaker), and stale lock recovery. Together these prevent split-brain worker scenarios, contain cascading failures to external integrations, and ensure cluster restarts recover automatically without manual intervention.

---

## Worker Supervisor (Distributed Locking)

### Design

Distributed locks are implemented using the `worker_leases` table rather than `pg_advisory_lock`. This avoids connection-pooling issues where advisory locks are tied to a specific connection and can leak if the connection is recycled.

The `worker_leases` table has `UNIQUE(lease_key)` which enables atomic `INSERT ON CONFLICT DO NOTHING` semantics: the insert either succeeds (we hold the lease) or silently fails (someone else holds it).

### Schema

```sql
CREATE TABLE worker_leases (
  lease_key    TEXT PRIMARY KEY,
  worker_id    TEXT NOT NULL,
  acquired_at  TIMESTAMPTZ DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ DEFAULT now()
);
```

No RLS — this is a system-level table, not tenant-scoped.

### Lease Acquisition

```
acquireLease(key, workerId, ttlSeconds):
  BEGIN
  INSERT INTO worker_leases ... ON CONFLICT (lease_key) DO NOTHING
  if rowCount > 0 → COMMIT, return true  (we inserted = we hold it)
  SELECT existing lease
  if heartbeat_at < now() - ttlSeconds → UPDATE (optimistic CAS on heartbeat_at)
    COMMIT, return (rowCount > 0)
  ROLLBACK, return false
```

### Heartbeat

Workers maintain their lease with periodic heartbeats:

```typescript
startHeartbeat(key, workerId, intervalMs = 10_000, ttlSeconds = 30)
  → setInterval(() => renewLease(key, workerId, ttlSeconds), intervalMs)
```

The heartbeat interval should be < ttl/3 to prevent false expiry under normal load.

### Stale Lease Recovery

If a worker crashes without releasing its lease, the next worker to attempt acquisition will detect a stale heartbeat and reclaim:

```
reclaimStaleLease(key, newWorkerId, ttlSeconds):
  UPDATE worker_leases
  SET worker_id = $1, acquired_at = now(), heartbeat_at = now(), ...
  WHERE lease_key = $3 AND heartbeat_at < now() - ($2 seconds)
```

The `heartbeat_at < now() - ttl` condition prevents racing workers from stealing active leases.

### Expired Lease Cleanup

`purgeExpiredLeases()` deletes all leases past their `expires_at`. Designed to run periodically to prevent table bloat.

---

## Circuit Breaker

### States

```
closed → (failures >= threshold) → open → (timeout elapsed) → half_open → (successes >= threshold) → closed
```

| State | Behavior |
|-------|----------|
| `closed` | Normal operation, failures increment counter |
| `open` | All calls rejected with `CircuitOpenError` |
| `half_open` | Limited probe calls allowed; success closes, failure re-opens |

### Configuration

```typescript
interface CircuitBreakerConfig {
  failureThreshold:  number  // default: 5
  timeout:           number  // ms before open→half_open; default: 30_000
  successThreshold:  number  // successes needed in half_open to close; default: 2
  halfOpenRequests:  number  // max concurrent probes; default: 1
}
```

### CircuitOpenError

Thrown when circuit is open. Carries:
- `circuitName: string` — circuit identifier
- `remainingMs: number` — milliseconds until half_open transition

### Global Registry

`createCircuitBreaker(name)` registers circuits in a module-level `Map`. `getAllCircuitStats()` returns stats for all registered circuits, enabling health endpoint aggregation. `resetAllCircuits()` resets all to closed state (used in tests and maintenance).

### Integration Pattern

Wrap external calls in `cb.execute(fn)`:

```typescript
const cb = createCircuitBreaker('sap-connector')
try {
  const result = await cb.execute(() => callSapApi(payload))
} catch (err) {
  if (err instanceof CircuitOpenError) {
    // Circuit open — queue for retry or degrade gracefully
  }
}
```

---

## Worker Leases + Circuit Breakers in Context

| Scenario | Mechanism | Response |
|----------|-----------|----------|
| Worker crash mid-job | Stale lease detection | Next worker reclaims after TTL |
| Duplicate worker startup | Unique constraint on lease_key | Second worker gracefully yields |
| External API down | Circuit breaker opens | Immediate rejection, no cascading timeouts |
| API recovers | Half-open probe | One test call, then circuit closes |
| Job queue saturation | FOR UPDATE SKIP LOCKED | Workers pull without contention |
| Split brain | Single DB as coordination point | No additional coordinator needed |
