# Operational Runbooks — Denver Engineering (Render)

Companion to `docs/DISASTER_RECOVERY_RUNBOOK_RENDER.md` (DR is separate). Covers
incident response, production deployment, rollback, and security incidents, plus
tabletop exercises. Audience: on-call engineers + release managers.

Stack reference: Render web + worker services, Render PostgreSQL 16, Render Key
Value (Redis), S3-compatible object storage. Health: `GET /api/v1/health`
(reports db/redis). Metrics: `GET /metrics` (bearer `METRICS_TOKEN`).

---

## 1. Incident Response Runbook

**Severity matrix**

| Sev | Definition | Response | Comms |
|---|---|---|---|
| SEV1 | Full outage / data-integrity / confirmed breach | Page immediately, all-hands | Status page + exec within 30m |
| SEV2 | Major feature down, tenant-impacting, no workaround | Page on-call | Stakeholders within 1h |
| SEV3 | Degraded / partial, workaround exists | Next business hour | Ticket |
| SEV4 | Cosmetic / low impact | Backlog | Ticket |

**Flow:** Detect (alert/report) → Declare + assign Incident Commander → Triage
(`/api/v1/health`, Render metrics/logs, recent deploys) → Mitigate (rollback §3,
scale, failover) → Resolve + verify → Blameless postmortem within 48h.

**First 10 minutes checklist**
1. Acknowledge alert; declare severity; open incident channel.
2. `curl -s $BASE/api/v1/health` — check db/redis booleans.
3. Render dashboard → service Events: did a deploy land in the last hour? If yes → consider rollback (§3).
4. Render → Postgres metrics: CPU, connections vs pool max, replication.
5. Logs: filter by `correlationId`/`requestId`; check error-rate spike in `/metrics`.
6. If tenant-isolation or data exposure suspected → escalate to **Security Incident (§4)** immediately.

---

## 2. Production Deployment Runbook

**Pre-deploy gates** (CI `npm run ci`): `npm audit --audit-level=high` clean, `typecheck:all`, monolith-size check, full test suite green.
1. Merge to `main` → Render auto-build runs `install → typecheck → lint → test → build`.
2. **Migrations:** confirm any new migration applies on a fresh DB (the chain is now clean-rebuildable — AUD-031). Run `migrate.ts` against a staging clone first.
3. Deploy web + worker services together (shared `JWT_SECRET` — see AUD-015).
4. **Post-deploy verification:** `/api/v1/health` → `status:"ok"`, db.ok=true; smoke-test login + one tenant read; watch error rate in `/metrics` for 15 min.
5. If health degraded or error-rate spikes → **Rollback (§3)**.

**Migration safety:** forward-only (no down migrations — AUD-025). Prefer additive, backward-compatible migrations so a rollback of app code stays compatible with the new schema. Never deploy a destructive migration in the same release as the code that depends on it.

---

## 3. Rollback Runbook

**Trigger:** failed post-deploy health, error-rate spike, SEV1/2 traced to the latest release.
1. **App rollback:** Render → service → Deploys → **Rollback** to the last-good deploy (or redeploy the prior git SHA). Do web + workers together.
2. **Verify:** `/api/v1/health` ok; error rate normalizes.
3. **Schema consideration:** if the bad release included a migration, app rollback alone is safe ONLY if the migration was additive/backward-compatible (per §2). If a destructive migration ran, use the DR runbook (PITR to just before the deploy) — do not attempt a hand-written down migration under pressure.
4. **Token/secret note:** rolling back does not rotate `JWT_SECRET`; sessions remain valid.
5. Record rollback in the incident log; open a fix-forward ticket.

---

## 4. Security Incident Runbook

**Triggers:** suspected cross-tenant access, credential leak, SSRF/exfil attempt, auth bypass, anomalous audit-log activity.
1. **Contain:** for a compromised tenant/user → suspend via enterprise lifecycle (now authz-guarded, AUD-001) or deactivate the user; for a leaked secret → rotate immediately (`JWT_SECRET`, DB creds, API keys, `METRICS_TOKEN`) and force token purge (`purgeExpiredTokens` + rotate secret invalidates access tokens).
2. **Preserve evidence:** snapshot `audit_log` (immutable, request-id correlated) and relevant Render/app logs before remediation.
3. **Assess blast radius:** query `audit_log` by actor/tenant/time; confirm RLS was enforced (app connects as non-owner `jarvis_app` — AUD-002).
4. **Eradicate + recover:** patch, redeploy, verify with the security regression suite.
5. **Notify:** follow contractual/GDPR breach-notification timelines if PII exposure is confirmed.
6. Postmortem with a tracked corrective-action list.

**Secret rotation quick steps:** update the value in Render env (secret group) for web + workers → redeploy → verify `/api/v1/health` and a fresh login.

---

## 5. Tabletop Exercises (run quarterly; record outcomes)

| # | Scenario | Inject | Expected response | Pass criteria |
|---|---|---|---|---|
| T1 | **DB outage** | Render Postgres unreachable | Health → degraded; on-call paged; failover/restore per DR runbook | Alert fires < 5m; RTO target met in drill |
| T2 | **Bad deploy** | New release spikes 5xx | Detect via `/metrics`; rollback §3 | Rollback completes < 15m; health recovers |
| T3 | **Cross-tenant report** | Customer claims they saw another tenant's data | Security §4; verify RLS via `AUD-002_rls_validation.sql`; audit_log review | Isolation confirmed or contained < 1h |
| T4 | **Leaked secret** | `JWT_SECRET` exposed in a log | Rotate + redeploy + purge tokens | All sessions invalidated; new logins work |
| T5 | **Backup failure** | Nightly backup job fails | Backup-failure alert (WS4) → investigate | Alert delivered; backup re-run same day |

---

## 6. Operations Readiness Assessment

| Area | State | Notes |
|---|---|---|
| DR runbook | ✅ Accurate (Render) | Restore + rebuild verified locally; prod PITR pending operator |
| Incident response | ✅ Documented | This doc; needs one live drill (T1/T2) |
| Deploy / rollback | ✅ Documented | Render-native; CI gate enforced |
| Security incident | ✅ Documented | Ties to verified controls (AUD-001/002) |
| Tabletop exercises | 🟡 Defined, not yet executed | Schedule T1–T5 |
| On-call / paging | 🔴 **Not verified** | Alert routing/escalation absent in repo (WS4) — must configure |

**Readiness verdict:** runbooks are complete and accurate; **execution evidence
(live drills + alert routing) is the remaining gap** before operational sign-off.
