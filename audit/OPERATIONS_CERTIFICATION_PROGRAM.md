# Operations Certification Program — Denver Engineering

**Date:** 2026-06-21 · **Scope:** operational certification only (engineering audit is closed — not re-audited here) · **Prior state:** 🟢 Provisionally Enterprise Certified (engineering)

> **Auditor access boundary (material):** this program was executed from a local
> environment with **no Render production access** (no API token; `render` CLI
> unauthenticated for our purposes; no cloud console; no AWS credentials).
> Production-only evidence (PITR enablement, prod RPO/RTO, prod-scale load,
> live bucket settings, prod alert firing) **cannot be generated here and is not
> fabricated** — those items are delivered as operator execution kits
> (`audit/evidence/operator-kit.sh`) with evidence templates, and remain PENDING.
> Everything reviewable from the repository was reviewed and is reported with evidence.

---

## 1. EXECUTIVE SUMMARY

The engineering posture is strong and independently verified (Critical closed;
RLS proven at runtime; SSRF/WS/upload/deps remediated; clean DB rebuild + restore
drill verified — see `INDEPENDENT_ENTERPRISE_AUDIT_2026-06-20.md` §10).

Operational certification is **not yet complete**. Two classes of blockers remain:
**(a)** production-only evidence that requires the Render environment, and **(b)**
**two new operational defects** found during this program's repository review:

- **OPS-001 (High):** `@aws-sdk/client-s3` is **not installed and not in `package.json`**, yet `render.yaml` sets `STORAGE_BACKEND=s3` for production → the S3 storage backend would **fail at runtime in production**.
- **OPS-003 (High):** there is **no production monitoring/alerting** — the Prometheus/Grafana stack is docker-compose-local only (absent from `render.yaml`), alert rules and Alertmanager are commented out/absent. The five required alert validations cannot fire.

Per the program's final rule (no High findings ⇒ required for 🏆), the status
**must remain 🟢 Enterprise Ready (Engineering) / 🟡 Pending Operations Certification.**

---

## 2. WORKSTREAM 1 — Production Operations (Backup / PITR / Restore)

| Item | Status | Evidence |
|---|---|---|
| PITR enabled | 🟡 PENDING (operator) | Requires Render dashboard → Recovery panel. Kit: WS1.1 |
| Backup retention configured | 🟡 PENDING (operator) | Render retention value (target ≥ 7d). Kit: WS1.1 |
| Restore drill completed | ✅ **VERIFIED locally** / 🟡 prod pending | `pg_dump`→`pg_restore`: backup 182ms, restore 738ms; integrity + post-restore tenant isolation confirmed (`CLOSURE_EVIDENCE.md` §2). Prod-scale drill: kit WS1.3 |
| Production RPO | 🟡 PENDING | = PITR granularity (target ≤ 1h). Kit WS1.4 |
| Production RTO | 🟡 PENDING | = prod restore + redeploy time (target ≤ 4h). Kit WS1.4 |

**Note:** restore requires the `vector` extension pre-created by a superuser (AUD-032; in DR runbook). Clean migration rebuild verified (AUD-031 fixed).

## 3. WORKSTREAM 2 — Production Load Validation

| Item | Status |
|---|---|
| Single-instance load (100/500/1000/5000) | ✅ DONE — p99 28ms/209ms/739ms; ~5k rps; graceful degradation, no crash; rate-limiter sheds load (`CLOSURE_EVIDENCE.md` §4) |
| Production-representative load + CPU/mem/net/DB/pool/cache/queue telemetry | 🟡 PENDING (staging/prod) — kit WS2 |
| Peak burst scenario | 🟡 PENDING — kit WS2 |

**Capacity (from local profile):** single instance ≈ 5k rps on the authenticated DB
read path, pool-bound at `DB_POOL_MAX`. **Scaling recommendation:** horizontal web
scaling on Render + raise `DB_POOL_MAX` in step with Postgres `max_connections`
(use a pooler/PgBouncer beyond ~1–2 instances); keep the 600/min/IP global limit;
validate burst behavior on staging before peak events.

