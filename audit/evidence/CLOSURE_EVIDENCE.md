# Certification Closure — Raw Evidence (2026-06-21)

Environment: local macOS, PostgreSQL 18.4 (Homebrew), Redis on :6379, Node 24, Docker 28.
Test database built from the repo's own migrations (`api/db/migrate.ts`).

---

## 1. AUD-002 — Runtime RLS enforcement (DECISIVE PROOF)

Setup: DB `denver_audit_test` owned by role `jarvis` (table owner, **non-superuser**, `rolbypassrls=f`). App role `jarvis_app` (**non-owner, NOBYPASSRLS**) granted via migration `075`. Two tenants seeded: A (`aaaa…0001`, 2 projects), B (`bbbb…0002`, 1 project). `projects` has `relrowsecurity=t`, policy `tenant_isolation_projects USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)`.

```
TEST 1 — OWNER (jarvis) — demonstrates the ORIGINAL VULN (owner bypasses RLS):
  owner_sees = 3        (sees ALL tenants' rows regardless of GUC)   ← AUD-002 vuln confirmed

TEST 2 — APP ROLE (jarvis_app, NOBYPASSRLS) — the FIX:
  (2a) GUC = Tenant A  -> sees_A = 2  (A-P1,A-P2)      ✅ only A
  (2b) GUC = Tenant B  -> sees_B = 1  (B-P1)           ✅ only B
  (2c) NO GUC set      -> sees_none = 0                ✅ fail-closed

TEST 3 — cross-tenant WRITE (jarvis_app, GUC=A, INSERT row for tenant B):
  ERROR: new row violates row-level security policy for table "projects"   ✅ blocked
```

End-to-end through the **live application** (server booted with `DATABASE_URL_APP=…jarvis_app…`):
```
GET /api/v1/projects  (JWT tid=Tenant A)  ->  HTTP 200, 2 rows   ✅ tenantQuery on jarvis_app enforces RLS
```
Repeatable script: `audit/evidence/AUD-002_rls_validation.sql`.

**Verdict: AUD-002 RUNTIME-VERIFIED → CLOSED.**

---

## 2. AUD-008 — Backup / restore drill

Logical backup (`pg_dump -Fc`, v18.4) → restore into a clean DB → integrity + isolation re-checked.

```
BACKUP_MS = 182      RESTORE_MS = 738      DUMP_SIZE = 921 KB
post-restore: tenants=2, projects=3, migrations=68   (matches source)
post-restore isolation (jarvis_app, GUC=A) -> 2      ✅ RLS still enforced after restore
post-restore isolation (jarvis_app, no ctx) -> 0     ✅ fail-closed after restore
```
Restore caveat (AUD-032): the `vector` extension must be pre-created by a superuser
before `pg_restore` (else `knowledge_chunks` and pgvector objects error). Documented in the DR runbook.

**Verdict: restore CAPABILITY verified locally. Production Render PITR/retention enablement + a production-scale restore drill remain operator actions (no Render dashboard access from the audit environment).**

---

## 3. AUD-031 (new) — Migration chain not clean-rebuildable → FIXED

Original `070_rls_missing_tables.sql` hard-referenced four tables never created by any migration
and unused by the app: `meeting_minutes`, `proposal_line_items`, `notification_preferences`,
`timesheet_entries`. A from-scratch rebuild failed at 070 (DR blocker). Rewrote 070 to enable RLS
only on existing tables (existence-guarded loop).

```
BEFORE: migrate exit=1 — "relation \"meeting_minutes\" does not exist" (then proposal_line_items …)
AFTER : migrate exit=0 — Applied 74 migration(s); 218 tables; full chain 001→075 clean from empty DB ✅
```

**Verdict: AUD-031 FIXED + VERIFIED (clean rebuild).**

---

## 4. Phase 13 — Load test (single local instance, authenticated DB read `GET /api/v1/projects`)

`autocannon`, 10s/level, `DATABASE_URL_APP=jarvis_app`, `DB_POOL_MAX=40`, rate-limiter raised to isolate app capacity.

| Concurrency | p50 | p97.5 | p99 | avg | req/s (avg) | errors |
|---|---|---|---|---|---|---|
| 100  | 18 ms | 24 ms | **28 ms** | 18.4 ms | ~5,300 | 0 |
| 500  | 91 ms | 167 ms | **209 ms** | 96.6 ms | ~5,114 | 0 |
| 1000 | 199 ms | 333 ms | **739 ms** | 213.8 ms | ~4,634 | 0 |
| 5000 | 816 ms | 5,232 ms | **7,497 ms** | 1,020 ms | ~4,758 | 448 (connection saturation; **no crash**) |

Separately, with the **default** rate limiter (600/min/IP): after ~600 2xx the endpoint returns 429 —
**rate limiting sheds load correctly under stress** (DoS protection verified).

Interpretation: single instance sustains ~5k req/s on the full authenticated DB path with p99 < 30 ms at 100 VUs
and < 750 ms at 1,000 VUs; degrades gracefully (no crash) at 5,000 concurrent connections (pool-bound).
CPU/memory/DB-load instrumentation and a true distributed 5,000-user production-scale test require a staging
environment matching the Render plan + horizontal scaling — recommended as ongoing validation.

---

## 5. Phase 14 — Recovery test

Restore into a clean database (§2) → verified: row counts match source; tenant isolation still enforced
post-restore for `jarvis_app` (A→2, no-context→0); migration ledger intact (`schema_migrations`).
**Data integrity and tenant isolation survive restore.** ✅

---

## 6. Regression suites re-run (Task 5)

```
typecheck (tsc --noEmit): 0 errors
Security/isolation/SSRF/WebSocket/upload suites: 10 files, 382 tests — ALL PASS
Full suite: 4909 pass / 2 fail (pre-existing date-relative tests in actions-phase8c;
            proven to fail with this work reverted) + 1 pre-existing load-error suite
            in the separate denver-engineering-next app (@ds alias). Zero new failures.
npm audit: 1 low (dev-only esbuild); 0 critical / 0 high (runtime).
```
