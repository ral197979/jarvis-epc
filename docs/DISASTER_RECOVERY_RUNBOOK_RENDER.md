# Disaster Recovery Runbook — Render (authoritative)

**Supersedes** `docs/DISASTER_RECOVERY_RUNBOOK.md` for the production stack. The prior
runbook described an AWS RDS + WAL-G + S3 cross-region architecture that **does not exist**
in this deployment (the platform runs on **Render managed PostgreSQL 16**). This runbook
reflects the actual stack and the procedures verified during the 2026-06-21 audit closure.

---

## 1. Architecture (actual)

| Component | Reality | Backup mechanism |
|---|---|---|
| Database | Render managed PostgreSQL 16 (`standard-4gb` prod, `standard-1gb` staging) | Render automated daily backups + Point-in-Time Recovery (paid plans) |
| Redis | Render Key Value (`noeviction`) — token revocation/cache | Ephemeral; **not** a source of truth (rebuildable) |
| File storage | `STORAGE_BACKEND=s3` (object store) | Object-store versioning/lifecycle (configure on the bucket) |
| App / workers | Render web + worker services (stateless) | Redeploy from git; no state to restore |

## 2. Backup configuration (operator actions — REQUIRED for certification)

1. **Render Postgres → Backups:** confirm daily backups are enabled and note retention
   (Render `standard` includes automated backups; verify retention meets policy — target ≥ 7 days).
2. **PITR:** confirm Point-in-Time Recovery window is enabled on the production database.
3. **Object store:** enable versioning + a lifecycle policy on the file-storage bucket.
4. **Off-Render logical backup (defense-in-depth):** schedule a daily `pg_dump -Fc` to an
   independent object store (guards against provider-account loss). Example:
   ```bash
   pg_dump "$DATABASE_URL" -Fc | aws s3 cp - "s3://<dr-bucket>/denver/$(date +%F).dump"
   ```
   Retain ≥ 30 days; this is the cross-provider copy the old runbook claimed but never had.

## 3. Restore procedure (VERIFIED 2026-06-21)

Logical restore into a clean database — drilled during the audit (921 KB dump: backup 0.18s, restore 0.74s):

```bash
# 1. Create a clean target owned by the app's owner role
createdb -O jarvis denver_restore

# 2. PRE-CREATE the pgvector extension as a SUPERUSER (REQUIRED — see note)
psql -d denver_restore -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 3. Restore
pg_restore --no-owner --role=jarvis -d denver_restore <backup>.dump

# 4. Verify integrity
psql -d denver_restore -c "SELECT count(*) FROM tenants; SELECT count(*) FROM schema_migrations;"
```

> **NOTE (AUD-032):** `pg_restore` cannot create the `vector` extension as a non-superuser; it
> must be pre-created (step 2) or the `knowledge_chunks` / pgvector objects fail to restore.
> Render-to-Render restores via the dashboard handle extensions automatically; this step is for
> manual/off-provider restores.

## 4. Rebuild-from-migrations (VERIFIED 2026-06-21)

The full migration chain now applies cleanly on an empty database (AUD-031 fixed):
```bash
createdb -O jarvis denver_new
psql -d denver_new -c "CREATE EXTENSION IF NOT EXISTS vector;"
DATABASE_URL="postgres://jarvis:***@host/denver_new" npx tsx api/db/migrate.ts
# → "Applied 74 migration(s)", 218 tables, exit 0
```

## 5. Post-restore validation (MANDATORY — VERIFIED 2026-06-21)

After any restore, confirm tenant isolation is intact using the non-owner app role:
```bash
psql "postgres://jarvis_app:***@host/denver_restore" \
  -c "BEGIN; SELECT set_config('app.current_tenant_id','<known-tenant>',true);
      SELECT count(*) FROM projects; COMMIT;"   # must return only that tenant's rows
psql "postgres://jarvis_app:***@host/denver_restore" \
  -c "SELECT count(*) FROM projects;"            # no context → must return 0 (fail-closed)
```
(See `audit/evidence/AUD-002_rls_validation.sql`.)

## 6. RPO / RTO

| Metric | Target | Status |
|---|---|---|
| RPO | ≤ 1h (PITR) / ≤ 24h (daily dump) | **Depends on Render PITR being enabled (step 2.2) — VERIFY in dashboard** |
| RTO | ≤ 4h | Local logical restore measured at sub-second for small data; **production-scale restore drill required to confirm at prod data volume** |

RPO/RTO are **not yet substantiated at production scale** — they require one production restore drill
on Render. The restore *procedure* and post-restore isolation are verified.

## 7. DR drill cadence

Run a full restore drill (steps 3 + 5) **quarterly**, into a throwaway database, and record
backup/restore timing + the isolation check result.