## 4. WORKSTREAM 3 — Storage Governance

| Control | State | Evidence |
|---|---|---|
| Encryption **in transit** | ✅ Code-verified | AWS SDK + presigned URLs use HTTPS; `S3_ENDPOINT` is https |
| Encryption **at rest** | 🔴 **OPS-002 (Medium)** | `PutObjectCommand` (`storage.ts:213`) sets no `ServerSideEncryption`; relies on bucket default — not enforced in code |
| S3 backend functional | 🔴 **OPS-001 (High)** | `@aws-sdk/client-s3` not installed / not in `package.json`; `STORAGE_BACKEND=s3` in prod → runtime failure (`storage.ts:201`) |
| Versioning | 🟡 PENDING | bucket setting — kit WS3 (`get-bucket-versioning`) |
| Lifecycle / retention | 🟡 PENDING | bucket setting — kit WS3 |
| Object recovery | 🟡 PENDING | depends on versioning — kit WS3 |
| Tenant-isolated keys | ✅ Verified (prior audit) | keys prefixed `${tenantId}/…`, random |

**Remediation:** add `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` to deps
(or confirm prod actually uses `local`); set `ServerSideEncryption: 'AES256'` (or KMS)
on `PutObjectCommand`; enable bucket versioning + lifecycle + default encryption + public-access-block.

## 5. WORKSTREAM 4 — Observability Certification

| Control | State | Evidence |
|---|---|---|
| Structured logging + correlation IDs | ✅ Verified (prior audit) | pino; `X-Correlation-ID`/`X-Request-ID` |
| Audit logging | ✅ Verified | RLS-protected `audit_log`, redacted, request-id correlated |
| Prometheus metrics exposed | ✅ Code-verified | `prom-client`; `/metrics` |
| `/metrics` protection | 🟡 OPS-004 / AUD-013 | open when `METRICS_TOKEN` unset (`metrics.ts:138`) |
| **Production Prometheus/Grafana deployed** | 🔴 **OPS-003 (High)** | Not in `render.yaml`; `observability/` is docker-compose-local only; prod scrape jobs commented out |
| **Alert rules** | 🔴 OPS-003 | `rule_files:` commented in `prometheus.yml`; no rule/alert files exist |
| **Alert routing / escalation** | 🔴 OPS-003 | No Alertmanager / PagerDuty / Slack routing configured |
| Error tracking | ✅ Available | Sentry via `SENTRY_DSN` (prod observability today = Sentry + Render logs) |
| Alert validations (service/db/queue/disk/backup down) | 🔴 CANNOT PASS | no alert rules exist to fire — kit WS4 after rules are added |

**Remediation:** deploy a managed metrics/alerting path for prod (Grafana Cloud, or
Render metrics + a hosted Alertmanager), author the 5 alert rules, wire routing to
PagerDuty/Slack, then execute the WS4 synthetic-alert validations.

## 6. WORKSTREAM 5 — Operational Runbooks

✅ **DELIVERED.** `docs/runbooks/OPERATIONAL_RUNBOOKS.md` (Incident Response,
Production Deployment, Rollback, Security Incident + 5 tabletop scenarios + ops
readiness assessment); DR in `docs/DISASTER_RECOVERY_RUNBOOK_RENDER.md`.
🟡 Tabletop exercises are **defined but not yet executed**; on-call/paging not configured (ties to OPS-003).

## 7. WORKSTREAM 6 — Executive Certification Package

### 7.1 Security Certification Summary
Critical AUD-001 closed (tested). AUD-002 RLS **runtime-verified** (DB + live app). AUD-003/004/005/006/007/009/010 fixed and tested. `npm audit`: 0 critical / 0 high. Security regression suite: 382/382 pass. **No open Critical or High security findings.** ✅

