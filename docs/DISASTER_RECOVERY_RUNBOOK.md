# Disaster Recovery Runbook — Denver Engineering (SUPERSEDED — retained for history)

> ## ⚠️ This runbook describes infrastructure that does not exist. Do not follow it in an incident.
>
> Every procedure below is written against an **AWS RDS + WAL-G + S3 cross-region**
> architecture. That architecture was **never deployed** for Denver. The independent audit
> of 2026-06-20 checked: a repo-wide search for `pg_dump|wal-g|pgbackrest` found no backup
> tooling at all, and recorded the WAL→S3 PITR table below (lines 70-75 of the original)
> as describing tooling that does not exist. The RTO 4h / RPO 1h targets stated here were
> never measured against a real restore.
>
> The active hosting stack is **Fly.io + Neon**, confirmed by the owner on **2026-08-27**.
>
> **Denver currently has no validated DR runbook.** Authoring the Neon equivalent
> (branch/PITR restore, retention policy, drill evidence) is outstanding follow-up work
> that requires owner input on retention targets — it was deliberately not invented as
> part of the Render-retirement cleanup.
>
> Kept in place, under its original filename, because dated audit records under `audit/`
> and `docs/PHASE10_IMPLEMENTATION_REPORT.md` cite this path as evidence.
>
> See also `docs/DISASTER_RECOVERY_RUNBOOK_RENDER.md`, which briefly superseded this file
> for the Render stack and is itself now retired.

**Version:** 10.0.0 (historical)  
**RTO Target:** 4 hours — *aspirational, never measured*  
**RPO Target:** 1 hour — *aspirational, never measured*  
**Last Updated:** 2026-05-07 — *marked superseded 2026-08-28*

---

## Recovery Scenarios

### Scenario 1: Database Failure

**Detection:** All API calls failing, `pool.query` throwing connection errors

**Steps:**
1. Confirm DB health in cloud provider console
2. Initiate failover to read replica (auto-failover if configured)
3. Update `DATABASE_URL` to point to replica
4. Run read-only health check queries
5. Restore write access from last backup if replica unavailable
6. **RPO:** Last backup (≤ 1 hour with WAL streaming)

### Scenario 2: Complete Region Failure

**Detection:** All endpoints unreachable, cloud provider incident confirmed

**Steps:**
1. Activate secondary region deployment
2. Update DNS to point to secondary (TTL: 60s)
3. Restore from cross-region backup:
   - Database: point-in-time restore from S3-replicated WAL
   - Event store: replay from replicated event log
4. Validate tenant isolation: re-run `runTenantIsolationCheck()`
5. Verify replay integrity: `startVerification()` on critical event streams
6. **RTO:** 2–4 hours

### Scenario 3: Data Corruption

**Detection:** Replay divergence detected, audit log gaps, billing reconciliation failures

**Steps:**
1. Identify corruption window via `listDeploymentAudits()` timeline
2. Stop writes to affected tables
3. Run `checkMigrationSafety()` to verify schema integrity
4. Restore from last known-good backup point
5. Re-apply events from event log from backup point forward
6. Verify via `startVerification()` — must achieve `status === 'passed'`
7. **RPO:** Event log granularity (≤ 1 hour)

### Scenario 4: Deployment Failure

**Detection:** `deploymentAuditEngine` shows `status === 'failed'`, health score < 80%

**Steps:**
1. Verify rollback safety: `isRollbackSafe(latestAudit)` must be `true`
2. Execute rollback:
   ```typescript
   await updateDeploymentStatus(auditId, 'rolled_back')
   // trigger infrastructure rollback to previousVersion
   ```
3. Verify health: `isDeploymentHealthy(audit)` — requires `servicesDegraded === 0`
4. Run production gates on previous version
5. Root cause before next deployment attempt

---

## Backup Schedule

| Data | Frequency | Retention | Location |
|------|-----------|-----------|---------|
| PostgreSQL WAL | Continuous | 30 days | S3 cross-region |
| Full DB snapshot | Daily | 90 days | S3 cross-region |
| Event store | Continuous | 12 months | S3 cross-region |
| Audit log | Immutable | 7 years | S3 Glacier |

## DR Test Schedule

Quarterly DR drills covering:
1. Database failover test
2. Region failover simulation
3. Replay integrity verification after restore
4. Rollback execution drill

Next scheduled: 2026-07-01
