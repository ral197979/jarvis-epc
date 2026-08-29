# Disaster Recovery Runbook — Fly.io + Neon

> ## ⚠️ Status: INVENTORY COMPLETE — RECOVERY NOT YET REHEARSED
>
> The inventory below is **measured**, against the live Fly and Neon accounts on
> **2026-08-29**. The recovery procedures are **written but not yet executed**. No drill has
> run, so **no RPO or RTO figure in this document is a validated capability** — the targets
> are owner-set intent, not achievement.
>
> Do not cite this runbook as evidence of recovery capability until the drill in
> [§6](#6-drill-protocol) has been executed and [§7](#7-measured-results) is filled in.

**Owner targets:** RPO ≤ 1 hour · RTO ≤ 4 hours
**Measured:** *not yet measured — see [§7](#7-measured-results)*
**Supersedes:** `DISASTER_RECOVERY_RUNBOOK.md` (AWS RDS, never deployed) and
`DISASTER_RECOVERY_RUNBOOK_RENDER.md` (Render, retired). Both are marked do-not-follow.

---

## 1. Measured inventory

All values verified 2026-08-29 via `flyctl` and `neonctl` against the live accounts.

### 1.1 Database — Neon

| Property | Value |
|---|---|
| Project | `denver-epc` (`spring-sea-58425774`) |
| Region | `aws-us-east-1` |
| Postgres | 18 |
| Branch | `production` (`br-royal-grass-ate3vv3y`), default, **`protected = false`** |
| Compute endpoint | `ep-aged-sky-atjki217`, read-write, active, autoscale 0.25–8 CU |
| Logical size | ~47 MB |
| **History retention (PITR window)** | **6 hours** (`history_retention_seconds = 21600`) |
| Org plan | `launch` — supports up to **7 days** retention |
| Logical backup (`pg_dump`) | **none — no backup tooling exists anywhere in the repo** |

Neon's history retention is therefore the **only** recovery source for the database.

### 1.2 Application — Fly.io

| Property | Production | Staging |
|---|---|---|
| App | `denver-epc` | `denver-epc-staging` |
| Status | deployed | **`pending` — never deployed, no image** |
| Region | `iad` (single) | `iad` |
| Machines | **1** | 0 |
| VM | 1 GB / 1 shared CPU | — |
| Scale floor | `min_machines_running = 1` | `min_machines_running = 0` |
| Health check | `GET /api/v1/health`, 30s | same |
| Last deploy | 2026-07-02 | never |
| Volumes | **none** | none |

### 1.3 Secrets and configuration

Production Fly secrets — **two only**:

| Secret | Digest | Recovery source |
|---|---|---|
| `DATABASE_URL` | `55378fee70d900f9` | Regenerable from Neon |
| `JWT_SECRET` | `26b67770d1ca883e` | **No documented escrow** — see [G7](#5-gap-register) |

All other configuration is non-secret and lives in `fly.toml`, which is version-controlled
and therefore recoverable from git. Production runs with the advanced feature flags
(`CAPABILITY_REGISTRY`, `KNOWLEDGE_GRAPH`, `DENVER_MCP_SERVER`, `EAP_ENABLED`, …) all
`false`, which is why no AI-provider keys are set on the app.

GitHub repository secrets: **none configured** (`gh secret list` returns empty).

### 1.4 Object storage

`STORAGE_BACKEND = "local"`. `api/files/storage.ts:145` writes uploads to
`STORAGE_LOCAL_DIR`, defaulting to `./uploads` inside the container. **No Fly volume is
mounted and none exists**, so this path is ephemeral container storage.

Document *metadata* rows are written to Postgres (`api/routes/files.ts:169`) and **do**
survive a database restore. The *file bytes* do not. See [G1](#5-gap-register).

`api/files/storage.ts` already implements an `s3` backend (S3 / MinIO / Tigris / R2), so
closing this gap is configuration, not new code.

### 1.5 External dependencies

With production's feature flags off, the recovery path depends only on **Fly.io** (compute,
secrets, registry) and **Neon** (database). No third-party AI or payment provider is on the
critical path for restoring service.

---

## 2. Recovery procedure — database

> Creates a **new** Neon branch from a point in time. It is non-destructive: the existing
> `production` branch is untouched. Never run a destructive in-place restore on production.

1. **Fix the recovery point.** Identify the last-known-good timestamp (UTC). It must be
   within the retention window — currently **6 hours**.

   ```
   neonctl branches list --project-id spring-sea-58425774
   ```

2. **Create a recovery branch** at that timestamp:

   ```
   neonctl branches create --project-id spring-sea-58425774 \
     --name recovery-<UTC-timestamp> --parent production@<ISO-8601-timestamp>
   ```

3. **Verify the recovery branch** before cutting over — row counts and latest timestamps on
   the highest-churn tables, and `SELECT max(version) FROM schema_migrations` against the
   90 migrations in `api/db/migrations/`.

4. **Cut over** by pointing the app at the recovery branch's connection string:

   ```
   flyctl secrets set --app denver-epc DATABASE_URL="<recovery-branch-uri>"
   ```

   Setting a secret restarts the machines. Do not paste the URI into shell history — read it
   from a file or the launcher (see the workspace secret-handling policy).

5. **Promote** the recovery branch to default in the Neon console once service is confirmed
   healthy, so subsequent PITR is measured from the recovered timeline.

## 3. Recovery procedure — application

If the Fly app or machine is lost, the image is rebuilt from source. `fly.toml` is
version-controlled, so configuration needs no separate backup.

1. `flyctl apps create denver-epc` (only if the app itself is gone).
2. Restore the two secrets from [§1.3](#13-secrets-and-configuration). `DATABASE_URL` comes
   from Neon; `JWT_SECRET` must come from escrow — **see [G7](#5-gap-register)**.
3. `flyctl deploy --config fly.toml --app denver-epc` — builds `Dockerfile.api` from the
   target commit.
4. Run migrations: `npm run db:migrate` (`tsx api/db/migrate.ts`, 90 migrations).
5. Confirm `GET /api/v1/health` returns healthy and the Fly health check passes.

**Note:** the documented automated path (`.github/workflows/fly-staging-deploy.yml`) is
currently **non-functional** — see [G4](#5-gap-register). Recovery today is a manual
`flyctl` operation from an operator workstation.

## 4. What a database restore does *not* recover

Stated plainly, because the gap is invisible from the database side:

- **Uploaded document bytes.** Lost with the container. The restored database still holds
  their metadata rows, so the application will show documents whose files 404.
- **Anything written to the container filesystem** by `api/services/packWorker.ts` or
  `api/scripts/cxExportRun.ts`.

---

## 5. Gap register

Severity reflects impact on the owner's ≤1h RPO / ≤4h RTO targets.

| # | Severity | Gap | Effect on target |
|---|---|---|---|
| **G1** | **Critical** | Uploads on ephemeral storage: `STORAGE_BACKEND=local`, no volume, no backup. DB retains dangling metadata rows. | **RPO ≤1h cannot be met for file data.** Loss is unbounded — everything since the machine started. |
| **G2** | **High** | PITR window is 6h while the `launch` plan allows 7d. No logical backup exists. | Corruption found >6h after the fact has **no recovery point at all**. |
| **G3** | **High** | `denver-epc-staging` has never been deployed — no image, no secrets. | No rehearsal target exists; no deploy path has ever been proven end-to-end. |
| **G4** | **High** | Staging deploy workflow cannot run: no GitHub secrets (`FLY_API_TOKEN`, `STAGING_DATABASE_URL_APP` absent) **and** its blocking `npm audit --audit-level=high` step fails on 6 high transitive advisories. | The documented automated recovery path is inoperable. RTO depends on manual operator action. |
| **G5** | Medium | Neon `production` branch has `protected = false`. | Accidental deletion is possible and would exceed every target. |
| **G6** | Medium | Single machine, single region (`iad`), `min_machines_running = 1`. | No redundancy. Machine or region loss is full downtime until redeploy. |
| **G7** | Medium | `JWT_SECRET` exists only as a Fly secret, with no documented escrow. | If lost with the app, it cannot be restored; all issued tokens become invalid, forcing global re-authentication. |
| **G8** | Low | Production image dates from 2026-07-02; recovery rebuilds from source. | The rebuild path is unproven against the current `main`. |

### Assessment against the owner targets

- **RPO ≤ 1 hour — met for the database, not met overall.** Neon PITR gives near-zero RPO
  for Postgres *if* recovery begins within the 6h window. It is **not met for uploaded
  files**, which have no backup of any kind (G1).
- **RTO ≤ 4 hours — unproven, and currently at risk.** The automated path cannot execute
  (G4) and no drill has measured the manual path (G3). Reporting it as met would be false.

Per the owner's instruction, these targets are **not** being adjusted to fit the
infrastructure. The gaps above are the report.

---

## 6. Drill protocol

To be executed against **staging only**. No production destructive restore.

1. Record `T0`. Create a Neon recovery branch from `production` at a chosen timestamp.
2. Seed a known marker row before `T0` and one after, to measure the recovery point precisely.
3. Deploy `denver-epc-staging` from `fly.staging.toml` against the recovery branch.
4. Run migrations; confirm `GET /api/v1/health`.
5. Verify the marker rows to establish **measured RPO**.
6. Record `T1` at first healthy response. **Measured RTO = T1 − T0.**
7. Log every manual prerequisite and every step that required a human decision.
8. Tear down the staging machine and the recovery branch.

## 7. Measured results

*Not yet run.* This section stays empty until the drill executes. It must record measured
RPO, measured RTO, the date, the operator, every manual prerequisite, and every step that
failed or needed improvisation.

| Drill date | Measured RPO | Measured RTO | Result | Notes |
|---|---|---|---|---|
| — | — | — | not yet run | — |