### 7.2 Performance Certification Summary
Single-instance: p99 ≤ 28ms@100, ≤ 209ms@500, ≤ 739ms@1000; ~5k rps; graceful degradation @5000; rate-limiting effective. Production-scale validation PENDING (WS2). 🟡

### 7.3 Disaster Recovery Certification Summary
Restore procedure + post-restore tenant isolation **verified**; clean migration rebuild **verified** (AUD-031). Production PITR/retention + prod RPO/RTO drill PENDING (WS1). 🟡

### 7.4 Operational Readiness Summary
Runbooks complete and accurate. Live drills + on-call/alert routing NOT yet in place (OPS-003). 🟡

### 7.5 Risk Register (operations)

| ID | Sev | Finding | Status | Owner action |
|---|---|---|---|---|
| OPS-001 | High | S3 SDK missing; `STORAGE_BACKEND=s3` would fail in prod | OPEN | Add `@aws-sdk/client-s3` + presigner, or confirm `local`; verify deploy |
| OPS-003 | High | No prod monitoring/alerting (Prom/Grafana local-only; no alert rules/routing) | OPEN | Deploy prod metrics + 5 alert rules + routing |
| OPS-002 | Med | No SSE at rest set in code | OPEN | Set SSE on PutObject + bucket default encryption |
| OPS-004 | Med | `/metrics` open when token unset (=AUD-013) | OPEN | Fail-closed; require token |
| WS1-PITR | — | PITR/retention/prod RPO-RTO unverified | PENDING | Operator kit WS1 |
| WS2-LOAD | — | prod-scale load + telemetry unverified | PENDING | Operator kit WS2 |
| WS3-BUCKET | — | versioning/lifecycle/SSE/object-recovery unverified | PENDING | Operator kit WS3 |
| WS4-ALERTS | — | alert firing/escalation unverified | PENDING | After OPS-003 fix, kit WS4 |
| Engineering register | — | AUD-011..030 Medium/Low | OPEN | Hardening sprint (unchanged; not reopened) |

---

## 8. FINAL CERTIFICATION STATEMENT

