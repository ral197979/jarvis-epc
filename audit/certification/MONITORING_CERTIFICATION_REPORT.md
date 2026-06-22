# Monitoring Certification Report (Phase 2)

**Date:** 2026-06-22

## Verdict: 🟡 Engineering-validated; production deployment PENDING

### Collected evidence (local, real)
- **Alert rules authored + validated:** `observability/alert_rules.yml` → `promtool check rules` **SUCCESS: 6 rules**.
- **Alertmanager routing/escalation validated:** `observability/alertmanager.yml` → `amtool check-config` **SUCCESS: 3 receivers, 1 inhibit rule** (severity routing, hourly critical escalation, 4h persistence).
- **Rules load + fire:** ran Prometheus against a down target → `ApplicationUnavailable` (critical) + `BackupMetricMissing` (warning) transitioned pending → **firing** (`audit/evidence/prom_alerts_firing.json`).
- **Metrics endpoint protection:** `/metrics` fail-closed (OPS-004) — 26 tests pass (`api/__tests__/metrics.test.ts`).
- **Grounded series:** `denver_db_up` (wired to `/api/v1/health`), `denver_backup_last_success_timestamp_seconds`, `http_requests_total`, `background_job_total`.

| Item | Status | Reason / how to collect |
|---|---|---|
| Prometheus deployed (prod) | PENDING | Render bundles none — deploy Grafana Cloud / hosted Prometheus; no cloud access here |
| Alertmanager deployed (prod) | PENDING | deploy + mount PagerDuty/Slack secret files |
| Scrape success (prod) | PENDING | confirm prod `/metrics` scraped with `METRICS_TOKEN` |
| Rule loading (prod) | PENDING | rules already validated; confirm loaded in prod Prometheus |
| Alert routing (prod) | PENDING | fire synthetic alert → confirm PagerDuty/Slack delivery |

**Acceptance:** deploy the authored stack; capture Prometheus targets-up, rules-loaded, and a delivered alert notification. Commands: `audit/evidence/operator-kit.sh` WS4.
