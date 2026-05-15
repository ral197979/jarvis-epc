# Deployment & Runtime Health Audit
**Denver Engineering / Ava Platform — v13.0.0**
**Audit Date:** 2026-05-12

---

## Summary
**Score: 80 / 100 — PASS WITH NOTES**

---

## Migration Coverage

| Metric | Value |
|--------|-------|
| Total migrations | 55 (001–055) |
| Last migration | `055_iot_sensors.sql` (v10.5.0) |
| EVM schema | `053_evm.sql` — RLS ✅ |
| Schedule import schema | `054_schedule_import.sql` — RLS ✅ |
| IoT schema | `055_iot_sensors.sql` — RLS ✅ |

All migrations from 050–055 (v10.x additions) have proper RLS and tenant_id FK enforcement.

**Migrations without CREATE TABLE (index/fix-only migrations):**
- `012_audit_retention.sql` — retention index only ✅
- `018_project_agent_mode.sql` — index on projects ✅
- `024_fix_extraction_provenance.sql` — column fix ✅
- `025_vector_embeddings.sql` — pgvector extension + index ✅
- `027_cx_pack_test_pack_fk.sql` — FK fix ✅
- `028_coverage_perf.sql` — performance indexes ✅
- `052_cost_db_seed.sql` — seed data, no tables ✅

---

## Health Endpoint

**Endpoint:** `GET /api/v1/health`
**Response schema:**
```json
{
  "status": "ok" | "degraded",
  "version": "9.0.0",
  "uptime": <seconds>,
  "ts": "<ISO8601>",
  "db": { ...poolStats },
  "storage": "local" | "s3"
}
```

Live probe against Render deployment URL returned `404 Not Found` — the service URL used (`jarvis-api-latest.onrender.com`) may be incorrect. The Render service ID is `srv-d7ff727aqgkc739pdch0`.

**Action:** Confirm actual Render external URL and re-probe. The endpoint implementation is correct in code.

---

## Workers & Lifecycle

Workers registered in `api/server.ts` startup/shutdown:

| Worker | Start | Stop |
|--------|-------|------|
| `startIfcParseWorker()` | ✅ Called after `registerKnowledgeEmbedHandler` | ✅ `stopIfcParseWorker()` in graceful shutdown |
| `startFederatedAggregationWorker()` | ✅ Called in startup | ✅ `stopFederatedAggregationWorker()` in graceful shutdown |

Both workers poll on intervals and clean up properly on SIGTERM.

---

## Rate Limiting

- Auth routes: `authLimiter` applied to `/auth/login` and `/auth/refresh` ✅
- AI gateway: `aiLimiter` applied to `/api/v1/gateway` ✅
- Agent orchestration endpoints: **No rate limit detected** ⚠️

---

## Idempotent Migrations

Patterns used:
- `CREATE TABLE IF NOT EXISTS` — standard ✅
- `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` — used for `CREATE TYPE` in IoT migration ✅
- `ON CONFLICT DO UPDATE` (UPSERT) used in schedule import id_map ✅

---

## Ingest Token Security

IoT ingest token architecture (`api/routes/iot.ts`):
- Tokens are 32-byte random hex, stored as SHA-256 hash
- Identified by length: 64-char bearer = ingest token (vs JWT)
- One-time display warning on creation ✅
- `last_used_at` tracked ✅

**Gap:** No token expiry enforcement — tokens live indefinitely unless manually revoked. ⚠️

---

## Score Breakdown

| Domain | Status | Score |
|--------|--------|-------|
| Migration completeness | ✅ 55 migrations, all complete | 25/25 |
| Worker lifecycle | ✅ Proper start/stop | 20/20 |
| Health endpoint | ⚠️ Implemented but live URL unconfirmed | 15/20 |
| Rate limiting | ⚠️ Agent routes unprotected | 12/15 |
| Token security | ⚠️ No expiry | 8/10 |
| Idempotent migrations | ✅ Correct patterns | 10/10 |
| **Total** | | **90/100** → adjusted for live health probe: **80/100** |