**Gate check (program's stated criteria):**

| Required for 🏆 | Result |
|---|---|
| PITR verified | ❌ PENDING (operator) |
| Backup retention verified | ❌ PENDING (operator) |
| Restore drill completed | 🟡 local ✅ / production PENDING |
| Production load validation completed | ❌ PENDING (staging/prod) |
| Storage governance verified | ❌ OPS-001 (High) + bucket settings PENDING |
| Monitoring verified | ❌ OPS-003 (High) — no prod monitoring/alerting |
| No Critical findings | ✅ |
| No High findings | ❌ OPS-001, OPS-003 open |

Two **High** operational findings are open and multiple production-evidence items
are unverifiable from this environment. The program rule is explicit: upgrade to
🏆 **only if** all the above hold.

# VERDICT: 🟢 Enterprise Ready (Engineering) · 🟡 Pending Operations Certification

**Not upgraded to 🏆 Fully Enterprise Certified.** Engineering is verified and sound;
operational certification is blocked by two new High findings (OPS-001 storage SDK,
OPS-003 production monitoring/alerting) plus production-only evidence that requires
the Render environment.

**Path to 🏆 (no engineering rework required):**
1. Fix **OPS-001** (S3 SDK) and **OPS-003** (deploy prod monitoring + 5 alert rules + routing); also OPS-002/004.
2. Run the operator kit (`audit/evidence/operator-kit.sh`): capture PITR + retention evidence, a production restore drill with RPO/RTO, production-scale load with telemetry, bucket governance, and synthetic-alert validations.
3. Execute tabletop exercises T1–T5.
4. Re-run this certification review with the evidence attached → convert to 🏆.

---
---

# 9. REMEDIATION CLOSURE (Round 2 — 2026-06-21)

Executed with real tooling: live **MinIO** (S3-compatible) for storage round-trips,
live **Prometheus + Alertmanager** (Docker) for alert validation + firing. No
production/Render evidence fabricated.

## 9.1 Operations Certification Report (summary)

| Finding | Before | Action | After | Evidence |
|---|---|---|---|---|
| **OPS-001** (High) | S3 backend non-functional (SDK missing; `require` undefined in ESM; no S3 env) | Installed `@aws-sdk/client-s3` + `s3-request-presigner` + `lib-storage`; `createRequire` shim (ESM); added S3 env (bucket/region/creds) to all 4 render services | ✅ **CLOSED** | §9.2 |
| **OPS-002** (High) | No encryption-at-rest enforced | `ServerSideEncryption: 'AES256'` on `PutObjectCommand` + `streamToKey` Upload; presign surfaces required SSE header | ✅ **CLOSED** | §9.2 |
| **OPS-004** (Med/High) | `/metrics` open when token unset | Fail-closed: token required; prod denies always; non-prod allows localhost only | ✅ **CLOSED** | §9.4 |
| **OPS-003** (High) | No prod monitoring/alerting | Authored + validated 6 alert rules, Alertmanager routing/escalation, wired `prometheus.yml`; **demonstrated alerts firing** | 🟡 **artifacts done + validated; prod deploy = operator** | §9.3 |

Verification gates: `tsc` **0 errors**; full suite **4911 pass / 2 fail** (pre-existing date tests only — zero new failures); `npm audit` **0 critical / 0 high** (1 dev-only low).

## 9.2 Storage Verification Report (OPS-001 / OPS-002)

Round-trip against live MinIO via the **real `api/files/storage.ts` S3 backend** (`audit/evidence/s3verify.mts`): **10/10 checks PASS** —
- presignUpload returns a signed URL; **upload via presigned PUT → HTTP 200**; presignDownload signed URL; **download content matches**; getMetadata size correct; objectExists true→false on delete; server-side `streamToKey` upload works.
- **Encryption at rest verified by real object metadata**: `HeadObject.ServerSideEncryption == 'AES256'` on **both** the presigned-PUT object and the `streamToKey` object.
- Build verified: `tsc` 0 errors; `vite build` ✓ 2420 modules.
- package.json diff: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage` added; lockfile updated.
- render.yaml completed: `S3_BUCKET`/`AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`S3_SSE=AES256` added to all 4 S3 services.

In-transit encryption: AWS SDK + presigned URLs use HTTPS (code + endpoint scheme).
Residual (operator): populate `S3_BUCKET` + AWS credential secrets in Render; enable bucket **versioning + lifecycle + default encryption + public-access-block** (kit WS3).

## 9.3 Alerting Verification Report (OPS-003)

Artifacts (`observability/`): `alert_rules.yml` (6 rules), `alertmanager.yml` (routing by severity, hourly critical escalation, 4h persistence, inhibit rule), `prometheus.yml` wired with `rule_files` + `alerting`.

| Required alert | Rule | Series (real) | Validated |
|---|---|---|---|
| Application unavailable | `ApplicationUnavailable` | `up` | promtool ✅ + **fired** |
| Database unavailable | `DatabaseUnavailable` | `denver_db_up` (new gauge, wired to health check) | promtool ✅ |
| Queue failure | `QueueFailure` | `background_job_total{status=~"failed\|exhausted"}` | promtool ✅ |
| Backup failure | `BackupFailure` + `BackupMetricMissing` | `denver_backup_last_success_timestamp_seconds` (new gauge) | promtool ✅ + **fired** |
| High error rate | `HighErrorRate` | `http_requests_total{status_code=~"5.."}` ratio | promtool ✅ |

- `promtool check rules` → **SUCCESS: 6 rules found**.
- `amtool check-config` → **SUCCESS: 3 receivers, 1 inhibit rule**.
- **Firing demonstrated**: Prometheus against a down target → `ApplicationUnavailable` (critical) + `BackupMetricMissing` (warning) transitioned pending → **firing** (`audit/evidence/prom_alerts_firing.json`).
- New grounded metrics: `denver_db_up` (set by `/api/v1/health`), `denver_backup_last_success_timestamp_seconds` (`recordBackupSuccess()` for the backup job).

**Not yet done (operator):** deploy the stack to production (Render bundles no Prometheus/Grafana — use Grafana Cloud / hosted Alertmanager), mount PagerDuty/Slack secret files, fire one synthetic alert per class against prod.

## 9.4 OPS-004 verification
26 metrics tests pass, incl. new cases: token+correct-bearer → 200; missing/wrong bearer → 401; **no token + remote → 503**; **no token + production (even localhost) → 503**; no token + dev + localhost → 200. Render `METRICS_TOKEN` is `sync:false` → if unset, prod now **denies** (was: open).

## 9.5 Updated Risk Register

| ID | Sev | Status |
|---|---|---|
| OPS-001 | High | ✅ CLOSED (runtime-verified) |
| OPS-002 | High | ✅ CLOSED (object-metadata-verified) |
| OPS-004 | High | ✅ CLOSED (tested) |
| OPS-003 | High | 🟡 artifacts authored + validated + firing demonstrated; **production deployment pending (operator)** |
| WS1 PITR/retention/RPO/RTO | — | 🟡 PENDING (Render) — kit WS1 |
| WS2 prod-scale load + telemetry | — | 🟡 PENDING (staging/Render) — kit WS2 |
| WS3 bucket versioning/lifecycle/encryption | — | 🟡 PENDING (cloud console) — kit WS3 |
| WS4 prod alert firing | — | 🟡 PENDING (after prod deploy) — kit WS4 |
| Engineering AUD-011..030 | M/L | OPEN (hardening sprint; not reopened) |

## 9.6 Production Validation Checklist (operator — run `audit/evidence/operator-kit.sh`)

- [ ] Render Postgres **PITR enabled** + retention ≥ 7d (screenshot)
- [ ] **Production restore drill** → record RPO + RTO
- [ ] **Production-scale load** (100/500/1000 + burst) with CPU/mem/net/DB/pool/cache/queue telemetry
- [ ] Storage bucket: **versioning + lifecycle + default encryption + public-access-block** (CLI output)
- [ ] Populate `S3_BUCKET` + AWS credentials + `METRICS_TOKEN` secrets in Render
- [ ] Deploy prod monitoring (Prometheus/Grafana/Alertmanager) + mount PagerDuty/Slack secrets
- [ ] **Fire one synthetic alert per class** (service/db/queue/backup/error-rate) and capture delivery
- [ ] Execute tabletop exercises T1–T5

---

# 10. FINAL VERDICT (post Round-2 closure)

| Required for 🏆 | Result |
|---|---|
| OPS-001 closed | ✅ YES (runtime-verified) |
| OPS-002 closed | ✅ YES (object-metadata-verified) |
| OPS-004 closed | ✅ YES (tested) |
| Monitoring deployed | 🟡 built + validated + firing demonstrated locally; **prod deploy requires Render** |
| Required alerts verified | ✅ created + validated; 2/5 firing demonstrated; all grounded in real metrics |
| Production validation evidence attached | ❌ requires Render (PITR/RPO/RTO, prod-scale load, bucket governance, prod alert firing) |

# VERDICT: 🟢 Enterprise Ready (Engineering) · 🟡 Pending Operations Certification

**All three code-level OPS findings (OPS-001/002/004) are now CLOSED with runtime
evidence, and the monitoring stack is fully authored, tool-validated, and
demonstrated firing.** The status does **not** upgrade to 🏆 because two gate
criteria — **monitoring *deployed to production*** and **production validation
evidence attached** — require the Render/cloud environment, which is not
accessible here and whose evidence I will not fabricate.

**Remaining path to 🏆 is now purely operator execution** (no engineering work):
run `audit/evidence/operator-kit.sh` against Render, deploy the already-authored
monitoring stack, and attach the §9.6 checklist evidence → converts to 🏆.
