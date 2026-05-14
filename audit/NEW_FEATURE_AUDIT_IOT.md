# IoT Sensor Ingest Feature Audit — v10.5.0
**Scope:** `api/services/iot/sensorIngestService.ts`, `api/routes/iot.ts`, `api/db/migrations/055_iot_sensors.sql`
**Audited:** 2026-05-14

---

## Security

### ✅ PASS — Auth & Tenant Isolation (Management Endpoints)
All management endpoints (register, list, update thresholds, create token, etc.) require JWT auth via `requireAuth + requireTenant` middleware. `tenantId` is always middleware-derived.

### ✅ PASS — Ingest Token Design
- Token generated as 32 random bytes (256-bit entropy) — cryptographically strong
- Stored as SHA-256 hash — one-way, server never retains raw token after creation
- Expiry enforced: `WHERE ... AND (expires_at IS NULL OR expires_at > now())`
- Revocation field present on all tokens
- `UNIQUE (tenant_id, sensor_uid)` prevents cross-tenant sensor_uid hijacking

### ✅ ACCEPTABLE — `resolveIngestToken` uses `pool.query`
**File:** `sensorIngestService.ts:330`
The token resolution call uses `pool.query` rather than `tenantQuery`. This is **intentional and correct**: the tenant is unknown at resolution time — the query returns `tenant_id` which is then used to scope all subsequent calls. The SELECT returns only `tenant_id` and `edge_node_id` with no cross-tenant data exposure. No change required.

### ❌ P1 — `pool.query` in ingest hot path (no tenant_id in WHERE)
**File:** `sensorIngestService.ts:188–265`

Five `pool.query` calls in `ingestBatch` and `_evaluateAlerts` lack tenant scoping:

```typescript
// Line 188 — sensor_readings INSERT (no tenant guard in WHERE)
await pool.query(
  `INSERT INTO sensor_readings (tenant_id, sensor_id, ts, value, quality, raw) VALUES ($1,$2,...)`,
  [tenantId, sensorId, ...]
)

// Line 196 — sensors UPDATE (no tenant_id in WHERE clause)
await pool.query(
  `UPDATE sensors SET last_value=$2, last_reading_at=$3 WHERE id=$1`,
  [sensorId, item.value, ts]  // ← sensorId only, no tenant_id!
)

// Lines 244, 250, 259 — sensor_alerts SELECT/INSERT/UPDATE (no tenant_id in WHERE)
await pool.query(`SELECT id FROM sensor_alerts WHERE sensor_id=$1 ...`, [sensorId, ...])
await pool.query(`INSERT INTO sensor_alerts (tenant_id, sensor_id, ...) VALUES ($1,$2,...)`, ...)
await pool.query(`UPDATE sensor_alerts SET resolved_at=now() WHERE sensor_id=$1 ...`, [sensorId, ...])
```

While `sensorId` is always obtained through a prior `tenantQuery`, the subsequent raw `pool.query` calls bypass RLS entirely. If sensor_readings, sensors, or sensor_alerts have RLS policies, these calls operate outside those policies. More importantly, the UPDATE on `sensors` at line 196 has NO `tenant_id` filter — if UUIDs collide across tenants (extremely unlikely but not impossible with gen_random_uuid), it could update the wrong tenant's sensor.

**Fix:** Replace all 5 calls with `tenantQuery(tenantId, sql, params)` and add `AND tenant_id = $N` to all WHERE clauses.

### ⚠️ P2 — ttlDays SQL string interpolation
**File:** `sensorIngestService.ts:320`
```typescript
`now() + ($5 || ' days')::interval`
```
`ttlDays` is string-concatenated into the SQL interval cast. The route validates `parseInt(ttlDays, 10)` before passing it, so this is safe at runtime. However, the service itself does not validate the type — if called programmatically with a non-integer value (e.g. `"90; DROP TABLE"` in a unit test or internal caller), this would be exploitable.

**Fix:** Use a parameterized interval: `now() + make_interval(days => $5::int)`

### ✅ PASS — RLS on all sensor tables
Migration 055 enables RLS with correct tenant policies on: `sensors`, `sensor_readings`, `sensor_alerts`, `sensor_ingest_tokens`

---

## Correctness & Reliability

### ⚠️ P2 — Auto-registration assigns wrong projectId for batch ingest
**File:** `sensorIngestService.ts:171–181`
Unknown sensors are auto-registered using the `projectId` passed to `ingestBatch`. For `/iot/ingest` (Telegraf/EMQX endpoint), the route resolves `projectId` from the token's `edge_node_id` only if it exists — otherwise `projectId` is undefined and falls back to empty string or the first project found. Auto-registered sensors could land in the wrong project.

**File reference:** `routes/iot.ts:POST /iot/ingest` — check `projectId` resolution logic.

### ⚠️ P2 — N×4+ DB queries per reading (no batching)
`ingestBatch` performs for each item:
1. Sensor lookup (pre-loaded in bulk — ✅ correct)
2. `sensor_readings` INSERT
3. `sensors` UPDATE (last_value cache)
4. Up to 4 threshold checks × 2 queries each = up to 8 alert queries

For a Telegraf payload with 100 readings, this is 1 + 100×(2 + 8) = 1001 DB queries per request. At typical sensor frequencies (1 Hz per sensor), this would saturate the DB connection pool quickly.

**Fix:** Batch the `sensor_readings` inserts; defer last_value UPDATE to end-of-batch; coalesce alert state per sensor rather than querying per reading.

### ⚠️ P2 — Alert evaluation runs 4 threshold checks even when all are null
`_evaluateAlerts` iterates all 4 thresholds and does a DB query for existing alerts even when the threshold value is null. The null-check guard (`if (threshold == null) continue`) skips the trigger check, but this means: if a sensor has no thresholds configured, each reading still generates 4 pool queries (checking for existing alerts to auto-resolve).

**Fix:** Return early if all 4 thresholds are null.

### ⚠️ P3 — Auto-registered sensors use `'custom'` / `'raw'` as type/unit
Sensors auto-registered during ingest get `sensor_type='custom'` and `unit='raw'`. These are not valid enum values if the schema enforces an enum; they also provide no operational meaning. Users would need to manually update these after the fact.

**Fix:** Reject unknown sensor UIDs with a 422 response rather than auto-registering, or require explicit registration before ingest.

### ✅ PASS — Alert open/close logic
- One open alert per sensor+type+severity: `WHERE resolved_at IS NULL LIMIT 1` guard correct
- Auto-resolve when value returns to safe range: correct
- No alert spam on repeated threshold crossings

---

## Summary

| ID | Severity | Finding |
|---|---|---|
| IOT-001 | P1 | `pool.query` in ingest hot path — no tenant_id in sensor/alert WHERE clauses |
| IOT-002 | P2 | ttlDays string-interpolated into SQL interval (safe at runtime, unsafe by design) |
| IOT-003 | P2 | Auto-registration may assign wrong projectId |
| IOT-004 | P2 | N×4+ DB queries per reading — no batching (performance) |
| IOT-005 | P2 | Alert threshold queries fire even when thresholds are all null |
| IOT-006 | P3 | Auto-registered sensors get meaningless type/unit values |

**Overall: CONDITIONAL PASS — IOT-001 (P1) must be fixed; IOT-004 (P2) important for production load**
